import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { hasPermission, type PermissionKey } from '@/lib/auth/permissions';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import {
  transitionCycleStatus,
  getPreHoldStatus,
  ALLOWED_TRANSITIONS,
} from '@/lib/db/cycle-transition';
import { z } from 'zod';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

const transitionSchema = z.object({
  to: z.string().min(1, '遷移先ステータスは必須です'),
  version: z.number().int().min(1, 'バージョンは1以上です'),
  note: z.string().optional(),
});

const TERMINAL_STATUSES = new Set(['on_hold', 'cancelled']);
const DISPENSE_AUDIT_STATUSES = new Set(['audit_pending', 'audited']);
const SET_AUDIT_STATUSES = new Set(['set_audited']);
const REPORTING_STATUSES = new Set(['reported']);
const SET_PREP_STATUSES = new Set(['setting']);
const VISIT_STATUSES = new Set(['visit_ready', 'visit_completed']);

const STATUS_PERMISSION: Record<string, PermissionKey> = {
  intake_received: 'canDispense',
  structuring: 'canDispense',
  inquiry_pending: 'canDispense',
  inquiry_resolved: 'canDispense',
  ready_to_dispense: 'canDispense',
  dispensing: 'canDispense',
  dispensed: 'canDispense',
  audit_pending: 'canAuditDispense',
  audited: 'canAuditDispense',
  setting: 'canSet',
  set_audited: 'canAuditSet',
  visit_ready: 'canVisit',
  visit_completed: 'canVisit',
  reported: 'canReport',
};

const PERMISSION_DENIAL_MESSAGE: Record<PermissionKey, string> = {
  canDispense: '調剤工程の状態遷移権限がありません',
  canAuditDispense: '調剤鑑査工程の状態遷移権限がありません',
  canSet: 'セット工程の状態遷移権限がありません',
  canAuditSet: 'セット鑑査工程の状態遷移権限がありません',
  canVisit: '訪問工程の状態遷移権限がありません',
  canReport: '報告工程の状態遷移権限がありません',
  canAuthorReport: '報告書作成権限がありません',
  canSendCareReport: '報告書送付権限がありません',
  canManageBilling: '請求管理権限がありません',
  canManagePatientSharing: '患者共有管理権限がありません',
  canViewDashboard: 'ダッシュボード閲覧権限がありません',
  canAdmin: '管理者権限がありません',
};

function touchesStatus(
  statuses: ReadonlySet<string>,
  fromStatus: string,
  toStatus: string,
): boolean {
  return statuses.has(fromStatus) || statuses.has(toStatus);
}

function resolveRequiredTransitionPermission(fromStatus: string, toStatus: string): PermissionKey {
  if (touchesStatus(SET_AUDIT_STATUSES, fromStatus, toStatus)) return 'canAuditSet';
  if (touchesStatus(DISPENSE_AUDIT_STATUSES, fromStatus, toStatus)) return 'canAuditDispense';
  if (touchesStatus(REPORTING_STATUSES, fromStatus, toStatus)) return 'canReport';
  if (touchesStatus(SET_PREP_STATUSES, fromStatus, toStatus)) return 'canSet';
  if (touchesStatus(VISIT_STATUSES, fromStatus, toStatus)) return 'canVisit';

  if (TERMINAL_STATUSES.has(toStatus)) {
    return STATUS_PERMISSION[fromStatus] ?? 'canVisit';
  }

  return STATUS_PERMISSION[toStatus] ?? STATUS_PERMISSION[fromStatus] ?? 'canVisit';
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('服薬サイクルIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = transitionSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { to, version, note } = parsed.data;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const cycle = await prisma.medicationCycle.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhere ? { case_: caseAssignmentWhere } : {}),
    },
    select: { id: true, overall_status: true, version: true, patient_id: true, case_id: true },
  });
  if (!cycle) return notFound('サイクルが見つかりません');

  const fromStatus = cycle.overall_status;
  const toStatus = to;
  const requiredPermission = resolveRequiredTransitionPermission(fromStatus, toStatus);
  if (!hasPermission(ctx.role, requiredPermission)) {
    return forbidden(PERMISSION_DENIAL_MESSAGE[requiredPermission]);
  }

  // Optimistic lock check
  if (cycle.version !== version) {
    return conflict('他のユーザーによって更新されています。最新のデータを取得してください。');
  }

  // B6: For on_hold recovery, derive valid return targets from pre-hold status
  let allowed: string[] = ALLOWED_TRANSITIONS[fromStatus as keyof typeof ALLOWED_TRANSITIONS] ?? [];
  if (fromStatus === 'on_hold') {
    const preHoldStatus = await getPreHoldStatus(prisma, id);
    if (preHoldStatus) {
      allowed = [preHoldStatus, 'cancelled'];
    }
  }

  if (!allowed.includes(toStatus)) {
    return validationError(
      `ステータス "${fromStatus}" から "${toStatus}" への遷移は許可されていません`,
      { allowed },
    );
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const result = await transitionCycleStatus(tx, id, ctx.orgId, toStatus, ctx.userId, {
      note: note ?? undefined,
    });

    // Create notification for status transition (best-effort)
    try {
      const notificationData = {
        org_id: ctx.orgId,
        user_id: ctx.userId,
        event_type: 'status_changed',
        type: 'system' as const,
        title: 'ステータス変更',
        message:
          note ?? `処方サイクルのステータスが ${fromStatus} から ${toStatus} に変更されました`,
        link: `/workflow`,
        metadata: { cycle_id: id, from: fromStatus, to: toStatus },
        dedupe_key: `cycle-transition:${id}:${fromStatus}:${toStatus}:${version}`,
      };

      await tx.notification.upsert({
        where: {
          org_id_user_id_dedupe_key: {
            org_id: ctx.orgId,
            user_id: ctx.userId,
            dedupe_key: notificationData.dedupe_key,
          },
        },
        create: notificationData,
        update: {
          event_type: 'status_changed',
          type: 'system',
          title: 'ステータス変更',
          message:
            note ?? `処方サイクルのステータスが ${fromStatus} から ${toStatus} に変更されました`,
          link: `/workflow`,
          metadata: { cycle_id: id, from: fromStatus, to: toStatus },
          is_read: false,
          read_at: null,
        },
      });
    } catch {
      // Notification creation is best-effort
    }

    return result;
  });

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    eventType: 'cycle_transition',
    payload: { source: 'medication_cycles_transition' },
  });

  return success({ data: updated });
}
