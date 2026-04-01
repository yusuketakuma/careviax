import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/prescription/set-batch-history';
import {
  extractPackagingInstructionTags,
  resolvePackagingSettings,
} from '@/lib/prescription/packaging';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
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

export const GET = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id');

    if (!planId) {
      return validationError('plan_id は必須パラメータです');
    }

    const batches = await prisma.setBatch.findMany({
      where: { plan_id: planId, org_id: ctx.orgId },
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
  { permission: 'canSet' }
);

export const POST = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext): Promise<NextResponse> => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createSetBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { plan_id, line_id, slot, day_number, quantity, carry_type } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const plan = await tx.setPlan.findFirst({
        where: { id: plan_id, org_id: ctx.orgId },
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

      const line = await tx.prescriptionLine.findFirst({
        where: { id: line_id, org_id: ctx.orgId },
        select: {
          id: true,
          drug_name: true,
          packaging_method: true,
          packaging_instructions: true,
          packaging_instruction_tags: true,
          notes: true,
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

      const duplicate = await tx.setBatch.findFirst({
        where: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
          slot,
          day_number,
          carry_type,
        },
        select: { id: true },
      });
      if (duplicate) {
        return {
          kind: 'error' as const,
          response: conflict('同じ処方ライン・スロット・日付のセットバッチがすでに存在します'),
        };
      }

      const resolvedPackaging = resolvePackagingSettings({
        packagingMethod: line.packaging_method ?? undefined,
        packagingInstructions: line.packaging_instructions ?? undefined,
        profile: plan.cycle.case_?.patient.packaging_profile ?? null,
      });
      const packagingTags =
        line.packaging_instruction_tags.length > 0
          ? line.packaging_instruction_tags
          : extractPackagingInstructionTags({
              packagingInstructions: resolvedPackaging.packaging_instructions,
              notes: line.notes,
              packagingMethod: resolvedPackaging.packaging_method,
            });

      const batch = await tx.setBatch.create({
        data: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
          slot,
          day_number,
          quantity,
          carry_type,
          packaging_method_snapshot: resolvedPackaging.packaging_method,
          packaging_instructions_snapshot: resolvedPackaging.packaging_instructions,
          packaging_instruction_tags_snapshot: packagingTags,
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
  { permission: 'canSet' }
);
