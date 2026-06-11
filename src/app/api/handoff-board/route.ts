import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

/**
 * ハンドオフボード取得 BFF。
 * new_12_handoff(docs/design-gap-analysis-new.md)の責任移転モデル対応:
 * 旧レスポンス(board + items + created_by_name)は維持しつつ、
 * - 各 item に direction(outgoing=私が渡した / incoming=私に来た)と
 *   recipient_name(宛先ユーザー名)を追加
 * - data.summary(渡した/来た件数)と data.month_item_count(今月のハンドオフ件数)を追加
 * する後方互換拡張。legacy item(宛先なしの申し送り)は
 * 「自分が書いた=渡した / 他人が書いた=来た」として扱う。
 */

const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で指定してください').optional(),
});

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function todayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type HandoffDirection = 'outgoing' | 'incoming';

/** 渡した/来たの判定。recipient 未設定の legacy 項目は作成者基準で振り分ける。 */
function resolveHandoffDirection(
  item: { created_by: string; recipient_user_id?: string | null },
  viewerUserId: string,
): HandoffDirection {
  if (item.created_by === viewerUserId) return 'outgoing';
  if (item.recipient_user_id === viewerUserId) return 'incoming';
  if (!item.recipient_user_id) return 'incoming';
  // 他人同士のハンドオフ(自分は作成者でも宛先でもない)はボード閲覧用に
  // 「渡した」側の列に出さず、来た側にも出さない … が、ボードは org 全員向け
  // 表示のため従来どおり閲覧可能にする。集計上は outgoing(他人が渡した)扱い。
  return 'outgoing';
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = dateQuerySchema.safeParse({
      date: searchParams.get('date') ?? undefined,
    });
    if (!parsed.success) {
      return validationError('日付の形式が不正です', parsed.error.flatten().fieldErrors);
    }

    const dateStr = parsed.data.date ?? todayDateStr();
    const shiftDate = toDateOnly(dateStr);
    const monthStart = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(shiftDate.getUTCFullYear(), shiftDate.getUTCMonth() + 1, 1));

    const { board, monthItemCount } = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.handoffBoard.findUnique({
        where: {
          org_id_shift_date: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
          },
        },
        include: {
          items: {
            orderBy: { created_at: 'asc' },
          },
        },
      });

      const resolvedBoard =
        existing ??
        (await tx.handoffBoard.create({
          data: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
            created_by: ctx.userId,
          },
          include: {
            items: true,
          },
        }));

      const count = await tx.handoffItem.count({
        where: {
          board: {
            org_id: ctx.orgId,
            shift_date: { gte: monthStart, lt: monthEnd },
          },
        },
      });

      return { board: resolvedBoard, monthItemCount: count };
    });

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

    const items = board.items.map((item) => ({
      ...item,
      created_by_name: userNameMap.get(item.created_by) ?? '不明',
      recipient_name: item.recipient_user_id
        ? (userNameMap.get(item.recipient_user_id) ?? null)
        : null,
      direction: resolveHandoffDirection(item, ctx.userId),
    }));

    const outgoingCount = items.filter(
      (item) => item.created_by === ctx.userId,
    ).length;
    const incomingCount = items.filter(
      (item) =>
        item.direction === 'incoming' &&
        (item.recipient_user_id === ctx.userId || !item.recipient_user_id),
    ).length;

    const data = {
      ...board,
      items,
      month_item_count: monthItemCount,
      summary: {
        outgoing_count: outgoingCount,
        incoming_count: incomingCount,
      },
    };

    return success({ data });
  },
  {
    permission: 'canDispense',
    message: '申し送りボードの閲覧権限がありません',
  }
);
