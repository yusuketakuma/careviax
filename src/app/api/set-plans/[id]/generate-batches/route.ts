import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  collectChangedLineIds,
  createSetBatchChangeLog,
} from '@/lib/prescription/set-batch-history';
import { buildSetPlanPackagingSummary } from '@/lib/prescription/set-plan-packaging';
import {
  extractPackagingInstructionTags,
  resolvePackagingSettings,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/prescription/packaging';
import { parseFrequencyToSlots } from '@/lib/dispensing/packaging-group';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildSetPlanAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const generateBatchesSchema = z.object({
  force: z.boolean().optional().default(false),
});

const SET_BATCH_GENERATE_SERIALIZABLE_RETRY_LIMIT = 3;

class SetBatchGenerateRetryLimitError extends Error {
  constructor() {
    super('set batch generation transaction retry limit exceeded');
    this.name = 'SetBatchGenerateRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableSetBatchGenerateTransaction<T>(
  orgId: string,
  requestContext: AuthContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < SET_BATCH_GENERATE_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        requestContext,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === SET_BATCH_GENERATE_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new SetBatchGenerateRetryLimitError();
      }
    }
  }

  throw new SetBatchGenerateRetryLimitError();
}

function resolveCarryType(
  notes: string | null | undefined,
  packagingInstructions: string | null | undefined,
) {
  const detail = `${notes ?? ''} ${packagingInstructions ?? ''}`;
  if (/施設預け|施設保管|預け/.test(detail)) return 'facility_deposit';
  if (/後送|配送|後日持参/.test(detail)) return 'deferred';
  return 'carry';
}

function resolveSlotsForMethod(args: { frequency: string; setMethod: string }) {
  const baseSlots = parseFrequencyToSlots(args.frequency);
  if (baseSlots.includes('prn')) return ['prn'];
  if (args.setMethod === 'bedtime_only') return ['bedtime'];
  if (args.setMethod === 'four_times_daily') {
    return ['morning', 'noon', 'evening', 'bedtime'];
  }
  return baseSlots;
}

function diffInDays(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
}

function resolveQuantityPerSlot(args: {
  totalQuantity: number | null;
  totalDays: number;
  slotCount: number;
}) {
  if (args.totalQuantity == null) return 1;
  const administrationCount = args.totalDays * args.slotCount;
  if (administrationCount <= 0) return null;
  const quantity = args.totalQuantity / administrationCount;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

async function findExistingSetBatches(tx: Prisma.TransactionClient, planId: string, orgId: string) {
  return tx.setBatch.findMany({
    where: { plan_id: planId, org_id: orgId },
    orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
    include: {
      line: {
        select: {
          id: true,
          drug_name: true,
          dose: true,
          frequency: true,
          unit: true,
          packaging_method: true,
          packaging_instructions: true,
          packaging_instruction_tags: true,
        },
      },
    },
  });
}

export const POST = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const payload = await readOptionalJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateBatchesSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { force } = parsed.data;
    const assignmentWhere = buildSetPlanAssignmentWhere(ctx);

    const plan = await prisma.setPlan.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      select: {
        id: true,
        cycle_id: true,
        target_period_start: true,
        target_period_end: true,
        set_method: true,
        packaging_method_id: true,
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
            overall_status: true,
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

    if (!plan) return notFound('セットプランが見つかりません');

    const intakes = await prisma.prescriptionIntake.findMany({
      where: { cycle_id: plan.cycle_id, org_id: ctx.orgId },
      select: {
        updated_at: true,
        lines: {
          select: {
            id: true,
            drug_name: true,
            frequency: true,
            quantity: true,
            packaging_method: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
          },
        },
      },
    });

    const allLines = intakes.flatMap((intake) => intake.lines);

    if (allLines.length === 0) {
      return validationError('処方ラインが存在しません。処方を先に登録してください');
    }

    if (!['audited', 'setting', 'set_audited'].includes(plan.cycle.overall_status)) {
      return validationError('鑑査未承認のサイクルはセットできません');
    }
    if (force && plan.cycle.overall_status === 'set_audited') {
      return validationError(
        'セット監査後の再生成は訪問持参物と不整合になるため実行できません。差戻し後に再生成してください',
      );
    }

    const lineWithoutFrequency = allLines.find((line) => line.frequency.trim().length === 0);
    if (lineWithoutFrequency) {
      return validationError(
        `投与タイミング未定義の処方があります: ${lineWithoutFrequency.drug_name}`,
      );
    }

    const totalDays = diffInDays(plan.target_period_start, plan.target_period_end);
    if (totalDays <= 0) {
      return validationError('対象期間が不正です（終了日が開始日より前です）');
    }

    let result;
    try {
      result = await withSerializableSetBatchGenerateTransaction(ctx.orgId, ctx, async (tx) => {
        const existingCount = await tx.setBatch.count({
          where: { plan_id: id, org_id: ctx.orgId },
        });
        const latestIntakeUpdatedAt = intakes.reduce<Date | null>((latest, intake) => {
          if (!latest || intake.updated_at > latest) return intake.updated_at;
          return latest;
        }, null);

        if (existingCount > 0 && !force) {
          const latestBatch = await tx.setBatch.findFirst({
            where: { plan_id: id, org_id: ctx.orgId },
            orderBy: { updated_at: 'desc' },
            select: { updated_at: true },
          });
          if (
            latestBatch &&
            latestIntakeUpdatedAt &&
            latestIntakeUpdatedAt > latestBatch.updated_at
          ) {
            return {
              kind: 'error' as const,
              message: '処方変更があるため、影響セットを再確認して再生成してください',
            } as const;
          }
          const existing = await findExistingSetBatches(tx, id, ctx.orgId);

          return { count: existing.length, batches: existing, reused: true as const };
        }

        const patientPackagingProfile = plan.cycle.case_?.patient.packaging_profile ?? null;
        const packagingSummary = buildSetPlanPackagingSummary({
          setMethod: plan.set_method,
          packagingMethod: plan.packaging_method_ref ?? null,
          patientPackagingProfile,
        });

        await tx.setPlan.update({
          where: { id },
          data: {
            packaging_summary_snapshot: packagingSummary,
          },
        });

        let regenerationBeforeSnapshots: ReturnType<typeof buildSetBatchHistorySnapshot>[] = [];
        if (force) {
          const existingBatches = await tx.setBatch.findMany({
            where: { plan_id: id, org_id: ctx.orgId },
            orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
            include: {
              line: {
                select: {
                  id: true,
                  drug_name: true,
                },
              },
            },
          });
          regenerationBeforeSnapshots = existingBatches.map((batch) =>
            buildSetBatchHistorySnapshot(batch),
          );
          await tx.setBatch.deleteMany({
            where: { plan_id: id, org_id: ctx.orgId },
          });
        }

        const batchData: {
          org_id: string;
          plan_id: string;
          line_id: string;
          slot: string;
          day_number: number;
          quantity: number;
          carry_type: string;
          packaging_method_snapshot: PackagingMethodValue | null;
          packaging_instructions_snapshot: string | null;
          packaging_instruction_tags_snapshot: PackagingInstructionTagValue[];
        }[] = [];

        for (const line of allLines) {
          const slots = resolveSlotsForMethod({
            frequency: line.frequency,
            setMethod: plan.set_method,
          });
          const quantityPerSlot = resolveQuantityPerSlot({
            totalQuantity: line.quantity,
            totalDays,
            slotCount: slots.length,
          });
          if (quantityPerSlot == null) {
            return {
              kind: 'error' as const,
              message: `セット数量を計算できない処方があります: ${line.drug_name}`,
            } as const;
          }
          const carryType = resolveCarryType(line.notes, line.packaging_instructions);
          const resolvedPackaging = resolvePackagingSettings({
            packagingMethod: line.packaging_method ?? undefined,
            packagingInstructions: line.packaging_instructions ?? undefined,
            profile: patientPackagingProfile,
          });
          const packagingTags =
            line.packaging_instruction_tags.length > 0
              ? line.packaging_instruction_tags
              : extractPackagingInstructionTags({
                  packagingInstructions: resolvedPackaging.packaging_instructions,
                  notes: line.notes,
                  packagingMethod: resolvedPackaging.packaging_method,
                });

          for (let day = 1; day <= totalDays; day++) {
            for (const slot of slots) {
              batchData.push({
                org_id: ctx.orgId,
                plan_id: id,
                line_id: line.id,
                slot,
                day_number: day,
                quantity: quantityPerSlot,
                carry_type: carryType,
                packaging_method_snapshot: resolvedPackaging.packaging_method,
                packaging_instructions_snapshot: resolvedPackaging.packaging_instructions,
                packaging_instruction_tags_snapshot: packagingTags,
              });
            }
          }
        }

        const concurrentlyCreated = force ? [] : await findExistingSetBatches(tx, id, ctx.orgId);
        if (concurrentlyCreated.length > 0) {
          return {
            count: concurrentlyCreated.length,
            batches: concurrentlyCreated,
            reused: true as const,
          };
        }

        await tx.setBatch.createMany({ data: batchData });

        const created = await findExistingSetBatches(tx, id, ctx.orgId);

        const afterSnapshots = created.map((batch) => buildSetBatchHistorySnapshot(batch));
        await createSetBatchChangeLog(tx, {
          orgId: ctx.orgId,
          planId: id,
          action: force ? 'regenerated' : 'generated',
          triggerSource:
            force && latestIntakeUpdatedAt
              ? 'prescription_update'
              : force
                ? 'manual_generate'
                : 'initial_generate',
          reason: force ? 'セットバッチを再生成' : 'セットバッチを初回生成',
          lineIds: collectChangedLineIds({
            before: regenerationBeforeSnapshots,
            after: afterSnapshots,
          }),
          beforeSnapshot: regenerationBeforeSnapshots,
          afterSnapshot: afterSnapshots,
          changedBy: ctx.userId,
        });

        return { count: batchData.length, batches: created, reused: false as const };
      });
    } catch (cause) {
      if (cause instanceof SetBatchGenerateRetryLimitError) {
        return conflict(
          'セット生成が他の更新と競合しました。最新データを取得して再試行してください',
        );
      }
      throw cause;
    }

    if ('kind' in result && result.kind === 'error') {
      return validationError(result.message);
    }

    if (!result.reused) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        payload: { source: 'set_batches_generate', plan_id: id },
      });
    }

    return success({ data: result }, result.reused ? 200 : 201);
  },
  { permission: 'canSet' },
);
