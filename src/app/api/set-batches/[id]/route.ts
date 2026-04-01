import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/prescription/set-batch-history';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
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

export const GET = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const batch = await prisma.setBatch.findFirst({
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

    if (!batch) return notFound('セットバッチが見つかりません');

    return success({ data: batch });
  },
  { permission: 'canSet' }
);

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateSetBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { version, ...updates } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.setBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        include: {
          line: {
            select: {
              id: true,
              drug_name: true,
            },
          },
        },
      });

      if (!existing) return null;

      if (existing.version !== version) {
        return { error: '他のユーザーによって更新されています。再読み込みしてください', conflict: true } as const;
      }

      const beforeSnapshot = buildSetBatchHistorySnapshot(existing);

      const updated = await tx.setBatch.update({
        where: { id },
        data: {
          ...updates,
          version: { increment: 1 },
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
      if ('conflict' in result && result.conflict) return conflict(result.error);
      return validationError(result.error);
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_batches_update', plan_id: result.plan_id, batch_id: result.id },
    });

    return success({ data: result });
  },
  { permission: 'canSet' }
);

export const DELETE = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const existing = await prisma.setBatch.findFirst({
      where: { id, org_id: ctx.orgId },
      include: {
        line: {
          select: {
            id: true,
            drug_name: true,
          },
        },
      },
    });

    if (!existing) return notFound('セットバッチが見つかりません');

    await withOrgContext(ctx.orgId, async (tx) => {
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
      await tx.setBatch.delete({ where: { id } });
    });

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'set_batches_delete', plan_id: existing.plan_id, batch_id: existing.id },
    });

    return success({ data: { id } });
  },
  { permission: 'canSet' }
);
