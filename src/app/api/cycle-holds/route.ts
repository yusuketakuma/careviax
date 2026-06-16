import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { HoldReason, HoldScope } from '@prisma/client';
import { z } from 'zod';

/**
 * 構造化された保留(ホールド)の登録/解決。
 *
 * 設計(計画書 §11/§12-5): 保留は理由7種(HoldReason)を必須とし、適用範囲(HoldScope)・
 * 期限(due_at)・担当(assigned_to)・メモ(note) を構造化して保存する。
 * 本エンドポイントは構造化保留レコード(CycleHold)の作成と解決のみを所有し、
 * MedicationCycle の状態遷移(on_hold 等)は工程別 API 側の責務として分離する
 * (transitionCycleStatus の「副作用はcaller側」契約に倣う)。
 *
 * 監査証跡(§12-5): 確定操作(作成/解決)を AuditLog へ append-only で記録する。
 * inputUserId/confirmUserId に相当する actor は createAuditLogEntry が ctx.userId から、
 * サーバ信頼時刻は AuditLog.created_at(@default(now())) が担保する。物理削除APIは設けない。
 */

const HOLD_REASONS = [
  'prescription_change_wait',
  'doctor_confirm_wait',
  'residual_confirm_wait',
  'stock_shortage',
  'family_facility_confirm_wait',
  'onsite_set_at_visit',
  'other',
] as const satisfies readonly HoldReason[];

const HOLD_SCOPES = ['cycle', 'line', 'cell'] as const satisfies readonly HoldScope[];

const createCycleHoldSchema = z
  .object({
    cycle_id: z.string().min(1),
    phase: z.string().min(1),
    scope: z.enum(HOLD_SCOPES),
    reason: z.enum(HOLD_REASONS),
    reason_detail: z.string().optional(),
    line_id: z.string().min(1).optional(),
    day_number: z.number().int().optional(),
    slot: z.string().min(1).optional(),
    due_at: z
      .string()
      .datetime({ offset: true })
      .optional(),
    assigned_to: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // scope=line/cell は対象行(line_id)が必須。cell はさらに day_number/slot を要する。
    if ((value.scope === 'line' || value.scope === 'cell') && !value.line_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line_id'],
        message: '行/セル単位の保留には line_id が必須です',
      });
    }
    if (value.scope === 'cell' && (value.day_number == null || !value.slot)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope'],
        message: 'セル単位の保留には day_number と slot が必須です',
      });
    }
  });

const resolveCycleHoldSchema = z.object({
  id: z.string().min(1),
  note: z.string().optional(),
});

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCycleHoldSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      cycle_id,
      phase,
      scope,
      reason,
      reason_detail,
      line_id,
      day_number,
      slot,
      due_at,
      assigned_to,
      note,
    } = parsed.data;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const cycle = await tx.medicationCycle.findFirst({
        where: {
          id: cycle_id,
          org_id: ctx.orgId,
          ...(cycleAssignmentWhere ?? {}),
        },
        select: { id: true, patient_id: true },
      });
      if (!cycle) return null;

      const hold = await tx.cycleHold.create({
        data: {
          org_id: ctx.orgId,
          cycle_id,
          phase,
          scope,
          reason,
          reason_detail: reason_detail ?? null,
          line_id: line_id ?? null,
          day_number: day_number ?? null,
          slot: slot ?? null,
          due_at: due_at ? new Date(due_at) : null,
          assigned_to: assigned_to ?? null,
          note: note ?? null,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'cycle_hold.create',
        targetType: 'CycleHold',
        targetId: hold.id,
        changes: {
          cycle_id,
          patient_id: cycle.patient_id,
          phase,
          scope,
          reason,
          reason_detail: reason_detail ?? null,
          line_id: line_id ?? null,
          day_number: day_number ?? null,
          slot: slot ?? null,
          due_at: due_at ?? null,
          assigned_to: assigned_to ?? null,
        },
      });

      return hold;
    });

    if (!result) return notFound('指定された服薬サイクルが見つかりません');

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: { source: 'cycle_holds_create', cycle_id, hold_id: result.id },
    });

    return success({ data: result }, 201);
  },
  {
    permission: 'canDispense',
    message: '保留の登録権限がありません',
  },
);

export const PATCH = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = resolveCycleHoldSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { id, note } = parsed.data;
    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    type ResolveResult =
      | { error: 'not_found' }
      | { error: 'already_resolved' }
      | { hold: { id: string; cycle_id: string } };

    const result = await withOrgContext<ResolveResult>(ctx.orgId, async (tx) => {
      const hold = await tx.cycleHold.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
        },
        select: { id: true, cycle_id: true, resolved_at: true, note: true },
      });
      if (!hold) return { error: 'not_found' };
      if (hold.resolved_at) return { error: 'already_resolved' };

      const now = new Date();
      const nextNote =
        note != null
          ? [hold.note?.trim(), note.trim()].filter(Boolean).join('\n') || null
          : hold.note;

      // append-only セマンティクス: 解決は物理削除でなく resolved_* の付与で表現する。
      // 楽観的に未解決の行のみを更新し、同時解決の競合を WHERE 条件で弾く。
      const updated = await tx.cycleHold.updateMany({
        where: { id, org_id: ctx.orgId, resolved_at: null },
        data: {
          resolved_at: now,
          resolved_by: ctx.userId,
          ...(note != null ? { note: nextNote } : {}),
        },
      });
      if (updated.count === 0) return { error: 'already_resolved' };

      await createAuditLogEntry(tx, ctx, {
        action: 'cycle_hold.resolve',
        targetType: 'CycleHold',
        targetId: hold.id,
        changes: {
          cycle_id: hold.cycle_id,
          resolved_by: ctx.userId,
          note: note ?? null,
        },
      });

      return { hold: { id: hold.id, cycle_id: hold.cycle_id } };
    });

    if ('error' in result) {
      if (result.error === 'not_found') {
        return notFound('指定された保留が見つかりません');
      }
      return conflict('この保留は既に解決済みです');
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      eventType: 'cycle_transition',
      payload: {
        source: 'cycle_holds_resolve',
        cycle_id: result.hold.cycle_id,
        hold_id: result.hold.id,
      },
    });

    return success({ data: { id: result.hold.id, resolved: true } });
  },
  {
    permission: 'canDispense',
    message: '保留の解決権限がありません',
  },
);
