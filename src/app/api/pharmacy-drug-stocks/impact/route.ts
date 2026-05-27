import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const impactQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  expiry_within_days: z.coerce.number().int().min(1).max(365).default(90),
  review_overdue_days: z.coerce.number().int().min(30).max(730).default(180),
  queue: z
    .enum([
      'action_required',
      'recently_changed',
      'transitional_expiry',
      'missing_reorder_point',
      'safety_flagged',
      'review_due',
    ])
    .default('action_required'),
  queue_limit: z.coerce.number().int().min(1).max(100).default(25),
});

type ImpactQueueKey = z.infer<typeof impactQuerySchema>['queue'];

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const stockImpactSelect = {
  id: true,
  drug_master_id: true,
  reorder_point: true,
  last_reviewed_at: true,
  follow_up_status: true,
  follow_up_reason: true,
  follow_up_due_date: true,
  follow_up_resolved_at: true,
  updated_at: true,
  drug_master: {
    select: {
      id: true,
      yj_code: true,
      receipt_code: true,
      drug_name: true,
      generic_name: true,
      drug_price: true,
      unit: true,
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: true,
      is_high_risk: true,
      is_lasa_risk: true,
      transitional_expiry_date: true,
    },
  },
} satisfies Prisma.PharmacyDrugStockSelect;

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(impactQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const now = new Date();
    const expiryUntil = addDays(now, parsed.data.expiry_within_days);
    const reviewCutoff = addDays(now, -parsed.data.review_overdue_days);
    const recentChangeCutoff = addDays(now, -30);

    const baseWhere = {
      org_id: authCtx.orgId,
      site_id: site.id,
      is_stocked: true,
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const reviewDueWhere = {
      ...baseWhere,
      OR: [{ last_reviewed_at: null }, { last_reviewed_at: { lt: reviewCutoff } }],
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const missingReorderWhere = {
      ...baseWhere,
      reorder_point: null,
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const safetyFlaggedWhere = {
      ...baseWhere,
      drug_master: {
        OR: [
          { is_high_risk: true },
          { is_lasa_risk: true },
          { is_narcotic: true },
          { is_psychotropic: true },
        ],
      },
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const transitionalExpiryWhere = {
      ...baseWhere,
      drug_master: {
        transitional_expiry_date: {
          gte: now,
          lte: expiryUntil,
        },
      },
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const recentChangeYjRows = await prisma.drugMasterChangeEvent.findMany({
      where: {
        source: 'mhlw_price',
        created_at: { gte: recentChangeCutoff },
      },
      distinct: ['yj_code'],
      select: { yj_code: true },
    });
    const changedYjCodes = recentChangeYjRows.map((change) => change.yj_code);
    const recentlyChangedWhere = {
      ...baseWhere,
      drug_master: { yj_code: { in: changedYjCodes } },
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const actionRequiredTriggers: Prisma.PharmacyDrugStockWhereInput[] = [
      {
        AND: [
          { follow_up_status: { not: null } },
          { follow_up_status: { notIn: ['active', 'resolved', ''] } },
        ],
      },
      {
        AND: [
          { OR: [{ follow_up_status: null }, { follow_up_status: 'active' }] },
          {
            OR: [
              { drug_master: transitionalExpiryWhere.drug_master },
              ...(changedYjCodes.length > 0
                ? [{ drug_master: { yj_code: { in: changedYjCodes } } }]
                : []),
            ],
          },
        ],
      },
    ];
    const actionRequiredWhere = {
      ...baseWhere,
      OR: actionRequiredTriggers,
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const queueWhereByKey: Record<ImpactQueueKey, Prisma.PharmacyDrugStockWhereInput> = {
      action_required: actionRequiredWhere,
      recently_changed: recentlyChangedWhere,
      transitional_expiry: transitionalExpiryWhere,
      missing_reorder_point: missingReorderWhere,
      safety_flagged: safetyFlaggedWhere,
      review_due: reviewDueWhere,
    };
    const queueOrderBy = [{ updated_at: 'desc' }] satisfies Prisma.PharmacyDrugStockOrderByWithRelationInput[];
    const [
      stockedCount,
      reviewDueCount,
      missingReorderPointCount,
      safetyFlaggedCount,
      transitionalExpiryCount,
      actionRequiredCount,
      recentMasterChangeCount,
      selectedQueueRows,
      reviewDueSample,
      missingReorderPointSample,
      safetyFlaggedSample,
      transitionalExpirySample,
      actionRequiredSample,
      recentlyChangedSample,
    ] = await Promise.all([
      prisma.pharmacyDrugStock.count({ where: baseWhere }),
      prisma.pharmacyDrugStock.count({ where: reviewDueWhere }),
      prisma.pharmacyDrugStock.count({ where: missingReorderWhere }),
      prisma.pharmacyDrugStock.count({ where: safetyFlaggedWhere }),
      prisma.pharmacyDrugStock.count({ where: transitionalExpiryWhere }),
      prisma.pharmacyDrugStock.count({ where: actionRequiredWhere }),
      prisma.pharmacyDrugStock.count({ where: recentlyChangedWhere }),
      prisma.pharmacyDrugStock.findMany({
        where: queueWhereByKey[parsed.data.queue],
        orderBy: queueOrderBy,
        take: parsed.data.queue_limit,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: reviewDueWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: missingReorderWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: safetyFlaggedWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: transitionalExpiryWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: actionRequiredWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
      prisma.pharmacyDrugStock.findMany({
        where: recentlyChangedWhere,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      }),
    ]);
    const adoptedChangedYjCodes = new Set(
      [...selectedQueueRows, ...recentlyChangedSample].map((stock) => stock.drug_master.yj_code),
    );
    const recentChanges =
      adoptedChangedYjCodes.size > 0
        ? await prisma.drugMasterChangeEvent.findMany({
            where: {
              yj_code: { in: [...adoptedChangedYjCodes] },
              source: 'mhlw_price',
              created_at: { gte: recentChangeCutoff },
            },
            orderBy: [{ created_at: 'desc' }],
            take: 200,
            select: {
              id: true,
              yj_code: true,
              change_type: true,
              previous_value: true,
              current_value: true,
              created_at: true,
            },
          })
        : [];

    return success({
      site,
      checked_at: now.toISOString(),
      thresholds: {
        expiry_within_days: parsed.data.expiry_within_days,
        review_overdue_days: parsed.data.review_overdue_days,
      },
      selected_queue: {
        key: parsed.data.queue,
        rows: selectedQueueRows,
        total_count: {
          action_required: actionRequiredCount,
          recently_changed: recentMasterChangeCount,
          transitional_expiry: transitionalExpiryCount,
          missing_reorder_point: missingReorderPointCount,
          safety_flagged: safetyFlaggedCount,
          review_due: reviewDueCount,
        }[parsed.data.queue],
      },
      totals: {
        stocked_count: stockedCount,
        review_due_count: reviewDueCount,
        missing_reorder_point_count: missingReorderPointCount,
        safety_flagged_count: safetyFlaggedCount,
        transitional_expiry_count: transitionalExpiryCount,
        action_required_count: actionRequiredCount,
        recent_master_change_count: recentMasterChangeCount,
      },
      recent_changes: recentChanges,
      samples: {
        review_due: reviewDueSample,
        missing_reorder_point: missingReorderPointSample,
        safety_flagged: safetyFlaggedSample,
        transitional_expiry: transitionalExpirySample,
        action_required: actionRequiredSample,
        recently_changed: recentlyChangedSample,
      },
    });
  },
  { permission: 'canAdmin' },
);
