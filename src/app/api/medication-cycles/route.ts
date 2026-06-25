import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createMedicationCycleSchema } from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { MEDICATION_CYCLE_STATUSES } from '@/lib/prescription/intake-filters';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessCareCase } from '@/server/services/patient-access';
import { z } from 'zod';

const medicationCycleStatusSchema = z.enum(MEDICATION_CYCLE_STATUSES);
type MedicationCycleQueryName = 'status' | 'case_id' | 'patient_id';

function readStrictOptionalMedicationCycleFilter(
  searchParams: URLSearchParams,
  name: MedicationCycleQueryName,
  messages: { blank: string; invalid: string },
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [`${name} は1つだけ指定してください`] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.blank] },
    };
  }
  if (value !== value.trim() || value.length > 100) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function parseMedicationCycleListFilters(searchParams: URLSearchParams) {
  const statusResult = readStrictOptionalMedicationCycleFilter(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', statusResult.fieldErrors),
    };
  }

  const caseResult = readStrictOptionalMedicationCycleFilter(searchParams, 'case_id', {
    blank: 'ケースIDを指定してください',
    invalid: 'ケースIDの形式が不正です',
  });
  if (!caseResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', caseResult.fieldErrors),
    };
  }

  const patientResult = readStrictOptionalMedicationCycleFilter(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', patientResult.fieldErrors),
    };
  }

  const statusFilter = statusResult.value
    ? medicationCycleStatusSchema.safeParse(statusResult.value)
    : null;
  if (statusFilter && !statusFilter.success) {
    return {
      ok: false as const,
      response: validationError('服薬サイクルステータスが不正です', {
        status: ['対応していないステータスです'],
      }),
    };
  }

  return {
    ok: true as const,
    status: statusFilter?.data,
    caseId: caseResult.value,
    patientId: patientResult.value,
  };
}

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePaginationParams(searchParams);

    const filters = parseMedicationCycleListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);

    const where = {
      org_id: ctx.orgId,
      ...(filters.status ? { overall_status: filters.status } : {}),
      ...(filters.caseId ? { case_id: filters.caseId } : {}),
      ...(filters.patientId ? { patient_id: filters.patientId } : {}),
      ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
    };

    const [cycles, totalCount] = await Promise.all([
      prisma.medicationCycle.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit + 1,
        select: {
          id: true,
        },
      }),
      prisma.medicationCycle.count({ where }),
    ]);

    const hasMore = cycles.length > limit;
    const page = hasMore ? cycles.slice(0, limit) : cycles;
    const data = page.map((cycle) => ({ id: cycle.id }));

    return success({
      data,
      hasMore,
      totalCount,
      nextCursor: hasMore ? String(offset + limit) : undefined,
    });
  },
  {
    permission: 'canDispense',
    message: 'サイクル一覧の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));

export const POST = withAuthContext(
  async (req: NextRequest, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createMedicationCycleSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const refResult = await validateOrgReferences(ctx.orgId, {
      case_id: parsed.data.case_id,
      patient_id: parsed.data.patient_id,
    });
    if (!refResult.ok) return refResult.response;
    if (
      !(await canAccessCareCase({
        db: prisma,
        orgId: ctx.orgId,
        caseId: parsed.data.case_id,
        patientId: parsed.data.patient_id,
        accessContext: ctx,
      }))
    ) {
      return validationError('患者またはケースの割当権限がありません');
    }

    const cycle = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.medicationCycle.create({
        data: {
          org_id: ctx.orgId,
          case_id: parsed.data.case_id,
          patient_id: parsed.data.patient_id,
          overall_status: 'intake_received',
          version: 1,
        },
      });
    });

    return success(cycle, 201);
  },
  {
    permission: 'canDispense',
    message: 'サイクル作成権限がありません',
  },
);
