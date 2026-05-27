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
  price_impact_days: z.coerce.number().int().min(1).max(365).default(90),
  price_impact_draft_limit: z.coerce.number().int().min(1).max(1000).default(500),
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

const CHANGE_REPORT_LIMIT = 50;

type ParsedMedication = {
  drugCode?: unknown;
  drugName?: unknown;
};

function readMedications(parsedData: unknown): ParsedMedication[] {
  if (!parsedData || typeof parsedData !== 'object') return [];
  const medications = (parsedData as { medications?: unknown }).medications;
  return Array.isArray(medications) ? (medications as ParsedMedication[]) : [];
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
      masterChangeReportRows,
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
        where: recentlyChangedWhere,
        orderBy: queueOrderBy,
        take: CHANGE_REPORT_LIMIT,
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
