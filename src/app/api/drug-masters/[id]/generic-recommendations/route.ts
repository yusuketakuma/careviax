import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const recommendationQuerySchema = z.object({
  site_id: z.string().trim().optional(),
  limit: boundedIntegerSearchParam('limit', 1, 20, 8),
});

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx, routeContext: AuthRouteContext<{ id: string }>) => {
    const params = routeParamsSchema.safeParse(await routeContext.params);
    if (!params.success) {
      return validationError('パスパラメータが不正です', params.error.flatten().fieldErrors);
    }

    const parsed = parseSearchParams(recommendationQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site =
      parsed.data.site_id != null
        ? await prisma.pharmacySite.findFirst({
            where: {
              id: parsed.data.site_id,
              org_id: authCtx.orgId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : null;
    if (parsed.data.site_id && !site) return notFound('対象の薬局拠点が見つかりません');

    const target = await prisma.drugMaster.findFirst({
      where: { id: params.data.id },
      select: {
        id: true,
        yj_code: true,
        drug_name: true,
        generic_name: true,
        drug_price: true,
        unit: true,
        is_generic: true,
      },
    });
    if (!target) return notFound('対象の医薬品が見つかりません');
    if (!target.generic_name) {
      return success({
        site,
        target,
        recommendations: [],
        reason: 'generic_name_missing',
      });
    }

    const [candidates, mapping] = await Promise.all([
      prisma.drugMaster.findMany({
        where: {
          generic_name: target.generic_name,
          is_generic: true,
          id: { not: target.id },
        },
        orderBy: [{ drug_price: 'asc' }, { drug_name_kana: 'asc' }, { drug_name: 'asc' }],
        take: parsed.data.limit,
        select: {
          id: true,
          yj_code: true,
          drug_name: true,
          generic_name: true,
          drug_price: true,
          unit: true,
          manufacturer: true,
          is_generic: true,
          transitional_expiry_date: true,
        },
      }),
      prisma.genericDrugMapping.findFirst({
        where: { generic_name: target.generic_name },
        select: { price_comparison: true },
      }),
    ]);

    const siteStocks =
      site && candidates.length > 0
        ? await prisma.pharmacyDrugStock.findMany({
            where: {
              org_id: authCtx.orgId,
              site_id: site.id,
              drug_master_id: { in: candidates.map((candidate) => candidate.id) },
            },
            select: {
              drug_master_id: true,
              is_stocked: true,
              preferred_generic_id: true,
              reorder_point: true,
            },
          })
        : [];
    const stockByDrugId = new Map(siteStocks.map((stock) => [stock.drug_master_id, stock]));
    const targetPrice = toNumber(target.drug_price);

    return success({
      site,
      target,
      mapping: mapping?.price_comparison ?? null,
      recommendations: candidates.map((candidate) => {
        const candidatePrice = toNumber(candidate.drug_price);
        const priceDelta =
          targetPrice != null && candidatePrice != null ? candidatePrice - targetPrice : null;
        return {
          ...candidate,
          site_stock: stockByDrugId.get(candidate.id) ?? null,
          price_delta: priceDelta,
          price_delta_percent:
            priceDelta != null && targetPrice && targetPrice > 0
              ? (priceDelta / targetPrice) * 100
              : null,
        };
      }),
    });
  },
  { permission: 'canAdmin' },
);
