import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const DELETE = withAuthContext(
  async (
    _req: NextRequest,
    authCtx,
    ctx: RouteContext<'/api/pharmacy-drug-stock-templates/[id]'>,
  ) => {
    const { id } = await ctx.params;
    const template = await prisma.formularyTemplate.findFirst({
      where: { id, org_id: authCtx.orgId },
      select: { id: true, name: true, item_count: true, source_site_id: true },
    });
    if (!template) return notFound('採用品テンプレートが見つかりません');

    await prisma.$transaction(async (tx) => {
      await tx.formularyTemplate.delete({
        where: { id: template.id },
      });

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'formulary_template_deleted',
          target_type: 'FormularyTemplate',
          target_id: template.id,
          changes: {
            template_name: template.name,
            item_count: template.item_count,
            source_site_id: template.source_site_id,
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });
    });

    return success({ deleted: true, data: template });
  },
  { permission: 'canAdmin' },
);
