import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const copyFormularySchema = z.object({
  source_site_id: z.string().trim().min(1, 'source_site_id は必須です'),
  target_site_id: z.string().trim().min(1, 'target_site_id は必須です'),
  overwrite: z.boolean().default(false),
});

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = copyFormularySchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { source_site_id, target_site_id, overwrite } = parsed.data;
    if (source_site_id === target_site_id) {
      return validationError('コピー元とコピー先には別の拠点を指定してください', {
        target_site_id: ['コピー元と異なる拠点を選択してください'],
      });
    }

    const sites = await prisma.pharmacySite.findMany({
      where: {
        org_id: authCtx.orgId,
        id: { in: [source_site_id, target_site_id] },
      },
      select: { id: true, name: true },
    });
    const sourceSite = sites.find((site) => site.id === source_site_id) ?? null;
    const targetSite = sites.find((site) => site.id === target_site_id) ?? null;
    if (!sourceSite || !targetSite) {
      return notFound('コピー元またはコピー先の薬局拠点が見つかりません');
    }

    const sourceStocks = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: sourceSite.id,
        is_stocked: true,
      },
      select: {
        drug_master_id: true,
        reorder_point: true,
        preferred_generic_id: true,
        adoption_note: true,
      },
    });

    if (sourceStocks.length === 0) {
      return conflict('コピー元に採用品がありません', {
        source_site_id: sourceSite.id,
      });
    }

    const existingTargetStocks = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: targetSite.id,
        drug_master_id: { in: sourceStocks.map((stock) => stock.drug_master_id) },
      },
      select: {
        drug_master_id: true,
      },
    });
    const existingTargetDrugIds = new Set(
      existingTargetStocks.map((stock) => stock.drug_master_id),
    );
    const operations = overwrite
      ? sourceStocks
      : sourceStocks.filter((stock) => !existingTargetDrugIds.has(stock.drug_master_id));

    const copiedCount = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const stock of operations) {
        await tx.pharmacyDrugStock.upsert({
          where: {
            site_id_drug_master_id: {
              site_id: targetSite.id,
              drug_master_id: stock.drug_master_id,
            },
          },
          create: {
            org_id: authCtx.orgId,
            site_id: targetSite.id,
            drug_master_id: stock.drug_master_id,
            is_stocked: true,
            reorder_point: stock.reorder_point,
            preferred_generic_id: stock.preferred_generic_id,
            adoption_source: 'site_copy',
            adoption_note: stock.adoption_note,
          },
          update: {
            is_stocked: true,
            reorder_point: stock.reorder_point,
            preferred_generic_id: stock.preferred_generic_id,
            adoption_source: 'site_copy',
            adoption_note: stock.adoption_note,
          },
          select: { id: true },
        });
        count += 1;
      }

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'pharmacy_drug_stock_site_copied',
          target_type: 'PharmacySite',
          target_id: targetSite.id,
          changes: {
            source_site_id: sourceSite.id,
            target_site_id: targetSite.id,
            source_count: sourceStocks.length,
            existing_target_count: existingTargetStocks.length,
            copied_count: count,
            skipped_count: sourceStocks.length - count,
            overwrite,
            drug_master_ids: operations.map((stock) => stock.drug_master_id),
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return count;
    });

    return success({
      sourceSite,
      targetSite,
      sourceCount: sourceStocks.length,
      copiedCount,
      skippedCount: sourceStocks.length - copiedCount,
      overwrite,
    });
  },
  { permission: 'canAdmin' },
);
