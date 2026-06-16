import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';

const impactQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  expiry_within_days: boundedIntegerSearchParam('expiry_within_days', 1, 365, 90),
  review_overdue_days: boundedIntegerSearchParam('review_overdue_days', 30, 730, 180),
  price_impact_days: boundedIntegerSearchParam('price_impact_days', 1, 365, 90),
  price_impact_draft_limit: boundedIntegerSearchParam('price_impact_draft_limit', 1, 1000, 500),
  queue: z
    .enum([
      'action_required',
      'recently_changed',
      'transitional_expiry',
      'missing_reorder_point',
      'safety_flagged',
      'high_risk',
      'lasa_risk',
      'controlled',
      'review_due',
    ])
    .default('action_required'),
  queue_limit: boundedIntegerSearchParam('queue_limit', 1, 100, 25),
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

const CHANGE_REPORT_LIMIT = 50;

type StockImpactCountsRow = {
  stocked_count: unknown;
  review_due_count: unknown;
  missing_reorder_point_count: unknown;
  safety_flagged_count: unknown;
  high_risk_count: unknown;
  lasa_risk_count: unknown;
  controlled_count: unknown;
  transitional_expiry_count: unknown;
  transitional_expiry_within_30_count: unknown;
  transitional_expiry_within_60_count: unknown;
  action_required_count: unknown;
  recent_master_change_count: unknown;
  unresolved_follow_up_count: unknown;
  overdue_follow_up_count: unknown;
  missing_due_follow_up_count: unknown;
};

type ParsedMedication = {
  drugCode?: unknown;
  drugName?: unknown;
};

function readMedications(parsedData: unknown): ParsedMedication[] {
  const medications = readJsonObject(parsedData)?.medications;
  if (!Array.isArray(medications)) return [];
  return medications.flatMap((medication): ParsedMedication[] => {
    const record = readJsonObject(medication);
    if (!record) return [];
    return [{ drugCode: record.drugCode, drugName: record.drugName }];
  });
}

function normalizeYjCode(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 12) : '';
}

function readDrugPrice(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const drugPrice = (value as { drug_price?: unknown }).drug_price;
  if (typeof drugPrice === 'number') return Number.isFinite(drugPrice) ? drugPrice : null;
  if (typeof drugPrice !== 'string') return null;
  const normalized = drugPrice.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function loadStockImpactCounts(args: {
  orgId: string;
  siteId: string;
  now: Date;
  reviewCutoff: Date;
  expiryUntil: Date;
  expiryWithin30: Date;
  expiryWithin60: Date;
  changedYjCodes: string[];
}): Promise<StockImpactCountsRow> {
  const [row] = await prisma.$queryRaw<StockImpactCountsRow[]>`
    SELECT
      COUNT(*) AS stocked_count,
      COUNT(*) FILTER (
        WHERE stock.last_reviewed_at IS NULL OR stock.last_reviewed_at < ${args.reviewCutoff}
      ) AS review_due_count,
      COUNT(*) FILTER (WHERE stock.reorder_point IS NULL) AS missing_reorder_point_count,
      COUNT(*) FILTER (
        WHERE drug.is_high_risk = true
           OR drug.is_lasa_risk = true
           OR drug.is_narcotic = true
           OR drug.is_psychotropic = true
      ) AS safety_flagged_count,
      COUNT(*) FILTER (WHERE drug.is_high_risk = true) AS high_risk_count,
      COUNT(*) FILTER (WHERE drug.is_lasa_risk = true) AS lasa_risk_count,
      COUNT(*) FILTER (
        WHERE drug.is_narcotic = true OR drug.is_psychotropic = true
      ) AS controlled_count,
      COUNT(*) FILTER (
        WHERE drug.transitional_expiry_date >= ${args.now}
          AND drug.transitional_expiry_date <= ${args.expiryUntil}
      ) AS transitional_expiry_count,
      COUNT(*) FILTER (
        WHERE drug.transitional_expiry_date >= ${args.now}
          AND drug.transitional_expiry_date <= ${args.expiryWithin30}
      ) AS transitional_expiry_within_30_count,
      COUNT(*) FILTER (
        WHERE drug.transitional_expiry_date >= ${args.now}
          AND drug.transitional_expiry_date <= ${args.expiryWithin60}
      ) AS transitional_expiry_within_60_count,
      COUNT(*) FILTER (
        WHERE (
          stock.follow_up_status IS NOT NULL
          AND stock.follow_up_status NOT IN ('active', 'resolved', '')
        ) OR (
          (stock.follow_up_status IS NULL OR stock.follow_up_status = 'active')
          AND (
            (
              drug.transitional_expiry_date >= ${args.now}
              AND drug.transitional_expiry_date <= ${args.expiryUntil}
            )
            OR drug.yj_code = ANY(${args.changedYjCodes}::text[])
          )
        )
      ) AS action_required_count,
      COUNT(*) FILTER (WHERE drug.yj_code = ANY(${args.changedYjCodes}::text[])) AS recent_master_change_count,
      COUNT(*) FILTER (
        WHERE stock.follow_up_status IS NOT NULL
          AND stock.follow_up_status NOT IN ('active', 'resolved', '')
      ) AS unresolved_follow_up_count,
      COUNT(*) FILTER (
        WHERE stock.follow_up_status IS NOT NULL
          AND stock.follow_up_status NOT IN ('active', 'resolved', '')
          AND stock.follow_up_due_date < ${args.now}
      ) AS overdue_follow_up_count,
      COUNT(*) FILTER (
        WHERE stock.follow_up_status IS NOT NULL
          AND stock.follow_up_status NOT IN ('active', 'resolved', '')
          AND stock.follow_up_due_date IS NULL
      ) AS missing_due_follow_up_count
    FROM "PharmacyDrugStock" stock
    INNER JOIN "DrugMaster" drug ON drug.id = stock.drug_master_id
    WHERE stock.org_id = ${args.orgId}
      AND stock.site_id = ${args.siteId}
      AND stock.is_stocked = true
  `;

  return (
    row ?? {
      stocked_count: 0,
      review_due_count: 0,
      missing_reorder_point_count: 0,
      safety_flagged_count: 0,
      high_risk_count: 0,
      lasa_risk_count: 0,
      controlled_count: 0,
      transitional_expiry_count: 0,
      transitional_expiry_within_30_count: 0,
      transitional_expiry_within_60_count: 0,
      action_required_count: 0,
      recent_master_change_count: 0,
      unresolved_follow_up_count: 0,
      overdue_follow_up_count: 0,
      missing_due_follow_up_count: 0,
    }
  );
}

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
    const expiryWithin30 = addDays(now, 30);
    const expiryWithin60 = addDays(now, 60);
    const expiryUntil = addDays(now, parsed.data.expiry_within_days);
    const reviewCutoff = addDays(now, -parsed.data.review_overdue_days);
    const recentChangeCutoff = addDays(now, -30);
    const priceImpactCutoff = addDays(now, -parsed.data.price_impact_days);

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
    const highRiskWhere = {
      ...baseWhere,
      drug_master: { is_high_risk: true },
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const lasaRiskWhere = {
      ...baseWhere,
      drug_master: { is_lasa_risk: true },
    } satisfies Prisma.PharmacyDrugStockWhereInput;
    const controlledWhere = {
      ...baseWhere,
      drug_master: {
        OR: [{ is_narcotic: true }, { is_psychotropic: true }],
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
      high_risk: highRiskWhere,
      lasa_risk: lasaRiskWhere,
      controlled: controlledWhere,
      review_due: reviewDueWhere,
    };
    const queueOrderBy = [
      { updated_at: 'desc' },
    ] satisfies Prisma.PharmacyDrugStockOrderByWithRelationInput[];
    const countsPromise = loadStockImpactCounts({
      orgId: authCtx.orgId,
      siteId: site.id,
      now,
      reviewCutoff,
      expiryUntil,
      expiryWithin30,
      expiryWithin60,
      changedYjCodes,
    });
    const selectedQueueRowsPromise = prisma.pharmacyDrugStock.findMany({
      where: queueWhereByKey[parsed.data.queue],
      orderBy: queueOrderBy,
      take: parsed.data.queue_limit,
      select: stockImpactSelect,
    });
    const masterChangeReportRowsPromise = prisma.pharmacyDrugStock.findMany({
      where: recentlyChangedWhere,
      orderBy: queueOrderBy,
      take: CHANGE_REPORT_LIMIT,
      select: stockImpactSelect,
    });
    const sampleRows = (
      queueKey: ImpactQueueKey,
      where: Prisma.PharmacyDrugStockWhereInput,
    ): Promise<Awaited<typeof selectedQueueRowsPromise>> => {
      if (parsed.data.queue === queueKey && parsed.data.queue_limit >= 10) {
        return selectedQueueRowsPromise.then((rows) => rows.slice(0, 10));
      }

      return prisma.pharmacyDrugStock.findMany({
        where,
        orderBy: queueOrderBy,
        take: 10,
        select: stockImpactSelect,
      });
    };
    const [
      countsRow,
      selectedQueueRows,
      masterChangeReportRows,
      reviewDueSample,
      missingReorderPointSample,
      safetyFlaggedSample,
      highRiskSample,
      lasaRiskSample,
      controlledSample,
      transitionalExpirySample,
      actionRequiredSample,
      recentlyChangedSample,
    ] = await Promise.all([
      countsPromise,
      selectedQueueRowsPromise,
      masterChangeReportRowsPromise,
      sampleRows('review_due', reviewDueWhere),
      sampleRows('missing_reorder_point', missingReorderWhere),
      sampleRows('safety_flagged', safetyFlaggedWhere),
      sampleRows('high_risk', highRiskWhere),
      sampleRows('lasa_risk', lasaRiskWhere),
      sampleRows('controlled', controlledWhere),
      sampleRows('transitional_expiry', transitionalExpiryWhere),
      sampleRows('action_required', actionRequiredWhere),
      masterChangeReportRowsPromise.then((rows) => rows.slice(0, 10)),
    ]);
    const stockedCount = readCount(countsRow.stocked_count);
    const reviewDueCount = readCount(countsRow.review_due_count);
    const missingReorderPointCount = readCount(countsRow.missing_reorder_point_count);
    const safetyFlaggedCount = readCount(countsRow.safety_flagged_count);
    const highRiskCount = readCount(countsRow.high_risk_count);
    const lasaRiskCount = readCount(countsRow.lasa_risk_count);
    const controlledCount = readCount(countsRow.controlled_count);
    const transitionalExpiryCount = readCount(countsRow.transitional_expiry_count);
    const transitionalExpiryWithin30Count = readCount(
      countsRow.transitional_expiry_within_30_count,
    );
    const transitionalExpiryWithin60Count = readCount(
      countsRow.transitional_expiry_within_60_count,
    );
    const actionRequiredCount = readCount(countsRow.action_required_count);
    const recentMasterChangeCount = readCount(countsRow.recent_master_change_count);
    const unresolvedFollowUpCount = readCount(countsRow.unresolved_follow_up_count);
    const overdueFollowUpCount = readCount(countsRow.overdue_follow_up_count);
    const missingDueFollowUpCount = readCount(countsRow.missing_due_follow_up_count);
    const adoptedChangedYjCodes = new Set(
      [...selectedQueueRows, ...recentlyChangedSample, ...masterChangeReportRows].map(
        (stock) => stock.drug_master.yj_code,
      ),
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
    const recentChangesByYjCode = new Map<string, typeof recentChanges>();
    const changeTypeCounts = new Map<string, number>();
    for (const change of recentChanges) {
      const changes = recentChangesByYjCode.get(change.yj_code) ?? [];
      changes.push(change);
      recentChangesByYjCode.set(change.yj_code, changes);
      changeTypeCounts.set(change.change_type, (changeTypeCounts.get(change.change_type) ?? 0) + 1);
    }
    const priceChangedYjCodes = [
      ...new Set(
        recentChanges
          .filter((change) => change.change_type === 'price_changed')
          .map((change) => change.yj_code),
      ),
    ];
    const priceImpactDrafts =
      priceChangedYjCodes.length > 0
        ? await prisma.qrScanDraft.findMany({
            where: {
              org_id: authCtx.orgId,
              site_id: site.id,
              status: { not: 'discarded' },
              created_at: { gte: priceImpactCutoff },
            },
            orderBy: [{ created_at: 'desc' }],
            take: parsed.data.price_impact_draft_limit,
            select: {
              parsed_data: true,
            },
          })
        : [];
    const priceChangedYjSet = new Set(priceChangedYjCodes);
    const usageCountByYjCode = new Map<string, number>();
    for (const draft of priceImpactDrafts) {
      for (const medication of readMedications(draft.parsed_data)) {
        const yjCode = normalizeYjCode(medication.drugCode);
        if (!yjCode || !priceChangedYjSet.has(yjCode)) continue;
        usageCountByYjCode.set(yjCode, (usageCountByYjCode.get(yjCode) ?? 0) + 1);
      }
    }
    const priceImpactRows = masterChangeReportRows
      .map((stock) => {
        const priceChange = (recentChangesByYjCode.get(stock.drug_master.yj_code) ?? []).find(
          (change) => change.change_type === 'price_changed',
        );
        const previousPrice = readDrugPrice(priceChange?.previous_value);
        const currentPrice = readDrugPrice(priceChange?.current_value);
        const usageCount = usageCountByYjCode.get(stock.drug_master.yj_code) ?? 0;
        const unitDelta =
          previousPrice != null && currentPrice != null ? currentPrice - previousPrice : null;
        return {
          stock,
          previous_price: previousPrice,
          current_price: currentPrice,
          unit_price_delta: unitDelta,
          usage_count: usageCount,
          estimated_total_delta:
            unitDelta != null ? Number((unitDelta * usageCount).toFixed(2)) : null,
        };
      })
      .filter((row) => row.unit_price_delta != null)
      .sort(
        (a, b) =>
          Math.abs(b.estimated_total_delta ?? 0) - Math.abs(a.estimated_total_delta ?? 0) ||
          b.usage_count - a.usage_count,
      );
    const estimatedTotalDelta = priceImpactRows.reduce(
      (sum, row) => sum + (row.estimated_total_delta ?? 0),
      0,
    );

    return success({
      site,
      checked_at: now.toISOString(),
      thresholds: {
        expiry_within_days: parsed.data.expiry_within_days,
        review_overdue_days: parsed.data.review_overdue_days,
        price_impact_days: parsed.data.price_impact_days,
        price_impact_draft_limit: parsed.data.price_impact_draft_limit,
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
          high_risk: highRiskCount,
          lasa_risk: lasaRiskCount,
          controlled: controlledCount,
          review_due: reviewDueCount,
        }[parsed.data.queue],
      },
      totals: {
        stocked_count: stockedCount,
        review_due_count: reviewDueCount,
        missing_reorder_point_count: missingReorderPointCount,
        safety_flagged_count: safetyFlaggedCount,
        high_risk_count: highRiskCount,
        lasa_risk_count: lasaRiskCount,
        controlled_count: controlledCount,
        transitional_expiry_count: transitionalExpiryCount,
        transitional_expiry_within_30_count: transitionalExpiryWithin30Count,
        transitional_expiry_within_60_count: transitionalExpiryWithin60Count,
        transitional_expiry_within_90_count: transitionalExpiryCount,
        action_required_count: actionRequiredCount,
        recent_master_change_count: recentMasterChangeCount,
      },
      master_change_report: {
        cutoff: recentChangeCutoff.toISOString(),
        total_count: recentMasterChangeCount,
        sampled_count: masterChangeReportRows.length,
        is_truncated: recentMasterChangeCount > masterChangeReportRows.length,
        change_type_counts: [...changeTypeCounts.entries()]
          .map(([change_type, count]) => ({ change_type, count }))
          .sort((a, b) => b.count - a.count || a.change_type.localeCompare(b.change_type)),
        rows: masterChangeReportRows.map((stock) => ({
          stock,
          changes: recentChangesByYjCode.get(stock.drug_master.yj_code) ?? [],
        })),
        price_impact: {
          usage_window_days: parsed.data.price_impact_days,
          scanned_draft_count: priceImpactDrafts.length,
          estimated_total_delta: Number(estimatedTotalDelta.toFixed(2)),
          rows: priceImpactRows.slice(0, 10),
        },
      },
      follow_up_summary: {
        unresolved_count: unresolvedFollowUpCount,
        overdue_count: overdueFollowUpCount,
        missing_due_date_count: missingDueFollowUpCount,
      },
      recent_changes: recentChanges,
      samples: {
        review_due: reviewDueSample,
        missing_reorder_point: missingReorderPointSample,
        safety_flagged: safetyFlaggedSample,
        high_risk: highRiskSample,
        lasa_risk: lasaRiskSample,
        controlled: controlledSample,
        transitional_expiry: transitionalExpirySample,
        action_required: actionRequiredSample,
        recently_changed: recentlyChangedSample,
      },
    });
  },
  { permission: 'canAdmin' },
);
