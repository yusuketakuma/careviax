import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext) => {
    const { id } = await routeContext.params;

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
          return null;
        }

        if (current.read_by.includes(ctx.userId)) {
          return current;
        }

        await tx.$executeRaw`
          UPDATE "HandoffItem"
          SET read_by = array_append(read_by, ${ctx.userId}::text)
          WHERE id = ${id}
          AND NOT (${ctx.userId}::text = ANY(read_by))
        `;
        return tx.handoffItem.findUniqueOrThrow({ where: { id } });
      },
      { requestContext: ctx },
    );

    if (!item) {
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
