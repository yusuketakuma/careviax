import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { dateKeySchema } from '@/lib/validations/date-key';
import { countHandoffBadge } from '@/server/services/nav-badges';
import { z } from 'zod';

/**
 * ハンドオフボード取得 BFF。
 * new_12_handoff(docs/design-gap-analysis-new.md)の責任移転モデル対応:
 * - 各 item に direction(outgoing=私が渡した / incoming=私に来た)と
 *   recipient_name(宛先ユーザー名)を追加
 * - data.summary(渡した/来た件数)と data.month_item_count(今月のハンドオフ件数)を追加
 */

const dateQuerySchema = z.object({
  date: dateKeySchema('日付はYYYY-MM-DD形式で指定してください').optional(),
});

function toDateOnly(dateStr: string): Date {
  return utcDateFromLocalKey(dateStr);
}

type HandoffDirection = 'outgoing' | 'incoming';

const HANDOFF_RECIPIENT_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
] as const;

function isCurrentHandoffItem(item: {
  lifecycle_status?: string | null;
  consult_status?: string | null;
  recipient_user_id?: string | null;
}): boolean {
  // 責任移転(lifecycle) / 相談(consult) / フリー連絡(宛先あり=message) を現行アイテムとして扱う。
  // legacy のシフトメモ(全 null・宛先なし)だけは除外する。
  return (
    item.lifecycle_status != null || item.consult_status != null || item.recipient_user_id != null
  );
}

const currentHandoffItemWhere = {
  OR: [
    { lifecycle_status: { not: null } },
    { consult_status: { not: null } },
    { recipient_user_id: { not: null } },
  ],
};

const handoffBoardInclude = {
  items: {
    where: currentHandoffItemWhere,
    orderBy: { created_at: 'asc' as const },
  },
};

/** 渡した/来たの判定。現行 item は作成者または宛先を必ず持つ。 */
function resolveHandoffDirection(
  item: { created_by: string; recipient_user_id?: string | null },
  viewerUserId: string,
): HandoffDirection {
  if (item.created_by === viewerUserId) return 'outgoing';
  if (item.recipient_user_id === viewerUserId) return 'incoming';
  // 他人同士のハンドオフ(自分は作成者でも宛先でもない)はボード閲覧用に
  // 「渡した」側の列に出さず、来た側にも出さない … が、ボードは org 全員向け
  // 表示のため従来どおり閲覧可能にする。集計上は outgoing(他人が渡した)扱い。
  return 'outgoing';
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = dateQuerySchema.safeParse({
      date: searchParams.get('date') ?? undefined,
    });
    if (!parsed.success) {
      return validationError('日付の形式が不正です', parsed.error.flatten().fieldErrors);
    }

    const dateStr = parsed.data.date ?? japanDateKey();
    const shiftDate = toDateOnly(dateStr);
    const badgeOnly = searchParams.get('badge') === '1';

    if (badgeOnly) {
      const count = await countHandoffBadge(ctx);
      return success({ data: { count: count ?? 0 } });
    }

    const monthStart = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth() + 1, 1));

    const { board, monthItemCount } = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const boardWhere = {
          org_id_shift_date: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
          },
        };
        const findBoard = () =>
          tx.handoffBoard.findUnique({
            where: boardWhere,
            include: handoffBoardInclude,
          });

        const existing = await findBoard();
        let resolvedBoard = existing;

        if (!resolvedBoard) {
          try {
            resolvedBoard = await tx.handoffBoard.create({
              data: {
                org_id: ctx.orgId,
                shift_date: shiftDate,
                created_by: ctx.userId,
              },
              include: handoffBoardInclude,
            });
          } catch (error) {
            if (!isPrismaUniqueConstraintError(error)) throw error;
            resolvedBoard = await findBoard();
            if (!resolvedBoard) throw error;
          }
        }

        const count = await tx.handoffItem.count({
          where: {
            board: {
              org_id: ctx.orgId,
              shift_date: { gte: monthStart, lt: monthEnd },
            },
          },
        });

        return { board: resolvedBoard, monthItemCount: count };
      },
      { maxWaitMs: 10_000, timeoutMs: 20_000, requestContext: ctx },
    );

    const userIds = [
      ...new Set(
        board.items.flatMap((item) => [
          item.created_by,
          ...(item.recipient_user_id ? [item.recipient_user_id] : []),
        ]),
      ),
    ];
    const users =
      userIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: userIds }, org_id: ctx.orgId },
            select: { id: true, name: true },
          });
    const userNameMap = new Map(users.map((user) => [user.id, user.name]));

    const items = board.items.filter(isCurrentHandoffItem).map((item) => ({
      ...item,
      created_by_name: userNameMap.get(item.created_by) ?? '不明',
      recipient_name: item.recipient_user_id
        ? (userNameMap.get(item.recipient_user_id) ?? null)
        : null,
      direction: resolveHandoffDirection(item, ctx.userId),
    }));

    const outgoingCount = items.filter((item) => item.created_by === ctx.userId).length;
    const incomingCount = items.filter(
      (item) => item.direction === 'incoming' && item.recipient_user_id === ctx.userId,
    ).length;
    const recipientMemberships = await prisma.membership.findMany({
      where: {
        org_id: ctx.orgId,
        is_active: true,
        role: { in: [...HANDOFF_RECIPIENT_ROLES] },
        user: { is_active: true, id: { not: ctx.userId } },
      },
      orderBy: [{ user: { name_kana: 'asc' } }, { user: { name: 'asc' } }],
      select: {
        role: true,
        user: { select: { id: true, name: true } },
      },
    });
    const recipientOptions = recipientMemberships.map((membership) => ({
      id: membership.user.id,
      name: membership.user.name,
      role: membership.role,
      role_label: memberRoleLabel(membership.role),
    }));

    const data = {
      ...board,
      items,
      recipient_options: recipientOptions,
      month_item_count: monthItemCount,
      summary: {
        outgoing_count: outgoingCount,
        incoming_count: incomingCount,
      },
    };

    return success({ data });
  },
  {
    permission: 'canReport',
    message: '申し送りボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
