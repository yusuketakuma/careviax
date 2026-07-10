import { NextRequest } from 'next/server';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { notFound, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';

function presentDeletedFormularyTemplate(template: {
  id: string;
  name: string;
  item_count: number;
  source_site_id: string | null;
}) {
  return {
    id: template.id,
    name: template.name,
    item_count: template.item_count,
    source_site_id: template.source_site_id,
  };
}

const authenticatedDELETE = withAuthContext(
  async (_req: NextRequest, authCtx, ctx: AuthRouteContext<{ id: string }>) => {
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

      await createAuditLogEntry(tx, authCtx, {
        action: 'formulary_template_deleted',
        targetType: 'FormularyTemplate',
        targetId: template.id,
        changes: {
          template_name: template.name,
          item_count: template.item_count,
          source_site_id: template.source_site_id,
        },
      });
    });

    return success({ data: presentDeletedFormularyTemplate(template), meta: { deleted: true } });
  },
  { permission: 'canAdmin' },
);

export const DELETE: typeof authenticatedDELETE = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedDELETE(req, routeContext));
