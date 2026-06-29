import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/drug-masters/[id]/generic-recommendations';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

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

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedGET(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const parsedParams = routeParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return validationError('パスパラメータが不正です', parsedParams.error.flatten().fieldErrors);
  }

  const parsed = parseSearchParams(recommendationQuerySchema, new URL(req.url).searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }

  return runWithRequestAuthContext(ctx, async () =>
    withOrgContext(
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
            site,
            target,
            recommendations: [],
            reason: 'generic_name_missing',
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
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    ),
  );
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext.params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('drug_masters_generic_recommendations_get_unhandled_error', undefined, {
        event: 'drug_masters_generic_recommendations_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
