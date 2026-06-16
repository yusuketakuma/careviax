import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildSetPlanPackagingSummary } from '@/lib/prescription/set-plan-packaging';
import {
  transitionCycleStatus,
  InvalidTransitionError,
  VersionConflictError,
} from '@/lib/db/cycle-transition';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';
import { dateKeySchema } from '@/lib/validations/date-key';
import { z } from 'zod';

const createSetPlanSchema = z
  .object({
    cycle_id: z.string().min(1, 'サイクルIDは必須です'),
    target_period_start: dateKeySchema('日付形式が不正です（YYYY-MM-DD）'),
    target_period_end: dateKeySchema('日付形式が不正です（YYYY-MM-DD）'),
    set_method: z.enum(['facility_calendar', 'four_times_daily', 'bedtime_only', 'custom'], {
      error: 'セット方式を選択してください',
    }),
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

type SetPlanRollbackResult =
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string };

class SetPlanRollback extends Error {
  constructor(readonly result: SetPlanRollbackResult) {
    super('set plan transaction rolled back');
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const cycleId = searchParams.get('cycle_id') ?? undefined;
    const assignmentWhere = buildSetPlanAssignmentWhere(ctx);

    const where = {
      org_id: ctx.orgId,
      ...(cycleId ? { cycle_id: cycleId } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
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
  },
  {
    permission: 'canSet',
    message: 'セット計画の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createSetPlanSchema.safeParse(payload);
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

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
      const cycle = await tx.medicationCycle.findFirst({
        where: {
          id: cycle_id,
          org_id: ctx.orgId,
          ...(cycleAssignmentWhere ? { AND: [cycleAssignmentWhere] } : {}),
        },
        select: {
          id: true,
          overall_status: true,
          patient_id: true,
          case_: {
            select: {
              patient: {
                select: {
                  packaging_profile: {
                    select: {
                      default_packaging_method: true,
                      medication_box_color: true,
                      notes: true,
                      box_config: true,
                      special_instructions: true,
                      cognitive_note: true,
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

      const targetPeriodStart = new Date(target_period_start);
      const targetPeriodEnd = new Date(target_period_end);
      const existingPlan = await tx.setPlan.findFirst({
        where: {
          org_id: ctx.orgId,
          cycle_id,
          target_period_start: targetPeriodStart,
          target_period_end: targetPeriodEnd,
          set_method,
        },
      });
      if (existingPlan) {
        return {
          kind: 'success' as const,
          data: existingPlan,
          replayed: true,
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
              org_id: ctx.orgId,
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
      });

      let plan;
      try {
        plan = await tx.setPlan.create({
          data: {
            org_id: ctx.orgId,
            cycle_id,
            target_period_start: targetPeriodStart,
            target_period_end: targetPeriodEnd,
            set_method,
            packaging_method_id: packagingMethod?.id ?? null,
            packaging_summary_snapshot: packagingSummary,
            notes: notes ?? null,
          },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        const existingAfterRace = await tx.setPlan.findFirst({
          where: {
            org_id: ctx.orgId,
            cycle_id,
            target_period_start: targetPeriodStart,
            target_period_end: targetPeriodEnd,
            set_method,
          },
        });
        if (!existingAfterRace) throw err;
        return {
          kind: 'success' as const,
          data: existingAfterRace,
          replayed: true,
        };
      }

      // Advance cycle status to setting only for a newly-created plan.
      try {
        await transitionCycleStatus(tx, cycle_id, ctx.orgId, 'setting', ctx.userId);
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          throw new SetPlanRollback({
            kind: 'error' as const,
            message: `ステータス遷移が不正です: ${err.fromStatus} → ${err.toStatus}`,
          });
        }
        if (err instanceof VersionConflictError) {
          throw new SetPlanRollback({ kind: 'conflict' as const, message: err.message });
        }
        throw err;
      }

      return {
        kind: 'success' as const,
        data: plan,
        replayed: false,
      };
    }).catch((err: unknown) => {
      if (err instanceof SetPlanRollback) return err.result;
      throw err;
    });

    if (result.kind === 'error') {
      return validationError(result.message);
    }
    if (result.kind === 'conflict') {
      return conflict(result.message);
    }

    if (!result.replayed) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        eventType: 'cycle_transition',
        payload: { source: 'set_plans', cycle_id },
      });
    }

    return success({ data: result.data, replayed: result.replayed }, result.replayed ? 200 : 201);
  },
  {
    permission: 'canSet',
    message: 'セット計画の作成権限がありません',
  },
);
