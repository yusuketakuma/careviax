import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const applyTemplateSchema = z.object({
  target_site_id: z.string().trim().min(1, 'target_site_id は必須です'),
  overwrite: z.boolean().default(false),
});

type TemplateItem = {
  drug_master_id?: unknown;
  reorder_point?: unknown;
  preferred_generic_id?: unknown;
  adoption_note?: unknown;
};

function readTemplateItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as TemplateItem;
    if (typeof row.drug_master_id !== 'string' || !row.drug_master_id) return [];
    return [{
      drug_master_id: row.drug_master_id,
      reorder_point: typeof row.reorder_point === 'number' ? row.reorder_point : null,
      preferred_generic_id:
        typeof row.preferred_generic_id === 'string' ? row.preferred_generic_id : null,
      adoption_note: typeof row.adoption_note === 'string' ? row.adoption_note : null,
    }];
  });
}

export const POST = withAuthContext(
  async (req: NextRequest, authCtx, ctx: RouteContext<'/api/pharmacy-drug-stock-templates/[id]/apply'>) => {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = applyTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const [template, targetSite] = await Promise.all([
      prisma.formularyTemplate.findFirst({
        where: { id, org_id: authCtx.orgId },
      }),
      prisma.pharmacySite.findFirst({
        where: { id: parsed.data.target_site_id, org_id: authCtx.orgId },
        select: { id: true, name: true },
      }),
    ]);
    if (!template) return notFound('採用品テンプレートが見つかりません');
    if (!targetSite) return notFound('対象の薬局拠点が見つかりません');

    const items = readTemplateItems(template.items);
    const existing = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: targetSite.id,
        drug_master_id: { in: items.map((item) => item.drug_master_id) },
      },
      select: { drug_master_id: true },
    });
    const existingDrugIds = new Set(existing.map((stock) => stock.drug_master_id));
    const operations = items.filter(
      (item) => parsed.data.overwrite || !existingDrugIds.has(item.drug_master_id),
    );

    const appliedCount = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const item of operations) {
        await tx.pharmacyDrugStock.upsert({
          where: {
            site_id_drug_master_id: {
              site_id: targetSite.id,
              drug_master_id: item.drug_master_id,
            },
          },
          create: {
            org_id: authCtx.orgId,
            site_id: targetSite.id,
            drug_master_id: item.drug_master_id,
            is_stocked: true,
            reorder_point: item.reorder_point,
            preferred_generic_id: item.preferred_generic_id,
            adoption_source: 'template',
            adoption_note: item.adoption_note,
          },
          update: {
            is_stocked: true,
            reorder_point: item.reorder_point,
            preferred_generic_id: item.preferred_generic_id,
            adoption_source: 'template',
            adoption_note: item.adoption_note,
          },
          select: { id: true },
        });
        count += 1;
      }

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'formulary_template_applied',
          target_type: 'PharmacySite',
          target_id: targetSite.id,
          changes: {
            template_id: template.id,
            template_name: template.name,
            target_site_id: targetSite.id,
            item_count: items.length,
            applied_count: count,
            skipped_count: items.length - count,
            overwrite: parsed.data.overwrite,
            drug_master_ids: operations.map((item) => item.drug_master_id),
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return count;
    });

    return success({
      template: { id: template.id, name: template.name },
      targetSite,
      itemCount: items.length,
      appliedCount,
      skippedCount: items.length - appliedCount,
      overwrite: parsed.data.overwrite,
    });
  },
  { permission: 'canAdmin' },
);
