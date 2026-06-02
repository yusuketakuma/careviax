import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

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

export const GET = withAuthContext(
  async (req: NextRequest, authCtx, routeContext: AuthRouteContext<{ id: string }>) => {
    const params = routeParamsSchema.safeParse(await routeContext.params);
    if (!params.success) {
      return validationError('パスパラメータが不正です', params.error.flatten().fieldErrors);
    }

    const parsed = parseSearchParams(ingredientGroupQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site =
      parsed.data.site_id != null
        ? await prisma.pharmacySite.findFirst({
            where: { id: parsed.data.site_id, org_id: authCtx.orgId },
            select: { id: true, name: true },
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
        generic_name: null,
        summary: null,
        members: [],
        reason: 'generic_name_missing',
      });
    }

    const members = await prisma.drugMaster.findMany({
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
        ? await prisma.pharmacyDrugStock.findMany({
            where: {
              org_id: authCtx.orgId,
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
  { permission: 'canAdmin' },
);
