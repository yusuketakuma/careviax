import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { buildSearchFilter, buildSort } from '@/lib/api/search';
import { parsePaginationParams } from '@/lib/api/pagination';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const booleanParam = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const drugMasterQuerySchema = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  generic: booleanParam,
  narcotic: booleanParam,
  highRisk: booleanParam,
  lasa: booleanParam,
  stocked: booleanParam,
  site_id: z.string().trim().optional(),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['drug_name_kana', 'drug_name', 'drug_price', 'yj_code']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

export const GET = withAuthContext(async (req: NextRequest, authCtx) => {
  const { searchParams } = new URL(req.url);
  const parsed = parseSearchParams(drugMasterQuerySchema, searchParams);
  if (!parsed.ok) {
    return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
  }
  const pagination = parsePaginationParams(searchParams);
  const limit = parsed.data.limit ?? pagination.limit;
  const cursor = parsed.data.cursor;
  const offset = cursor ? pagination.offset : 0;

  const q = parsed.data.q ?? '';
  const category = parsed.data.category;
  const genericOnly = parsed.data.generic ?? false;
  const narcoticOnly = parsed.data.narcotic ?? false;
  const highRiskOnly = parsed.data.highRisk ?? false;
  const lasaOnly = parsed.data.lasa ?? false;
  const stockedOnly = parsed.data.stocked ?? false;
  const siteId = parsed.data.site_id;
  if (siteId) {
    const site = await prisma.pharmacySite.findFirst({
      where: {
        id: siteId,
        org_id: authCtx.orgId,
      },
      select: {
        id: true,
      },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');
  }
  const textSearch = buildSearchFilter(q, [
    'drug_name',
    'drug_name_kana',
    'generic_name',
  ]) as Prisma.DrugMasterWhereInput;
  const orClauses: Prisma.DrugMasterWhereInput[] = [
    ...(textSearch.OR ?? []),
    ...(q
      ? [
          { yj_code: { startsWith: q } },
          { receipt_code: { startsWith: q } },
          { jan_code: { startsWith: q } },
        ]
      : []),
  ];
  const primarySort = buildSort(
    parsed.data.sort,
    parsed.data.order,
    ['drug_name_kana', 'drug_name', 'drug_price', 'yj_code'],
    'drug_name_kana',
  );

  const where: Prisma.DrugMasterWhereInput = {
    ...(orClauses.length > 0 ? { OR: orClauses } : {}),
    ...(category ? { therapeutic_category: { startsWith: category } } : {}),
    ...(genericOnly ? { is_generic: true } : {}),
    ...(narcoticOnly ? { is_narcotic: true } : {}),
    ...(highRiskOnly ? { is_high_risk: true } : {}),
    ...(lasaOnly ? { is_lasa_risk: true } : {}),
    ...(stockedOnly && siteId
      ? {
          drug_stocks: {
            some: {
              org_id: authCtx.orgId,
              site_id: siteId,
              is_stocked: true,
            },
          },
        }
      : {}),
  };

  const [drugs, totalCount] = await Promise.all([
    prisma.drugMaster.findMany({
      where,
      orderBy:
        parsed.data.sort === 'drug_name'
          ? [primarySort ?? { drug_name_kana: 'asc' }, { drug_name_kana: 'asc' }]
          : [primarySort ?? { drug_name_kana: 'asc' }, { drug_name: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        yj_code: true,
        receipt_code: true,
        jan_code: true,
        drug_name: true,
        drug_name_kana: true,
        generic_name: true,
        drug_price: true,
        unit: true,
        dosage_form: true,
        therapeutic_category: true,
        manufacturer: true,
        is_generic: true,
        is_narcotic: true,
        is_psychotropic: true,
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: true,
        lasa_group_key: true,
        max_administration_days: true,
      },
    }),
    prisma.drugMaster.count({ where }),
  ]);

  const hasMore = drugs.length > limit;
  const data = hasMore ? drugs.slice(0, limit) : drugs;
  const stocks =
    siteId && data.length > 0
      ? await prisma.pharmacyDrugStock.findMany({
          where: {
            org_id: authCtx.orgId,
            site_id: siteId,
            drug_master_id: {
              in: data.map((drug) => drug.id),
            },
          },
          select: {
            id: true,
            drug_master_id: true,
            is_stocked: true,
            stock_qty: true,
            reorder_point: true,
            preferred_generic_id: true,
            adoption_source: true,
            adoption_note: true,
            last_reviewed_at: true,
            reviewed_by_id: true,
            follow_up_status: true,
            follow_up_reason: true,
            follow_up_due_date: true,
            follow_up_resolved_at: true,
            updated_at: true,
            preferred_generic: {
              select: {
                id: true,
                drug_name: true,
                yj_code: true,
              },
            },
          },
        })
      : [];
  const stockByDrugMasterId = new Map(stocks.map((stock) => [stock.drug_master_id, stock]));
  const genericNames = [
    ...new Set(
      data
        .map((drug) => drug.generic_name?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const genericMappings =
    genericNames.length > 0
      ? await prisma.genericDrugMapping.findMany({
          where: {
            generic_name: {
              in: genericNames,
            },
          },
          select: {
            generic_name: true,
            price_comparison: true,
          },
        })
      : [];
  const priceComparisonByGenericName = new Map(
    genericMappings.map((mapping) => [
      mapping.generic_name,
      mapping.price_comparison as Prisma.JsonObject | null,
    ]),
  );

  return success({
    data: data.map((drug) => ({
      ...drug,
      stock_config: stockByDrugMasterId.get(drug.id) ?? null,
      generic_price_comparison:
        drug.generic_name != null
          ? (priceComparisonByGenericName.get(drug.generic_name) ?? null)
          : null,
    })),
    hasMore,
    totalCount,
    nextCursor: hasMore ? String(offset + limit) : undefined,
  });
});
