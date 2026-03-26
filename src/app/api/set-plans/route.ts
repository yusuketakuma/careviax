import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createSetPlanSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  target_period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  target_period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  set_method: z.enum(
    ['facility_calendar', 'four_times_daily', 'bedtime_only', 'custom'],
    { error: 'セット方式を選択してください' }
  ),
  notes: z.string().optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get('cycle_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(cycleId ? { cycle_id: cycleId } : {}),
  };

  const plans = await prisma.setPlan.findMany({
    where,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      cycle_id: true,
      target_period_start: true,
      target_period_end: true,
      set_method: true,
      notes: true,
      created_at: true,
      updated_at: true,
      cycle: {
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_: {
            select: {
              patient: {
                select: { id: true, name: true, name_kana: true },
              },
            },
          },
        },
      },
      audits: {
        orderBy: { audited_at: 'desc' },
        take: 1,
        select: {
          id: true,
          result: true,
          audited_at: true,
        },
      },
    },
  });

  return success({ data: plans });
}, {
  permission: 'canSet',
  message: 'セット計画の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createSetPlanSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    cycle_id,
    target_period_start,
    target_period_end,
    set_method,
    notes,
  } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: cycle_id, org_id: req.orgId },
      select: { id: true, overall_status: true },
    });

    if (!cycle) {
      throw new Error('NOT_FOUND:指定されたサイクルが見つかりません');
    }

    const plan = await tx.setPlan.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        target_period_start: new Date(target_period_start),
        target_period_end: new Date(target_period_end),
        set_method,
        notes: notes ?? null,
      },
    });

    // Advance cycle status to setting
    if (cycle.overall_status === 'audited') {
      await tx.medicationCycle.update({
        where: { id: cycle_id },
        data: { overall_status: 'setting' },
      });
    }

    return plan;
  });

  return success({ data: result }, 201);
}, {
  permission: 'canSet',
  message: 'セット計画の作成権限がありません',
});
