import { NextRequest, NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/dispensing/set-batch-history';
import {
  collectNarcoticCandidateYjCode,
  handlingTagsWithMasterNarcotic,
} from '@/lib/prescription/controlled-handling-tags';
import {
  extractPackagingInstructionTags,
  resolvePackagingSettings,
} from '@/lib/dispensing/packaging';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  buildSetBatchAssignmentWhere,
  buildSetPlanAssignmentWhere,
} from '@/server/services/prescription-access';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const createSetBatchSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  line_id: z.string().min(1, '処方ラインIDは必須です'),
  expected_updated_at: z.string().datetime('セットプランの版情報が不正です'),
  slot: z.enum(['morning', 'noon', 'evening', 'bedtime', 'prn'], {
    error: 'スロットを選択してください',
  }),
  day_number: z.number().int().min(1, '日数は1以上の整数です'),
  quantity: z.number().positive('数量は正の数です'),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred'], {
    error: '持参区分を選択してください',
  }),
});

const QUANTITY_TOLERANCE = 0.000001;
const MUTABLE_SET_BATCH_CYCLE_STATUS = 'setting';
const SET_BATCH_CREATE_SERIALIZABLE_RETRY_LIMIT = 3;

class SetBatchCreateRetryLimitError extends Error {
  constructor() {
    super('set batch create transaction retry limit exceeded');
    this.name = 'SetBatchCreateRetryLimitError';
  }
}

class SetBatchCreateRollback extends Error {
  constructor(readonly result: { kind: 'error'; response: NextResponse }) {
    super('set batch create rolled back');
    this.name = 'SetBatchCreateRollback';
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isSerializableTransactionConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

async function withSerializableSetBatchCreateTransaction<T>(
  orgId: string,
  ctx: AuthContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < SET_BATCH_CREATE_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        requestContext: ctx,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) {
        throw error;
      }
      if (attempt === SET_BATCH_CREATE_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new SetBatchCreateRetryLimitError();
      }
    }
  }

  throw new SetBatchCreateRetryLimitError();
}

const authenticatedGET = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id');

    if (!planId) {
      return validationError('plan_id は必須パラメータです');
    }

    const assignmentWhere = buildSetBatchAssignmentWhere(ctx);
    const batches = await prisma.setBatch.findMany({
      where: {
        plan_id: planId,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
      include: {
        line: {
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            unit: true,
            packaging_method: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
          },
        },
      },
    });

    return success({ data: batches });
  },
  { permission: 'canSet' },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext): Promise<NextResponse> => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createSetBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { plan_id, line_id, expected_updated_at, slot, day_number, quantity, carry_type } =
      parsed.data;
    const expectedUpdatedAt = new Date(expected_updated_at);

    const result = await withSerializableSetBatchCreateTransaction(ctx.orgId, ctx, async (tx) => {
      const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);
      const plan = await tx.setPlan.findFirst({
        where: {
          id: plan_id,
          org_id: ctx.orgId,
          ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
        },
        select: {
          id: true,
          cycle_id: true,
          updated_at: true,
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
      if (!plan) {
        return {
          kind: 'error' as const,
          response: notFound('指定されたセットプランが見つかりません'),
        };
      }
      if (plan.cycle.overall_status !== MUTABLE_SET_BATCH_CYCLE_STATUS) {
        return {
          kind: 'error' as const,
          response: conflict(
            'セット作業中以外のセットバッチは直接追加できません。差戻し後に再作業してください',
            {
              current_status: plan.cycle.overall_status,
              required_status: MUTABLE_SET_BATCH_CYCLE_STATUS,
            },
          ),
        };
      }
      if (plan.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
        return {
          kind: 'error' as const,
          response: conflict(
            'セットプランが他のユーザーによって更新されています。再読み込みしてください',
            {
              current_updated_at: plan.updated_at.toISOString(),
              expected_updated_at,
            },
          ),
        };
      }

      const latestIntake = await tx.prescriptionIntake.findFirst({
        where: { org_id: ctx.orgId, cycle_id: plan.cycle_id },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
      if (!latestIntake) {
        return {
          kind: 'error' as const,
          response: validationError('処方ラインが存在しません。処方を先に登録してください'),
        };
      }

      const line = await tx.prescriptionLine.findFirst({
        where: { id: line_id, org_id: ctx.orgId, intake_id: latestIntake.id },
        select: {
          id: true,
          drug_name: true,
          drug_code: true,
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
            },
          },
          intake: {
            select: {
              cycle_id: true,
            },
          },
        },
      });
      if (!line) {
        return {
          kind: 'error' as const,
          response: notFound('指定された処方ラインが見つかりません'),
        };
      }

      if (line.intake.cycle_id !== plan.cycle_id) {
        return {
          kind: 'error' as const,
          response: validationError('指定された処方ラインはこのセットプランに紐づいていません'),
        };
      }

      const auditedResult = line.dispense_results[0] ?? null;
      if (!auditedResult) {
        return {
          kind: 'error' as const,
          response: validationError('監査済み調剤結果がない処方ラインはセットに追加できません'),
        };
      }

      const duplicate = await tx.setBatch.findFirst({
        where: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
          slot,
          day_number,
        },
        select: { id: true },
      });
      if (duplicate) {
        return {
          kind: 'error' as const,
          response: conflict('同じ処方ライン・スロット・日付のセットバッチがすでに存在します'),
        };
      }

      const existingLineQuantity = await tx.setBatch.aggregate({
        where: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
        },
        _sum: {
          quantity: true,
        },
      });
      const currentLineQuantity = existingLineQuantity._sum.quantity ?? 0;
      if (currentLineQuantity + quantity - auditedResult.actual_quantity > QUANTITY_TOLERANCE) {
        return {
          kind: 'error' as const,
          response: validationError('セット数量が監査済み調剤実数量を超えています'),
        };
      }

      const planClaim = await tx.setPlan.updateMany({
        where: {
          id: plan_id,
          org_id: ctx.orgId,
          updated_at: expectedUpdatedAt,
          cycle: { overall_status: MUTABLE_SET_BATCH_CYCLE_STATUS },
          ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
        },
        data: { updated_at: new Date() },
      });
      if (planClaim.count === 0) {
        const currentPlan = await tx.setPlan.findFirst({
          where: {
            id: plan_id,
            org_id: ctx.orgId,
            ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
          },
          select: {
            updated_at: true,
            cycle: { select: { overall_status: true } },
          },
        });
        if (!currentPlan) {
          return {
            kind: 'error' as const,
            response: notFound('指定されたセットプランが見つかりません'),
          };
        }
        return {
          kind: 'error' as const,
          response: conflict(
            'セットプランが他のユーザーによって更新されています。再読み込みしてください',
            {
              current_updated_at: currentPlan.updated_at.toISOString(),
              current_status: currentPlan.cycle.overall_status,
              expected_updated_at,
            },
          ),
        };
      }

      const decision = line.dispensing_decisions[0] ?? null;
      const packagingMethod = decision?.packaging_method ?? line.packaging_method ?? undefined;
      const packagingInstructions =
        decision?.packaging_instructions ?? line.packaging_instructions ?? undefined;
      const packagingInstructionTags =
        decision?.packaging_instruction_tags ?? line.packaging_instruction_tags;
      const packagingGroupId = decision?.packaging_group_id ?? line.packaging_group_id ?? null;
      const effectiveCarryType = decision?.carry_type_override ?? carry_type;
      const resolvedPackaging = resolvePackagingSettings({
        packagingMethod,
        packagingInstructions,
        profile: plan.cycle.case_?.patient.packaging_profile ?? null,
      });
      const basePackagingTags =
        packagingInstructionTags.length > 0
          ? packagingInstructionTags
          : extractPackagingInstructionTags({
              packagingInstructions: resolvedPackaging.packaging_instructions,
              notes: line.notes,
              packagingMethod: resolvedPackaging.packaging_method,
            });
      const narcoticCandidateYjCodes = new Set<string>();
      collectNarcoticCandidateYjCode(
        narcoticCandidateYjCodes,
        basePackagingTags,
        line.drug_code,
        auditedResult.actual_drug_code,
      );
      const narcoticMasters =
        narcoticCandidateYjCodes.size > 0
          ? await tx.drugMaster.findMany({
              where: { yj_code: { in: [...narcoticCandidateYjCodes] }, is_narcotic: true },
              select: { yj_code: true },
            })
          : [];
      const narcoticYjCodes = new Set(narcoticMasters.map((master) => master.yj_code));
      const packagingTags = handlingTagsWithMasterNarcotic(
        basePackagingTags,
        narcoticYjCodes,
        line.drug_code,
        auditedResult.actual_drug_code,
      );

      let batch;
      try {
        batch = await tx.setBatch.create({
          data: {
            org_id: ctx.orgId,
            plan_id,
            line_id,
            slot,
            day_number,
            quantity,
            carry_type: effectiveCarryType,
            packaging_method_snapshot: resolvedPackaging.packaging_method,
            packaging_instructions_snapshot: resolvedPackaging.packaging_instructions,
            packaging_instruction_tags_snapshot: packagingTags,
            packaging_group_id: packagingGroupId,
          },
          include: {
            line: {
              select: {
                id: true,
                drug_name: true,
                drug_code: true,
                dosage_form: true,
                dose: true,
                frequency: true,
                unit: true,
                packaging_method: true,
                packaging_instructions: true,
                packaging_instruction_tags: true,
                notes: true,
              },
            },
          },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        throw new SetBatchCreateRollback({
          kind: 'error' as const,
          response: conflict('同じ処方ライン・スロット・日付のセットバッチがすでに存在します'),
        });
      }

      await createSetBatchChangeLog(tx, {
        orgId: ctx.orgId,
        planId: plan_id,
        batchId: batch.id,
        action: 'manual_create',
        triggerSource: 'manual_edit',
        reason: 'セットバッチを手動追加',
        lineIds: [line_id],
        beforeSnapshot: [],
        afterSnapshot: [buildSetBatchHistorySnapshot(batch)],
        changedBy: ctx.userId,
      });

      return { kind: 'success' as const, batch };
    }).catch((error: unknown) => {
      if (error instanceof SetBatchCreateRollback) return error.result;
      if (error instanceof SetBatchCreateRetryLimitError) {
        return {
          kind: 'error' as const,
          response: conflict(
            'セットバッチ作成が他の更新と競合しました。最新データを取得して再試行してください',
          ),
        };
      }
      throw error;
    });

    if (result.kind === 'error') return result.response;

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_batches_create', plan_id },
    });

    return success({ data: result.batch }, 201);
  },
  { permission: 'canSet' },
);
