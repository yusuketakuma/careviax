import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  buildSetBatchHistorySnapshot,
  createSetBatchChangeLog,
} from '@/lib/prescription/set-batch-history';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildSetPlanAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const HOLD_REASONS = [
  'prescription_change_wait',
  'doctor_confirm_wait',
  'residual_confirm_wait',
  'stock_shortage',
  'family_facility_confirm_wait',
  'onsite_set_at_visit',
  'other',
] as const;

const cellMutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    batch_id: z.string().min(1, 'セルIDは必須です'),
    expected_version: z.number().int().min(1),
  }),
  z.object({
    action: z.literal('hold'),
    batch_id: z.string().min(1, 'セルIDは必須です'),
    held_reason: z.enum(HOLD_REASONS, { error: '保留理由を選択してください' }),
    held_detail: z.string().max(1000).optional(),
    expected_version: z.number().int().min(1),
  }),
  z.object({
    action: z.literal('clear'),
    batch_id: z.string().min(1, 'セルIDは必須です'),
    expected_version: z.number().int().min(1),
  }),
]);

const batchInclude = {
  line: {
    select: {
      id: true,
      drug_name: true,
      dose: true,
      frequency: true,
      unit: true,
    },
  },
} as const;

const MUTABLE_SET_BATCH_CYCLE_STATUS = 'setting';

/**
 * PATCH /api/set-plans/[id]/batches/cell
 * お薬カレンダーのセル単位 set / hold / clear。
 * - 監査証跡(§12-5): set_by/set_at(サーバ時刻 = new Date())、AuditLog 追記(append-only)。
 * - 競合(§12-4): SetBatch.version を OCC アンカーとし updateMany WHERE version + count===0 で判定。
 *   expected_version 不一致は 409 WORKFLOW_CONFLICT + details(current)。
 */
export const PATCH = withAuthContext<{ id: string }>(
  async (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>,
  ): Promise<NextResponse> => {
    const { id: planId } = await routeContext.params;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = cellMutationSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const input = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const planAssignmentWhere = buildSetPlanAssignmentWhere(ctx);
      const plan = await tx.setPlan.findFirst({
        where: {
          id: planId,
          org_id: ctx.orgId,
          ...(planAssignmentWhere ? { AND: [planAssignmentWhere] } : {}),
        },
        select: { id: true, cycle: { select: { overall_status: true } } },
      });
      if (!plan) {
        return { kind: 'error' as const, response: notFound('セットプランが見つかりません') };
      }
      if (plan.cycle.overall_status !== MUTABLE_SET_BATCH_CYCLE_STATUS) {
        return {
          kind: 'error' as const,
          response: conflict(
            'セット監査後または訪問準備後のセットセルは直接変更できません。差戻し後に再作業してください',
            {
              current_status: plan.cycle.overall_status,
              required_status: MUTABLE_SET_BATCH_CYCLE_STATUS,
            },
          ),
        };
      }

      const batch = await tx.setBatch.findFirst({
        where: { id: input.batch_id, org_id: ctx.orgId, plan_id: planId },
        include: batchInclude,
      });
      if (!batch) {
        return {
          kind: 'error' as const,
          response: notFound('指定されたセルが見つかりません'),
        };
      }

      // 競合(§12-4): バージョン不一致は早期 409。最終判定は updateMany count===0。
      if (input.expected_version !== batch.version) {
        return {
          kind: 'error' as const,
          response: conflict(
            '他のユーザーによって更新されました。最新データを取得してから再試行してください',
            {
              current: {
                id: batch.id,
                version: batch.version,
                set_state: batch.set_state,
                audit_state: batch.audit_state,
              },
              expected_version: input.expected_version,
            },
          ),
        };
      }

      const beforeSnapshot = buildSetBatchHistorySnapshot(batch);
      const now = new Date();

      let data;
      let auditAction: string;
      let changeAction: string;
      if (input.action === 'set') {
        data = {
          set_state: 'set' as const,
          set_by: ctx.userId,
          set_at: now,
          held_reason: null,
          held_by: null,
          held_at: null,
          version: { increment: 1 },
        };
        auditAction = 'set_batch.cell_set';
        changeAction = 'cell_set';
      } else if (input.action === 'hold') {
        data = {
          set_state: 'hold' as const,
          held_reason: input.held_reason,
          held_by: ctx.userId,
          held_at: now,
          version: { increment: 1 },
        };
        auditAction = 'set_batch.cell_hold';
        changeAction = 'cell_hold';
      } else {
        // clear: 未セットへ戻す（保留解除を含む）
        data = {
          set_state: 'pending' as const,
          set_by: null,
          set_at: null,
          held_reason: null,
          held_by: null,
          held_at: null,
          version: { increment: 1 },
        };
        auditAction = 'set_batch.cell_clear';
        changeAction = 'cell_clear';
      }

      // OCC: updateMany WHERE version で TOCTOU 窓を閉じる。
      const updatedCount = await tx.setBatch.updateMany({
        where: {
          id: batch.id,
          org_id: ctx.orgId,
          plan_id: planId,
          version: batch.version,
          plan: { cycle: { overall_status: MUTABLE_SET_BATCH_CYCLE_STATUS } },
        },
        data,
      });
      if (updatedCount.count === 0) {
        return {
          kind: 'error' as const,
          response: conflict(
            '他のユーザーによって更新されました。最新データを取得してから再試行してください',
            {
              current: { id: batch.id, version: batch.version },
            },
          ),
        };
      }

      const updated = await tx.setBatch.findFirst({
        where: { id: batch.id, org_id: ctx.orgId, plan_id: planId },
        include: batchInclude,
      });
      if (!updated) {
        return { kind: 'error' as const, response: notFound('指定されたセルが見つかりません') };
      }

      const afterSnapshot = buildSetBatchHistorySnapshot(updated);
      await createSetBatchChangeLog(tx, {
        orgId: ctx.orgId,
        planId,
        batchId: updated.id,
        action: changeAction,
        triggerSource: 'workbench_cell',
        reason:
          input.action === 'set'
            ? 'セルをセット済にしました'
            : input.action === 'hold'
              ? 'セルを保留にしました'
              : 'セルを未セットに戻しました',
        lineIds: [updated.line_id],
        beforeSnapshot: [beforeSnapshot],
        afterSnapshot: [afterSnapshot],
        changedBy: ctx.userId,
      });

      // 監査証跡(§12-5): append-only AuditLog。inputUserId=set_by, サーバ時刻は AuditLog @default(now())。
      await createAuditLogEntry(tx, ctx, {
        action: auditAction,
        targetType: 'SetBatch',
        targetId: updated.id,
        changes: {
          plan_id: planId,
          line_id: updated.line_id,
          day_number: updated.day_number,
          slot: updated.slot,
          set_state: updated.set_state,
          ...(input.action === 'hold'
            ? { held_reason: input.held_reason, held_detail: input.held_detail ?? null }
            : {}),
          before: { set_state: batch.set_state, version: batch.version },
        },
      });

      return { kind: 'success' as const, batch: updated };
    });

    if (result.kind === 'error') return result.response;

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'set_batches_update', plan_id: planId, action: input.action },
    });

    return success({ data: result.batch });
  },
  { permission: 'canSet', message: 'セット作業の権限がありません' },
);
