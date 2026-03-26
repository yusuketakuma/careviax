import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { createMedicationCycleSchema } from '@/lib/validations/medication';
import { prisma } from '@/lib/db/client';
import { type MedicationCycleStatus } from '@prisma/client';

export const GET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const offset = cursor ? parseInt(cursor, 10) : 0;

    const statusFilter = (searchParams.get('status') ?? undefined) as MedicationCycleStatus | undefined;
    const caseId = searchParams.get('case_id') ?? undefined;
    const patientId = searchParams.get('patient_id') ?? undefined;

    const where = {
      org_id: ctx.orgId,
      ...(statusFilter ? { overall_status: statusFilter } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...(patientId ? { patient_id: patientId } : {}),
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
  }
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
  }
);
