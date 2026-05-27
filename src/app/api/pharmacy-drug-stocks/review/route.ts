import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const reviewSchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_ids: z.array(z.string().trim().min(1)).max(1000).optional(),
});

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const where = {
      org_id: authCtx.orgId,
      site_id: site.id,
      is_stocked: true,
      ...(parsed.data.drug_master_ids?.length
        ? { drug_master_id: { in: parsed.data.drug_master_ids } }
        : {}),
    };
    const targetStocks = await prisma.pharmacyDrugStock.findMany({
      where,
      select: { id: true, drug_master_id: true },
      take: 1000,
    });
    if (targetStocks.length === 0) {
      return success({ site, reviewedCount: 0 });
    }

    const reviewedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.pharmacyDrugStock.updateMany({
        where: {
          id: { in: targetStocks.map((stock) => stock.id) },
          org_id: authCtx.orgId,
        },
        data: {
          last_reviewed_at: reviewedAt,
          reviewed_by_id: authCtx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'pharmacy_drug_stock_reviewed',
          target_type: 'PharmacySite',
          target_id: site.id,
          changes: {
            site_id: site.id,
            reviewed_count: updateResult.count,
            drug_master_ids: targetStocks.map((stock) => stock.drug_master_id),
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return updateResult;
    });

    return success({
      site,
      reviewedCount: result.count,
      reviewedAt: reviewedAt.toISOString(),
    });
  },
  { permission: 'canAdmin' },
);
