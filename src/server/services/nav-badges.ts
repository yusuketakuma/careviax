import { hasPermission } from '@/lib/auth/permissions';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';

export type NavBadgePayload = {
  audit?: number;
  handoff?: number;
};

type HandoffBadgeItemSummary = {
  created_by: string;
  read_by?: string[] | null;
  lifecycle_status?: string | null;
  consult_status?: string | null;
  recipient_user_id?: string | null;
};

function todayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * バッジに数える「要対応」判定。種別で要対応の意味が異なる:
 * - 責任移転 / 相談: 自分が関与(作成者) または 自分が未読
 * - 連絡(伝言): 自分宛で未読のものだけ(自分が送った連絡はバッジに数えない)
 * legacy のシフトメモ(全 null・宛先なし)は数えない。
 */
function isActionableHandoffItem(item: HandoffBadgeItemSummary, viewerUserId: string): boolean {
  const isTransferOrConsult = item.lifecycle_status != null || item.consult_status != null;
  if (isTransferOrConsult) {
    return item.created_by === viewerUserId || !(item.read_by ?? []).includes(viewerUserId);
  }
  const isMessage = item.recipient_user_id != null;
  if (isMessage) {
    return (
      item.recipient_user_id === viewerUserId && !(item.read_by ?? []).includes(viewerUserId)
    );
  }
  return false;
}

export function countMyHandoffBadgeItems(
  items: HandoffBadgeItemSummary[],
  viewerUserId: string,
): number {
  return items.filter((item) => isActionableHandoffItem(item, viewerUserId)).length;
}

export async function countDispenseAuditBadge(ctx: AuthContext): Promise<number | undefined> {
  if (!hasPermission(ctx.role, 'canAuditDispense')) return undefined;

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  return prisma.dispenseTask.count({
    where: {
      org_id: ctx.orgId,
      status: 'completed',
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
      audits: {
        none: {
          result: { notIn: ['hold'] },
        },
      },
    },
  });
}

export async function countHandoffBadge(ctx: AuthContext): Promise<number | undefined> {
  if (!hasPermission(ctx.role, 'canReport')) return undefined;

  const shiftDate = toDateOnly(todayDateKey());
  return withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.handoffItem.count({
        where: {
          board: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
          },
          OR: [
            // 責任移転 / 相談: 自分が作成者 または 未読
            {
              AND: [
                {
                  OR: [
                    { lifecycle_status: { not: null } },
                    { consult_status: { not: null } },
                  ],
                },
                {
                  OR: [{ created_by: ctx.userId }, { NOT: { read_by: { has: ctx.userId } } }],
                },
              ],
            },
            // 連絡(伝言): 自分宛で未読のものだけ
            {
              lifecycle_status: null,
              consult_status: null,
              recipient_user_id: ctx.userId,
              NOT: { read_by: { has: ctx.userId } },
            },
          ],
        },
      }),
    { maxWaitMs: 10_000, timeoutMs: 20_000 },
  );
}

export async function buildNavBadgePayload(ctx: AuthContext): Promise<NavBadgePayload> {
  const [audit, handoff] = await Promise.all([
    countDispenseAuditBadge(ctx),
    countHandoffBadge(ctx),
  ]);

  return {
    ...(typeof audit === 'number' ? { audit } : {}),
    ...(typeof handoff === 'number' ? { handoff } : {}),
  };
}
