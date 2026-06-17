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

const bulkSetSchema = z.object({
  cells: z
    .array(
      z.object({
        batch_id: z.string().min(1, 'セルIDは必須です'),
        expected_version: z.number().int().min(1),
      }),
    )
    .min(1, 'セットするセルを1件以上指定してください')
    .max(500, '一度にセットできるセルは500件までです'),
});

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

class BulkSetRollback extends Error {
  constructor(readonly response: NextResponse) {
    super('bulk set transaction rolled back');
  }
}

/**
 * POST /api/set-plans/[id]/batches/bulk-set
 * お薬カレンダーのセルを一括でセット済(set)にする。
 * - 監査証跡(§12-5): 各セルに set_by/set_at(サーバ時刻)、AuditLog 追記(append-only・bulk 1件)。
 * - 競合(§12-4): SetBatch.version を OCC アンカーとし、各セルで updateMany WHERE version + count===0。
 *   1件でも不一致なら 409 WORKFLOW_CONFLICT で全件ロールバック(部分適用させない)。
 */
export const POST = withAuthContext<{ id: string }>(
  async (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>,
  ): Promise<NextResponse> => {
    const { id: planId } = await routeContext.params;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = bulkSetSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { cells } = parsed.data;

    const duplicateId = findDuplicateBatchId(cells.map((cell) => cell.batch_id));
    if (duplicateId) {
      return validationError('同じセルが重複して指定されています');
    }

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

      const expectedById = new Map(
        cells.map((cell) => [cell.batch_id, cell.expected_version] as const),
      );
      const batchIds = cells.map((cell) => cell.batch_id);

      const batches = await tx.setBatch.findMany({
        where: { id: { in: batchIds }, org_id: ctx.orgId, plan_id: planId },
        include: batchInclude,
      });

      if (batches.length !== batchIds.length) {
        return {
          kind: 'error' as const,
          response: notFound('指定されたセルの一部が見つかりません'),
        };
      }

      const now = new Date();
      const beforeSnapshots: ReturnType<typeof buildSetBatchHistorySnapshot>[] = [];
      const afterSnapshots: ReturnType<typeof buildSetBatchHistorySnapshot>[] = [];
      const lineIds = new Set<string>();
      let changedCount = 0;

      for (const batch of batches) {
        const expectedVersion = expectedById.get(batch.id);

        // 競合(§12-4): 早期 version チェック(UX hint)。
        if (expectedVersion !== batch.version) {
          return {
            kind: 'error' as const,
            response: conflict(
              '他のユーザーによって更新されました。最新データを取得してから再試行してください',
              {
                current: { id: batch.id, version: batch.version, set_state: batch.set_state },
                expected_version: expectedVersion,
              },
            ),
          };
        }

        if (isBulkSetNoop(batch)) continue;

        beforeSnapshots.push(buildSetBatchHistorySnapshot(batch));

        // OCC: updateMany WHERE version。count===0 で同一トランザクション内をロールバック。
        const updatedCount = await tx.setBatch.updateMany({
          where: {
            id: batch.id,
            org_id: ctx.orgId,
            plan_id: planId,
            version: batch.version,
            plan: { cycle: { overall_status: MUTABLE_SET_BATCH_CYCLE_STATUS } },
          },
          data: {
            set_state: 'set',
            set_by: ctx.userId,
            set_at: now,
            held_reason: null,
            held_by: null,
            held_at: null,
            version: { increment: 1 },
          },
        });
        if (updatedCount.count === 0) {
          throw new BulkSetRollback(
            conflict(
              '他のユーザーによって更新されました。最新データを取得してから再試行してください',
              {
                current: { id: batch.id, version: batch.version },
              },
            ),
          );
        }
        lineIds.add(batch.line_id);
        changedCount += 1;
      }

      const updatedBatches =
        changedCount > 0
          ? await tx.setBatch.findMany({
              where: { id: { in: batchIds }, org_id: ctx.orgId, plan_id: planId },
              include: batchInclude,
              orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
            })
          : batches;
      if (changedCount > 0) {
        for (const updated of updatedBatches) {
          afterSnapshots.push(buildSetBatchHistorySnapshot(updated));
        }
      }

      if (changedCount > 0) {
        await createSetBatchChangeLog(tx, {
          orgId: ctx.orgId,
          planId,
          action: 'cell_bulk_set',
          triggerSource: 'workbench_bulk_set',
          reason: `${changedCount}件のセルを一括セット済にしました`,
          lineIds: Array.from(lineIds),
          beforeSnapshot: beforeSnapshots,
          afterSnapshot: afterSnapshots,
          changedBy: ctx.userId,
        });

        // 監査証跡(§12-5): append-only AuditLog(一括操作で1件)。
        await createAuditLogEntry(tx, ctx, {
          action: 'set_batch.cell_bulk_set',
          targetType: 'SetPlan',
          targetId: planId,
          changes: {
            plan_id: planId,
            count: changedCount,
            batch_ids: batchIds,
            line_ids: Array.from(lineIds),
          },
        });
      }

      return { kind: 'success' as const, batches: updatedBatches, changedCount };
    }).catch((err: unknown) => {
      if (err instanceof BulkSetRollback) {
        return { kind: 'error' as const, response: err.response };
      }
      throw err;
    });

    if (result.kind === 'error') return result.response;

    if (result.changedCount > 0) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        eventType: 'cycle_transition',
        payload: { source: 'set_batches_update', plan_id: planId, count: result.changedCount },
      });
    }

    return success({ data: { count: result.changedCount, batches: result.batches } });
  },
  { permission: 'canSet', message: 'セット作業の権限がありません' },
);

function findDuplicateBatchId(batchIds: string[]): string | null {
  const seen = new Set<string>();
  for (const batchId of batchIds) {
    if (seen.has(batchId)) return batchId;
    seen.add(batchId);
  }
  return null;
}

function isBulkSetNoop(batch: {
  set_state: string;
  held_reason: string | null;
  held_by?: string | null;
  held_at?: Date | null;
}): boolean {
  return (
    batch.set_state === 'set' &&
    batch.held_reason === null &&
    (batch.held_by ?? null) === null &&
    (batch.held_at ?? null) === null
  );
}
