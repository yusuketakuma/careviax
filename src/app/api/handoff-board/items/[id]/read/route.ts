import { withAuthContext } from '@/lib/auth/context';
import { success, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';

export const PATCH = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext) => {
    const { id } = await routeContext.params;

    const item = await prisma.handoffItem.findFirst({
      where: { id },
      include: {
        board: {
          select: { org_id: true },
        },
      },
    });
    if (!item || item.board.org_id !== ctx.orgId) {
      return notFound('申し送り項目が見つかりません');
    }

    if (item.read_by.includes(ctx.userId)) {
      return success({ data: item });
    }

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      await tx.$executeRaw`
        UPDATE "HandoffItem"
        SET read_by = array_append(read_by, ${ctx.userId}::text)
        WHERE id = ${id}
        AND NOT (${ctx.userId}::text = ANY(read_by))
      `;
      return tx.handoffItem.findUniqueOrThrow({ where: { id } });
    });

    return success({ data: updated });
  },
  {
    permission: 'canDispense',
    message: '申し送りの既読権限がありません',
  }
);
