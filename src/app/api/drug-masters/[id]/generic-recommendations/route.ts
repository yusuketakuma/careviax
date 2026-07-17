import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { withOrgContext } from '@/lib/db/rls';

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

async function authenticatedGET(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const parsedParams = routeParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return validationError('パスパラメータが不正です', parsedParams.error.flatten().fieldErrors);
  }

  const parsed = parseSearchParams(recommendationQuerySchema, new URL(req.url).searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const site =
        parsed.data.site_id != null
          ? await tx.pharmacySite.findFirst({
              where: {
                id: parsed.data.site_id,
                org_id: ctx.orgId,
              },
              select: {
                id: true,
                name: true,
              },
            })
          : null;
      if (parsed.data.site_id && !site) return notFound('対象の薬局拠点が見つかりません');

      const target = await tx.drugMaster.findFirst({
        where: { id: parsedParams.data.id },
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
          data: {
            site,
            target,
            recommendations: [],
            reason: 'generic_name_missing',
          },
        });
      }

      const [candidates, mapping] = await Promise.all([
        tx.drugMaster.findMany({
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
        tx.genericDrugMapping.findFirst({
          where: { generic_name: target.generic_name },
          select: { price_comparison: true },
        }),
      ]);

      const siteStocks =
        site && candidates.length > 0
          ? await tx.pharmacyDrugStock.findMany({
              where: {
                org_id: ctx.orgId,
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
        data: {
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
        },
      });
    },
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );
}

export const GET = withAuthContext<{ id: string }>(authenticatedGET, {
  permission: 'canAdmin',
});
