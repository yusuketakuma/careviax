import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createMedicationCycleSchema } from '@/lib/validations/medication';
import { MEDICATION_CYCLE_STATUSES } from '@/lib/prescription/intake-filters';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { canAccessCareCase } from '@/server/services/patient-access';
import { z } from 'zod';

const medicationCycleStatusSchema = z.enum(MEDICATION_CYCLE_STATUSES);

export const GET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const { limit, offset } = parsePaginationParams(searchParams);

    const statusParam = searchParams.get('status') ?? undefined;
    const statusFilter = statusParam ? medicationCycleStatusSchema.safeParse(statusParam) : null;
    if (statusFilter && !statusFilter.success) {
      return validationError('服薬サイクルステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }
    const caseId = searchParams.get('case_id') ?? undefined;
    const patientId = searchParams.get('patient_id') ?? undefined;
    const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);

    const where = {
      org_id: ctx.orgId,
      ...(statusFilter ? { overall_status: statusFilter.data } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...(patientId ? { patient_id: patientId } : {}),
      ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
    };

    const [cycles, totalCount] = await Promise.all([
      prisma.medicationCycle.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit + 1,
        include: {
          prescription_intakes: {
            select: {
              id: true,
              source_type: true,
              prescribed_date: true,
              prescriber_name: true,
            },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.medicationCycle.count({ where }),
    ]);

    const hasMore = cycles.length > limit;
    const data = hasMore ? cycles.slice(0, limit) : cycles;

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

export const POST = withAuthContext(
  async (req: NextRequest, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createMedicationCycleSchema.safeParse(body);
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
