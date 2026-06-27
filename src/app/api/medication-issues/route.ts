import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parsePaginationParams } from '@/lib/api/pagination';
import {
  createMedicationIssueSchema,
  medicationIssueStatusSchema,
} from '@/lib/validations/medication';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  canAccessCareCase,
  canAccessPatient,
  listAccessibleCareCaseIds,
  listAccessiblePatientIds,
} from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

function readStrictOptionalMedicationIssueFilter(
  searchParams: URLSearchParams,
  name: 'patient_id' | 'case_id' | 'status',
  messages: { blank: string; invalid?: string },
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
      fieldErrors: { [name]: [messages.invalid ?? messages.blank] },
    };
  }

  return { ok: true as const, value };
}

function parseMedicationIssueListFilters(searchParams: URLSearchParams) {
  const patientResult = readStrictOptionalMedicationIssueFilter(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', patientResult.fieldErrors),
      ),
    };
  }

  const caseResult = readStrictOptionalMedicationIssueFilter(searchParams, 'case_id', {
    blank: 'ケースIDを指定してください',
    invalid: 'ケースIDの形式が不正です',
  });
  if (!caseResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(validationError('検索条件が不正です', caseResult.fieldErrors)),
    };
  }

  const statusResult = readStrictOptionalMedicationIssueFilter(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', statusResult.fieldErrors),
      ),
    };
  }

  return {
    ok: true as const,
    patientId: patientResult.value,
    caseId: caseResult.value,
    statusParam: statusResult.value,
  };
}

async function buildMedicationIssueAssignmentWhere(args: {
  orgId: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.MedicationIssueWhereInput | null> {
  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return null;

  const [caseIds, patientIds] = await Promise.all([
    listAccessibleCareCaseIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
    listAccessiblePatientIds({
      db: prisma,
      orgId: args.orgId,
      accessContext: args.accessContext,
    }),
  ]);

  return {
    OR: [
      { case_id: { in: caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: patientIds } }] },
    ],
  };
}

async function canAccessMedicationIssueScope(args: {
  orgId: string;
  patientId?: string | null;
  caseId?: string | null;
  accessContext: VisitScheduleAccessContext;
}) {
  if (args.caseId) {
    return canAccessCareCase({
      db: prisma,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId ?? undefined,
      accessContext: args.accessContext,
    });
  }

  if (args.patientId) {
    return canAccessPatient({
      db: prisma,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
  }

  return true;
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const filters = parseMedicationIssueListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const { patientId, caseId, statusParam } = filters;
    const status = statusParam ? medicationIssueStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return withSensitiveNoStore(
        validationError('服薬課題ステータスが不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }

    if (patientId && caseId) {
      const refResult = await validateOrgReferences(ctx.orgId, {
        patient_id: patientId,
        case_id: caseId,
      });
      if (!refResult.ok) return withSensitiveNoStore(refResult.response);
    }

    const accessContext = { userId: ctx.userId, role: ctx.role };
    if (
      (patientId || caseId) &&
      !(await canAccessMedicationIssueScope({
        orgId: ctx.orgId,
        patientId,
        caseId,
        accessContext,
      }))
    ) {
      return withSensitiveNoStore(success({ data: [], hasMore: false, nextCursor: undefined }));
    }

    const assignmentWhere = await buildMedicationIssueAssignmentWhere({
      orgId: ctx.orgId,
      accessContext,
    });
    const where: Prisma.MedicationIssueWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...(status ? { status: status.data } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const issues = await prisma.medicationIssue.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { identified_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        category: true,
        identified_by: true,
        identified_at: true,
        resolved_by: true,
        resolved_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = issues.length > limit;
    const data = hasMore ? issues.slice(0, limit) : issues;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return withSensitiveNoStore(success({ data, hasMore, nextCursor }));
  },
  {
    permission: 'canVisit',
    message: '服薬課題の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createMedicationIssueSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, case_id } = parsed.data;
    const refResult = await validateOrgReferences(ctx.orgId, {
      patient_id,
      case_id,
    });
    if (!refResult.ok) return refResult.response;

    if (
      !(await canAccessMedicationIssueScope({
        orgId: ctx.orgId,
        patientId: patient_id,
        caseId: case_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      }))
    ) {
      return notFound('患者またはケースが見つかりません');
    }

    const issue = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.medicationIssue.create({
        data: {
          org_id: ctx.orgId,
          identified_by: ctx.userId,
          ...parsed.data,
        },
      });
    });

    return success({ data: issue }, 201);
  },
  {
    permission: 'canVisit',
    message: '服薬課題の作成権限がありません',
  },
);
