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

const ROUTE = '/api/drug-masters/[id]/ingredient-group';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const ingredientGroupQuerySchema = z.object({
  site_id: z.string().trim().optional(),
  limit: boundedIntegerSearchParam('limit', 1, 100, 50),
});

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function authenticatedGET(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req, { permission: 'canAdmin' });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const parsedParams = routeParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return validationError('パスパラメータが不正です', parsedParams.error.flatten().fieldErrors);
  }

  const parsed = parseSearchParams(ingredientGroupQuerySchema, new URL(req.url).searchParams);
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
                where: { id: parsed.data.site_id, org_id: ctx.orgId },
                select: { id: true, name: true },
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
            generic_name: null,
            summary: null,
            members: [],
            reason: 'generic_name_missing',
          });
        }

        const members = await tx.drugMaster.findMany({
          where: { generic_name: target.generic_name },
          orderBy: [{ is_generic: 'asc' }, { drug_price: 'asc' }, { drug_name_kana: 'asc' }],
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
        });

        const stocks =
          site && members.length > 0
            ? await tx.pharmacyDrugStock.findMany({
                where: {
                  org_id: ctx.orgId,
                  site_id: site.id,
                  drug_master_id: { in: members.map((member) => member.id) },
                },
                select: {
                  drug_master_id: true,
                  is_stocked: true,
                  preferred_generic_id: true,
                  reorder_point: true,
                  follow_up_status: true,
                },
              })
            : [];
        const stockByDrugId = new Map(stocks.map((stock) => [stock.drug_master_id, stock]));
        const prices = members
          .map((member) => toNumber(member.drug_price))
          .filter((price) => price != null);
        const stockedCount = stocks.filter((stock) => stock.is_stocked).length;

        return success({
          site,
          target,
          generic_name: target.generic_name,
          summary: {
            member_count: members.length,
            brand_count: members.filter((member) => !member.is_generic).length,
            generic_count: members.filter((member) => member.is_generic).length,
            stocked_count: stockedCount,
            unstocked_count: site ? Math.max(members.length - stockedCount, 0) : null,
            lowest_price: prices.length > 0 ? Math.min(...prices) : null,
            highest_price: prices.length > 0 ? Math.max(...prices) : null,
          },
          members: members.map((member) => ({
            ...member,
            site_stock: stockByDrugId.get(member.id) ?? null,
          })),
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
      logger.error(
        {
          event: 'drug_masters_ingredient_group_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
