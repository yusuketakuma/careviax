import { hasPermission } from '@/lib/auth/permissions';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { japanDateKey } from '@/lib/utils/date-boundary';

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

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * バッジに数える「要対応」判定:
 * - 責任移転 / 相談 / 連絡(伝言) は自分宛で未読のものだけ数える。
 * - 自分が作成したものや他人宛の未読は、受領確認 API で消せないためバッジ対象にしない。
 * legacy のシフトメモ(全 null・宛先なし)は数えない。
 */
function isActionableHandoffItem(item: HandoffBadgeItemSummary, viewerUserId: string): boolean {
  const isCurrentItem =
    item.lifecycle_status != null || item.consult_status != null || item.recipient_user_id != null;
  return (
    isCurrentItem &&
    item.recipient_user_id === viewerUserId &&
    !(item.read_by ?? []).includes(viewerUserId)
  );
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

  // handoff board 生成側(handoff-board/route.ts)と同じ JST 業務日で shift_date を合わせる。
  // サーバーローカル日付だと UTC prod の JST 早朝で前日ボードを数えてしまう。
  const shiftDate = toDateOnly(japanDateKey());
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
            // 責任移転 / 相談: 自分宛で未読のものだけ
            {
              AND: [
                {
                  OR: [{ lifecycle_status: { not: null } }, { consult_status: { not: null } }],
                },
                { recipient_user_id: ctx.userId },
                { NOT: { read_by: { has: ctx.userId } } },
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
