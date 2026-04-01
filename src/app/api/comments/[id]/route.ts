import { withAuthContext } from '@/lib/auth/context';
import { success, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';

export const DELETE = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext) => {
    const { id } = await routeContext.params;

    const existing = await prisma.taskComment.findFirst({
      where: { id, org_id: ctx.orgId, author_id: ctx.userId },
      select: { id: true },
    });
    if (!existing) return notFound('コメントが見つからないか、削除権限がありません');

    await withOrgContext(ctx.orgId, (tx) =>
      tx.taskComment.delete({ where: { id } })
    );

    return success({ deleted: true });
  },
  {
    permission: 'canDispense',
    message: 'コメントの削除権限がありません',
  }
);
