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
} from '@/lib/dispensing/set-batch-history';
import { buildSetPlanPackagingSummary } from '@/lib/dispensing/set-plan-packaging';
import {
  collectNarcoticCandidateYjCode,
  handlingTagsWithMasterNarcotic,
} from '@/lib/prescription/controlled-handling-tags';
import {
  extractPackagingInstructionTags,
  resolveEffectivePackagingInstructionTags,
  resolvePackagingSettings,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/dispensing/packaging';
import { parseFrequencyToSlots } from '@/lib/dispensing/packaging-group';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildSetPlanAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const generateBatchesSchema = z.object({
  force: z.boolean().optional().default(false),
  expected_updated_at: z.string().datetime('セットプランの版情報が不正です').optional(),
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

function latestDate(...values: Array<Date | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    if (!value) return latest;
    if (!latest || value > latest) return value;
    return latest;
  }, null);
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

async function findLatestSetInputUpdatedAt(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string;
    cycleId: string;
    lineIds: string[];
    latestIntakeUpdatedAt: Date | null;
  },
) {
  if (input.lineIds.length === 0) return input.latestIntakeUpdatedAt;

  const latestApprovedResult = await tx.dispenseResult.findFirst({
    where: {
      org_id: input.orgId,
      line_id: { in: input.lineIds },
      task: {
        cycle_id: input.cycleId,
        audits: {
          some: {
            org_id: input.orgId,
            result: { in: ['approved', 'emergency_approved'] },
          },
        },
      },
    },
    orderBy: { updated_at: 'desc' },
    select: { updated_at: true },
  });

  const latestDecisionByUpdatedAt = await tx.dispensingDecision.findFirst({
    where: {
      org_id: input.orgId,
      line_id: { in: input.lineIds },
      task: { cycle_id: input.cycleId },
    },
    orderBy: { updated_at: 'desc' },
    select: { updated_at: true },
  });

  const latestDecisionByDecidedAt = await tx.dispensingDecision.findFirst({
    where: {
      org_id: input.orgId,
      line_id: { in: input.lineIds },
      task: { cycle_id: input.cycleId },
    },
    orderBy: { decided_at: 'desc' },
    select: { decided_at: true },
  });

  return latestDate(
    input.latestIntakeUpdatedAt,
    latestApprovedResult?.updated_at,
    latestDecisionByUpdatedAt?.updated_at,
    latestDecisionByDecidedAt?.decided_at,
  );
}

function latestSetBatchUpdatedAt(batches: Array<{ updated_at: Date }>) {
  return latestDate(...batches.map((batch) => batch.updated_at));
}

function isSetInputNewerThanBatch(input: {
  latestSetInputUpdatedAt: Date | null;
  latestBatchUpdatedAt: Date | null;
}) {
  return (
    input.latestSetInputUpdatedAt != null &&
    input.latestBatchUpdatedAt != null &&
    input.latestSetInputUpdatedAt > input.latestBatchUpdatedAt
  );
}

function staleSetBatchReuseResult() {
  return {
    kind: 'error' as const,
    message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
  };
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

    const { force, expected_updated_at: expectedUpdatedAt } = parsed.data;
    const assignmentWhere = buildSetPlanAssignmentWhere(ctx);

    if (force && !expectedUpdatedAt) {
      return validationError('強制再生成にはセットプランの版情報(expected_updated_at)が必要です');
    }

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

    if (expectedUpdatedAt && plan.updated_at.toISOString() !== expectedUpdatedAt) {
      return conflict(
        'セットプランが他のユーザーによって更新されています。再読み込みしてください',
        {
          current_updated_at: plan.updated_at.toISOString(),
          expected_updated_at: expectedUpdatedAt,
        },
      );
    }

    const intakes = await prisma.prescriptionIntake.findMany({
      where: { cycle_id: plan.cycle_id, org_id: ctx.orgId },
      orderBy: { created_at: 'desc' },
      take: 1,
      select: {
        updated_at: true,
        lines: {
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            frequency: true,
            quantity: true,
            unit: true,
            packaging_group_id: true,
            packaging_method: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
            dispensing_decisions: {
              where: {
                org_id: ctx.orgId,
                task: { cycle_id: plan.cycle_id },
              },
              orderBy: { decided_at: 'desc' },
              take: 1,
              select: {
                packaging_method: true,
                packaging_instructions: true,
                packaging_instruction_tags: true,
                packaging_group_id: true,
                carry_type_override: true,
                decided_at: true,
                updated_at: true,
              },
            },
            dispense_results: {
              where: {
                org_id: ctx.orgId,
                task: {
                  cycle_id: plan.cycle_id,
                  audits: {
                    some: {
                      org_id: ctx.orgId,
                      result: { in: ['approved', 'emergency_approved'] },
                    },
                  },
                },
              },
              orderBy: { dispensed_at: 'desc' },
              take: 1,
              select: {
                id: true,
                actual_drug_code: true,
                actual_quantity: true,
                actual_unit: true,
                updated_at: true,
              },
            },
          },
        },
      },
    });

    const latestIntake = intakes[0] ?? null;
    const allLines = latestIntake?.lines ?? [];
    const latestIntakeUpdatedAt = latestIntake?.updated_at ?? null;
    const lineIds = allLines.map((line) => line.id);

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
        const latestSetInputUpdatedAt = await findLatestSetInputUpdatedAt(tx, {
          orgId: ctx.orgId,
          cycleId: plan.cycle_id,
          lineIds,
          latestIntakeUpdatedAt,
        });
        const existingCount = await tx.setBatch.count({
          where: { plan_id: id, org_id: ctx.orgId },
        });

        if (existingCount > 0 && !force) {
          const latestBatch = await tx.setBatch.findFirst({
            where: { plan_id: id, org_id: ctx.orgId },
            orderBy: { updated_at: 'desc' },
            select: { updated_at: true },
          });
          if (
            isSetInputNewerThanBatch({
              latestSetInputUpdatedAt,
              latestBatchUpdatedAt: latestBatch?.updated_at ?? null,
            })
          ) {
            return staleSetBatchReuseResult();
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

        const planUpdate = await tx.setPlan.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            ...(expectedUpdatedAt ? { updated_at: new Date(expectedUpdatedAt) } : {}),
          },
          data: {
            packaging_summary_snapshot: packagingSummary,
          },
        });
        if (planUpdate.count === 0) {
          return {
            kind: 'conflict' as const,
            message: 'セットプランが他のユーザーによって更新されています。再読み込みしてください',
            details: { expected_updated_at: expectedUpdatedAt },
          } as const;
        }

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
          packaging_group_id: string | null;
        }[] = [];

        const narcoticCandidateYjCodes = new Set<string>();
        for (const line of allLines) {
          const decision = line.dispensing_decisions?.[0] ?? null;
          const auditedResult = line.dispense_results?.[0] ?? null;
          collectNarcoticCandidateYjCode(
            narcoticCandidateYjCodes,
            resolveEffectivePackagingInstructionTags(
              decision?.packaging_instruction_tags,
              line.packaging_instruction_tags,
            ),
            line.drug_code,
            auditedResult?.actual_drug_code,
          );
        }
        const narcoticMasters =
          narcoticCandidateYjCodes.size > 0
            ? await tx.drugMaster.findMany({
                where: { yj_code: { in: [...narcoticCandidateYjCodes] }, is_narcotic: true },
                select: { yj_code: true },
              })
            : [];
        const narcoticYjCodes = new Set(narcoticMasters.map((master) => master.yj_code));

        for (const line of allLines) {
          const decision = line.dispensing_decisions?.[0] ?? null;
          const auditedResult = line.dispense_results?.[0] ?? null;
          if (!auditedResult) {
            return {
              kind: 'error' as const,
              message: `監査済み調剤結果がない処方があります: ${line.drug_name}`,
            } as const;
          }
          const packagingMethod = decision?.packaging_method ?? line.packaging_method ?? undefined;
          const packagingInstructions =
            decision?.packaging_instructions ?? line.packaging_instructions ?? undefined;
          const packagingInstructionTags = resolveEffectivePackagingInstructionTags(
            decision?.packaging_instruction_tags,
            line.packaging_instruction_tags,
          );
          const packagingGroupId = decision?.packaging_group_id ?? line.packaging_group_id ?? null;
          const slots = resolveSlotsForMethod({
            frequency: line.frequency,
            setMethod: plan.set_method,
          });
          const quantityPerSlot = resolveQuantityPerSlot({
            totalQuantity: auditedResult.actual_quantity,
            totalDays,
            slotCount: slots.length,
          });
          if (quantityPerSlot == null) {
            return {
              kind: 'error' as const,
              message: `セット数量を計算できない処方があります: ${line.drug_name}`,
            } as const;
          }
          const carryType =
            decision?.carry_type_override ?? resolveCarryType(line.notes, packagingInstructions);
          const resolvedPackaging = resolvePackagingSettings({
            packagingMethod,
            packagingInstructions,
            profile: patientPackagingProfile,
          });
          const basePackagingTags =
            packagingInstructionTags.length > 0
              ? packagingInstructionTags
              : extractPackagingInstructionTags({
                  packagingInstructions: resolvedPackaging.packaging_instructions,
                  notes: line.notes,
                  packagingMethod: resolvedPackaging.packaging_method,
                });
          const packagingTags = handlingTagsWithMasterNarcotic(
            basePackagingTags,
            narcoticYjCodes,
            line.drug_code,
            auditedResult.actual_drug_code,
          );

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
                packaging_group_id: packagingGroupId,
              });
            }
          }
        }

        const concurrentlyCreated = force ? [] : await findExistingSetBatches(tx, id, ctx.orgId);
        if (concurrentlyCreated.length > 0) {
          if (
            isSetInputNewerThanBatch({
              latestSetInputUpdatedAt,
              latestBatchUpdatedAt: latestSetBatchUpdatedAt(concurrentlyCreated),
            })
          ) {
            return staleSetBatchReuseResult();
          }
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
            force && latestSetInputUpdatedAt
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
    if ('kind' in result && result.kind === 'conflict') {
      return conflict(result.message, result.details);
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
