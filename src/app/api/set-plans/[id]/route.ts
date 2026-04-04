import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildSetPlanPackagingSummary } from '@/lib/prescription/set-plan-packaging';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const updateSetPlanSchema = z.object({
  target_period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  target_period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  set_method: z
    .enum(['facility_calendar', 'four_times_daily', 'bedtime_only', 'custom'], {
      error: 'セット方式を選択してください',
    })
    .optional(),
  packaging_method_id: z.string().nullable().optional(),
  notes: z.string().optional(),
});

const setPlanSelect = {
  id: true,
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
          id: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
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
      prescription_intakes: {
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          prescribed_date: true,
          prescriber_name: true,
          updated_at: true,
          lines: {
            orderBy: { line_number: 'asc' },
            select: {
              id: true,
              line_number: true,
              drug_name: true,
              drug_code: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              packaging_method: true,
              dosage_form: true,
              packaging_instructions: true,
              packaging_instruction_tags: true,
              notes: true,
            },
          },
        },
      },
      inquiries: {
        where: {
          OR: [{ result: null }, { result: 'pending' }],
        },
        select: {
          id: true,
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
      approved_scope: true,
      reject_reason: true,
      audited_at: true,
    },
  },
  batches: {
    select: {
      id: true,
      updated_at: true,
    },
  },
  change_logs: {
    orderBy: { created_at: 'desc' },
    take: 20,
    select: {
      id: true,
      action: true,
      trigger_source: true,
      reason: true,
      line_ids: true,
      before_snapshot: true,
      after_snapshot: true,
      changed_by: true,
      created_at: true,
      batch_id: true,
    },
  },
} satisfies Prisma.SetPlanSelect;

export const GET = withAuthContext<{ id: string }>(
  async (
    _req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>
  ) => {
    const { id } = await routeContext.params;

    const plan = await prisma.setPlan.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: setPlanSelect,
    });

    if (!plan) {
      return notFound('セットプランが見つかりません');
    }

    const latestBatchUpdatedAt = plan.batches?.reduce<string | null>((latest, batch) => {
      const current = batch.updated_at.toISOString();
      return !latest || current > latest ? current : latest;
    }, null);
    const staleLineIds = latestBatchUpdatedAt
      ? Array.from(
          new Set(
            plan.cycle.prescription_intakes
              .filter((intake) => intake.updated_at.toISOString() > latestBatchUpdatedAt)
              .flatMap((intake) => intake.lines.map((line) => line.id))
          )
        )
      : [];

    return success({
      data: {
        ...plan,
        stale_line_ids: staleLineIds,
      },
    });
  },
  { permission: 'canSet' }
);

export const PATCH = withAuthContext<{ id: string }>(
  async (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>
  ) => {
    const { id } = await routeContext.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateSetPlanSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return validationError('更新項目がありません');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.setPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
        },
        select: {
          id: true,
          target_period_start: true,
          target_period_end: true,
          set_method: true,
          notes: true,
          packaging_method_id: true,
          cycle: {
            select: {
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
          },
        },
      });

      if (!existing) {
        return null;
      }

      const packagingMethod =
        updates.packaging_method_id === undefined
          ? existing.packaging_method_id
            ? await tx.packagingMethodMaster.findFirst({
                where: {
                  id: existing.packaging_method_id,
                  org_id: ctx.orgId,
                },
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              })
            : null
          : updates.packaging_method_id
            ? await tx.packagingMethodMaster.findFirst({
                where: {
                  id: updates.packaging_method_id,
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

      if (updates.packaging_method_id && !packagingMethod) {
        return {
          kind: 'error' as const,
          message: '指定された配薬方法マスタが見つかりません',
        };
      }

      const resolvedPeriodStart =
        updates.target_period_start ?? existing.target_period_start.toISOString().slice(0, 10);
      const resolvedPeriodEnd =
        updates.target_period_end ?? existing.target_period_end.toISOString().slice(0, 10);
      if (resolvedPeriodEnd < resolvedPeriodStart) {
        return {
          kind: 'error' as const,
          message: '終了日は開始日以降を指定してください',
        };
      }

      const resolvedSetMethod = updates.set_method ?? existing.set_method;
      const resolvedNotes = updates.notes !== undefined ? updates.notes || null : existing.notes;
      const packagingSummary = buildSetPlanPackagingSummary({
        setMethod: resolvedSetMethod,
        packagingMethod,
        patientPackagingProfile: existing.cycle.case_?.patient.packaging_profile ?? null,
      });

      const updated = await tx.setPlan.update({
        where: { id },
        data: {
          ...(updates.target_period_start
            ? { target_period_start: new Date(updates.target_period_start) }
            : {}),
          ...(updates.target_period_end
            ? { target_period_end: new Date(updates.target_period_end) }
            : {}),
          ...(updates.set_method ? { set_method: updates.set_method } : {}),
          ...(updates.packaging_method_id !== undefined
            ? { packaging_method_id: updates.packaging_method_id || null }
            : {}),
          packaging_summary_snapshot: packagingSummary,
          notes: resolvedNotes,
        },
        select: setPlanSelect,
      });

      return {
        kind: 'success' as const,
        data: updated,
      };
    });

    if (!result) {
      return notFound('セットプランが見つかりません');
    }

    if (result.kind === 'error') {
      return validationError(result.message);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_plans_update', plan_id: id },
    });

    return success({ data: result.data });
  },
  { permission: 'canSet' }
);
