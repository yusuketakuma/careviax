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
} from '@/lib/dispensing/set-batch-history';
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

const cellMutationSchema = z
  .discriminatedUnion('action', [
    z.object({
      action: z.literal('set'),
      batch_id: z.string().min(1, 'セルIDは必須です').optional(),
      expected_version: z.number().int().min(1).optional(),
      cells: z
        .array(
          z.object({
            batch_id: z.string().min(1, 'セルIDは必須です'),
            expected_version: z.number().int().min(1),
          }),
        )
        .min(1, 'セルIDは必須です')
        .max(200, '一度に更新できるセル明細は200件までです')
        .optional(),
    }),
    z.object({
      action: z.literal('hold'),
      batch_id: z.string().min(1, 'セルIDは必須です').optional(),
      held_reason: z.enum(HOLD_REASONS, { error: '保留理由を選択してください' }),
      held_detail: z.string().max(1000).optional(),
      expected_version: z.number().int().min(1).optional(),
      cells: z
        .array(
          z.object({
            batch_id: z.string().min(1, 'セルIDは必須です'),
            expected_version: z.number().int().min(1),
          }),
        )
        .min(1, 'セルIDは必須です')
        .max(200, '一度に更新できるセル明細は200件までです')
        .optional(),
    }),
    z.object({
      action: z.literal('clear'),
      batch_id: z.string().min(1, 'セルIDは必須です').optional(),
      expected_version: z.number().int().min(1).optional(),
      cells: z
        .array(
          z.object({
            batch_id: z.string().min(1, 'セルIDは必須です'),
            expected_version: z.number().int().min(1),
          }),
        )
        .min(1, 'セルIDは必須です')
        .max(200, '一度に更新できるセル明細は200件までです')
        .optional(),
    }),
  ])
  .superRefine((input, ctx) => {
    const hasSingle = input.batch_id !== undefined || input.expected_version !== undefined;
    const hasGroup = input.cells !== undefined;
    if (hasSingle === hasGroup) {
      ctx.addIssue({
        code: 'custom',
        path: ['cells'],
        message: '単一セルまたはセル明細リストのどちらか一方を指定してください',
      });
      return;
    }
    if (hasSingle && (!input.batch_id || input.expected_version === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected_version'],
        message: 'セルIDとバージョンは必須です',
      });
    }
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

class CellMutationRollback extends Error {
  constructor(readonly response: NextResponse) {
    super('cell mutation transaction rolled back');
  }
}

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

      if (input.cells) {
        const duplicateId = findDuplicateBatchId(input.cells.map((cell) => cell.batch_id));
        if (duplicateId) {
          return {
            kind: 'error' as const,
            response: validationError('同じセルが重複して指定されています'),
          };
        }

        const batchIds = input.cells.map((cell) => cell.batch_id);
        const expectedById = new Map(
          input.cells.map((cell) => [cell.batch_id, cell.expected_version] as const),
        );
        const batches = await tx.setBatch.findMany({
          where: { id: { in: batchIds }, org_id: ctx.orgId, plan_id: planId },
          include: batchInclude,
          orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
        });
        if (batches.length !== batchIds.length) {
          return {
            kind: 'error' as const,
            response: notFound('指定されたセルの一部が見つかりません'),
          };
        }

        const firstBatch = batches[0];
        const isSameVisibleCell = batches.every(
          (batch) => batch.day_number === firstBatch.day_number && batch.slot === firstBatch.slot,
        );
        if (!isSameVisibleCell) {
          return {
            kind: 'error' as const,
            response: validationError('同一のカレンダーセルだけを指定してください'),
          };
        }

        for (const batch of batches) {
          const expectedVersion = expectedById.get(batch.id);
          if (expectedVersion !== batch.version) {
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
                  expected_version: expectedVersion,
                },
              ),
            };
          }
        }

        const beforeSnapshots: ReturnType<typeof buildSetBatchHistorySnapshot>[] = [];
        const afterSnapshots: ReturnType<typeof buildSetBatchHistorySnapshot>[] = [];
        const changedBatchIds: string[] = [];
        const lineIds = new Set<string>();
        const now = new Date();
        const { data, auditAction, changeAction, reason } = buildCellMutationWrite(
          input,
          ctx.userId,
          now,
        );

        for (const batch of batches) {
          if (isCellMutationNoop(input, batch)) continue;
          beforeSnapshots.push(buildSetBatchHistorySnapshot(batch));
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
            throw new CellMutationRollback(
              conflict(
                '他のユーザーによって更新されました。最新データを取得してから再試行してください',
                { current: { id: batch.id, version: batch.version } },
              ),
            );
          }
          changedBatchIds.push(batch.id);
          lineIds.add(batch.line_id);
        }

        const updatedBatches =
          changedBatchIds.length > 0
            ? await tx.setBatch.findMany({
                where: { id: { in: batchIds }, org_id: ctx.orgId, plan_id: planId },
                include: batchInclude,
                orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
              })
            : batches;

        if (changedBatchIds.length > 0) {
          for (const updated of updatedBatches) {
            if (changedBatchIds.includes(updated.id)) {
              afterSnapshots.push(buildSetBatchHistorySnapshot(updated));
            }
          }

          await createSetBatchChangeLog(tx, {
            orgId: ctx.orgId,
            planId,
            action: changeAction,
            triggerSource: 'workbench_cell',
            reason: `${changedBatchIds.length}件の明細を${reason}`,
            lineIds: Array.from(lineIds),
            beforeSnapshot: beforeSnapshots,
            afterSnapshot: afterSnapshots,
            changedBy: ctx.userId,
          });

          await createAuditLogEntry(tx, ctx, {
            action: auditAction,
            targetType: 'SetPlan',
            targetId: planId,
            changes: {
              plan_id: planId,
              day_number: firstBatch.day_number,
              slot: firstBatch.slot,
              batch_ids: changedBatchIds,
              line_ids: Array.from(lineIds),
              set_state: input.action === 'clear' ? 'pending' : input.action,
              ...(input.action === 'hold'
                ? { held_reason: input.held_reason, held_detail: input.held_detail ?? null }
                : {}),
            },
          });
        }

        return {
          kind: 'success' as const,
          batch: null,
          batches: updatedBatches,
          changed: changedBatchIds.length > 0,
        };
      }

      if (!input.batch_id || input.expected_version === undefined) {
        return {
          kind: 'error' as const,
          response: validationError('セルIDとバージョンは必須です'),
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

      if (isCellMutationNoop(input, batch)) {
        return { kind: 'success' as const, batch, changed: false };
      }

      const beforeSnapshot = buildSetBatchHistorySnapshot(batch);
      const now = new Date();
      const { data, auditAction, changeAction } = buildCellMutationWrite(input, ctx.userId, now);

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

      return { kind: 'success' as const, batch: updated, batches: null, changed: true };
    }).catch((err: unknown) => {
      if (err instanceof CellMutationRollback) {
        return { kind: 'error' as const, response: err.response };
      }
      throw err;
    });

    if (result.kind === 'error') return result.response;

    if (result.changed) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        eventType: 'cycle_transition',
        payload: { source: 'set_batches_update', plan_id: planId, action: input.action },
      });
    }

    if (result.batches) return success({ data: { batches: result.batches } });
    return success({ data: result.batch });
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

function buildCellMutationWrite(
  input: z.infer<typeof cellMutationSchema>,
  userId: string,
  now: Date,
) {
  if (input.action === 'set') {
    return {
      data: {
        set_state: 'set' as const,
        set_by: userId,
        set_at: now,
        held_reason: null,
        held_by: null,
        held_at: null,
        version: { increment: 1 },
      },
      auditAction: 'set_batch.cell_set',
      changeAction: 'cell_set',
      reason: 'セット済にしました',
    };
  }
  if (input.action === 'hold') {
    return {
      data: {
        set_state: 'hold' as const,
        held_reason: input.held_reason,
        held_by: userId,
        held_at: now,
        version: { increment: 1 },
      },
      auditAction: 'set_batch.cell_hold',
      changeAction: 'cell_hold',
      reason: '保留にしました',
    };
  }
  return {
    data: {
      set_state: 'pending' as const,
      set_by: null,
      set_at: null,
      held_reason: null,
      held_by: null,
      held_at: null,
      version: { increment: 1 },
    },
    auditAction: 'set_batch.cell_clear',
    changeAction: 'cell_clear',
    reason: '未セットに戻しました',
  };
}

function isCellMutationNoop(
  input: z.infer<typeof cellMutationSchema>,
  batch: {
    set_state: string;
    held_reason: string | null;
    held_by: string | null;
    held_at: Date | null;
    set_by: string | null;
    set_at: Date | null;
  },
): boolean {
  if (input.action === 'set') {
    return (
      batch.set_state === 'set' &&
      batch.held_reason === null &&
      batch.held_by === null &&
      batch.held_at === null
    );
  }
  if (input.action === 'hold') {
    return batch.set_state === 'hold' && batch.held_reason === input.held_reason;
  }
  return (
    batch.set_state === 'pending' &&
    batch.set_by === null &&
    batch.set_at === null &&
    batch.held_reason === null &&
    batch.held_by === null &&
    batch.held_at === null
  );
}
