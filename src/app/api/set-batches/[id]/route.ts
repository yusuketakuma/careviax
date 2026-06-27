import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/dispensing/set-batch-history';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildSetBatchAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const updateSetBatchSchema = z.object({
  quantity: z.number().positive('数量は正の数です').optional(),
  carry_type: z
    .enum(['carry', 'facility_deposit', 'deferred'], { error: '持参区分を選択してください' })
    .optional(),
  slot: z
    .enum(['morning', 'noon', 'evening', 'bedtime', 'prn'], { error: 'スロットを選択してください' })
    .optional(),
  version: z.number().int().min(1, 'バージョンは1以上の整数です'),
});

const MUTABLE_SET_BATCH_CYCLE_STATUS = 'setting';

function immutableSetBatchConflict(currentStatus: string) {
  return conflict(
    'セット作業中以外のセットバッチは直接編集できません。差戻し後に再作業してください',
    {
      current_status: currentStatus,
      required_status: MUTABLE_SET_BATCH_CYCLE_STATUS,
    },
  );
}

type DeleteSetBatchResult = { success: true } | { error: string; conflict: true };

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const assignmentWhere = buildSetBatchAssignmentWhere(ctx);

    const batch = await prisma.setBatch.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
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

    if (!batch) return notFound('セットバッチが見つかりません');

    return success({ data: batch });
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

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateSetBatchSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { version, ...updates } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const assignmentWhere = buildSetBatchAssignmentWhere(ctx);
      const existing = await tx.setBatch.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        include: {
          plan: {
            select: {
              cycle: { select: { overall_status: true } },
            },
          },
          line: {
            select: {
              id: true,
              drug_name: true,
            },
          },
        },
      });

      if (!existing) return null;
      if (existing.plan.cycle.overall_status !== MUTABLE_SET_BATCH_CYCLE_STATUS) {
        return {
          error: 'invalid_status',
          conflict: true,
          currentStatus: existing.plan.cycle.overall_status,
        } as const;
      }

      if (existing.version !== version) {
        return {
          error: '他のユーザーによって更新されています。再読み込みしてください',
          conflict: true,
        } as const;
      }

      const beforeSnapshot = buildSetBatchHistorySnapshot(existing);

      const updateResult = await tx.setBatch.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          version,
          plan: { cycle: { overall_status: MUTABLE_SET_BATCH_CYCLE_STATUS } },
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        data: {
          ...updates,
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        return {
          error: '他のユーザーによって更新されています。再読み込みしてください',
          conflict: true,
        } as const;
      }

      const updated = await tx.setBatch.findFirst({
        where: { id, org_id: ctx.orgId },
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
      if (!updated) return null;

      await createSetBatchChangeLog(tx, {
        orgId: ctx.orgId,
        planId: updated.plan_id,
        batchId: updated.id,
        action: 'manual_update',
        triggerSource: 'manual_edit',
        reason: 'セットバッチを手動更新',
        lineIds: [updated.line_id],
        beforeSnapshot: [beforeSnapshot],
        afterSnapshot: [buildSetBatchHistorySnapshot(updated)],
        changedBy: ctx.userId,
      });

      return updated;
    });

    if (!result) return notFound('セットバッチが見つかりません');
    if (typeof result === 'object' && 'error' in result) {
      if (result.error === 'invalid_status') return immutableSetBatchConflict(result.currentStatus);
      if ('conflict' in result && result.conflict) return conflict(result.error);
      return validationError(result.error);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_batches_update', plan_id: result.plan_id, batch_id: result.id },
    });

    return success({ data: result });
  },
  { permission: 'canSet' },
);

export const DELETE = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const versionParam = new URL(req.url).searchParams.get('version');
    const version = versionParam == null ? NaN : Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return validationError('削除には現在のバージョン(version)が必要です');
    }
    const assignmentWhere = buildSetBatchAssignmentWhere(ctx);

    const existing = await prisma.setBatch.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      include: {
        plan: {
          select: {
            cycle: { select: { overall_status: true } },
          },
        },
        line: {
          select: {
            id: true,
            drug_name: true,
          },
        },
      },
    });

    if (!existing) return notFound('セットバッチが見つかりません');
    if (existing.plan.cycle.overall_status !== MUTABLE_SET_BATCH_CYCLE_STATUS) {
      return immutableSetBatchConflict(existing.plan.cycle.overall_status);
    }

    const deleteResult: DeleteSetBatchResult = await withOrgContext(ctx.orgId, async (tx) => {
      const deleteResult = await tx.setBatch.deleteMany({
        where: {
          id,
          org_id: ctx.orgId,
          version,
          plan: { cycle: { overall_status: MUTABLE_SET_BATCH_CYCLE_STATUS } },
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
      });
      if (deleteResult.count === 0) {
        return {
          error: '他のユーザーによって更新されています。再読み込みしてください',
          conflict: true,
        } as const;
      }
      await createSetBatchChangeLog(tx, {
        orgId: ctx.orgId,
        planId: existing.plan_id,
        batchId: existing.id,
        action: 'manual_delete',
        triggerSource: 'manual_edit',
        reason: 'セットバッチを削除',
        lineIds: [existing.line_id],
        beforeSnapshot: [buildSetBatchHistorySnapshot(existing)],
        afterSnapshot: [],
        changedBy: ctx.userId,
      });

      return { success: true as const };
    });

    if (!('success' in deleteResult)) {
      if ('conflict' in deleteResult && deleteResult.conflict) return conflict(deleteResult.error);
      return validationError(deleteResult.error);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_batches_delete', plan_id: existing.plan_id, batch_id: existing.id },
    });

    return success({ data: { id } });
  },
  { permission: 'canSet' },
);
