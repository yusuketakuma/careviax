import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildSetPlanPackagingSummary } from '@/lib/prescription/set-plan-packaging';
import { transitionCycleStatus, InvalidTransitionError, VersionConflictError } from '@/lib/db/cycle-transition';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { z } from 'zod';

const createSetPlanSchema = z
  .object({
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
    packaging_method_id: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.target_period_end < value.target_period_start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target_period_end'],
        message: '終了日は開始日以降を指定してください',
      });
    }
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
      packaging_method_id: true,
      packaging_summary_snapshot: true,
      notes: true,
      created_at: true,
      updated_at: true,
      packaging_method_ref: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
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
    packaging_method_id,
    notes,
  } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: cycle_id, org_id: req.orgId },
      select: {
        id: true,
        overall_status: true,
        patient_id: true,
        case_: {
          select: {
            patient: {
              select: {
                packaging_preferences: true,
                packaging_profile: {
                  select: {
                    default_packaging_method: true,
                    medication_box_color: true,
                    notes: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cycle) {
      return {
        kind: 'error' as const,
        message: '指定されたサイクルが見つかりません',
      };
    }

    // B5: State guard — SetPlan can only be created when cycle is audited
    if (cycle.overall_status !== 'audited') {
      return {
        kind: 'error' as const,
        message: `セットプランを作成できるのは鑑査済み状態のみです（現在: ${cycle.overall_status}）`,
      };
    }

    const packagingMethod = packaging_method_id
      ? await tx.packagingMethodMaster.findFirst({
          where: {
            id: packaging_method_id,
            org_id: req.orgId,
            is_active: true,
          },
          select: {
            id: true,
            name: true,
            description: true,
          },
        })
      : null;

    if (packaging_method_id && !packagingMethod) {
      return {
        kind: 'error' as const,
        message: '指定された配薬方法マスタが見つかりません',
      };
    }

    const packagingSummary = buildSetPlanPackagingSummary({
      setMethod: set_method,
      packagingMethod,
      patientPackagingProfile: cycle.case_?.patient.packaging_profile ?? null,
      packagingPreferences: cycle.case_?.patient.packaging_preferences ?? null,
    });

    const plan = await tx.setPlan.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        target_period_start: new Date(target_period_start),
        target_period_end: new Date(target_period_end),
        set_method,
        packaging_method_id: packagingMethod?.id ?? null,
        packaging_summary_snapshot: packagingSummary,
        notes: notes ?? null,
      },
    });

    // Advance cycle status to setting
    if (cycle.overall_status === 'audited') {
      try {
        await transitionCycleStatus(tx, cycle_id, req.orgId, 'setting', req.userId);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return {
            kind: 'error' as const,
            message: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
          };
        }
        if (err instanceof VersionConflictError) {
          return { kind: 'conflict' as const, message: err.message };
        }
        throw err;
      }
    }

    return {
      kind: 'success' as const,
      data: plan,
    };
  });

  if (result.kind === 'error') {
    return validationError(result.message);
  }
  if (result.kind === 'conflict') {
    return conflict(result.message);
  }

  await notifyWorkflowMutation({
    orgId: req.orgId,
    eventType: 'cycle_transition',
    payload: { source: 'set_plans', cycle_id },
  });

  return success({ data: result.data }, 201);
}, {
  permission: 'canSet',
  message: 'セット計画の作成権限がありません',
});
