import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, internalError, forbidden, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('申し送り項目IDが不正です');

    const item = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const current = await tx.handoffItem.findFirst({
          where: { id },
          include: {
            board: {
              select: { org_id: true },
            },
          },
        });
        if (!current || current.board.org_id !== ctx.orgId) {
          return { error: 'not_found' as const };
        }
        if (current.recipient_user_id !== ctx.userId) {
          return { error: 'forbidden' as const };
        }

        if (current.read_by.includes(ctx.userId)) {
          return current;
        }

        await tx.$executeRaw`
          UPDATE "HandoffItem" AS item
          SET read_by = array_append(item.read_by, ${ctx.userId}::text)
          FROM "HandoffBoard" AS board
          WHERE item.id = ${id}
          AND item.board_id = board.id
          AND board.org_id = ${ctx.orgId}
          AND item.recipient_user_id = ${ctx.userId}
          AND NOT (${ctx.userId}::text = ANY(item.read_by))
        `;
        const updated = await tx.handoffItem.findFirst({
          where: { id, recipient_user_id: ctx.userId, board: { org_id: ctx.orgId } },
        });
        return updated ?? { error: 'not_found' as const };
      },
      { requestContext: ctx },
    );

    if ('error' in item) {
      if (item.error === 'forbidden') {
        return forbidden('この申し送り項目の受領確認権限がありません');
      }
      return notFound('申し送り項目が見つかりません');
    }

    return success({ data: item });
  },
  {
    permission: 'canReport',
    message: '申し送りの既読権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
