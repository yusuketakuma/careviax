import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/prescription/set-batch-history';
import {
  collectNarcoticCandidateYjCode,
  handlingTagsWithMasterNarcotic,
} from '@/lib/prescription/controlled-handling-tags';
import {
  extractPackagingInstructionTags,
  resolvePackagingSettings,
} from '@/lib/prescription/packaging';
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

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const GET = withAuthContext<Record<string, string>>(
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

export const POST = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext): Promise<NextResponse> => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createSetBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { plan_id, line_id, slot, day_number, quantity, carry_type } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
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
        return {
          kind: 'error' as const,
          response: conflict('同じ処方ライン・スロット・日付のセットバッチがすでに存在します'),
        };
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
