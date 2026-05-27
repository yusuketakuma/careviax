import { NextRequest } from 'next/server';
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

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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

    const stocks = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        is_stocked: true,
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 500,
      select: {
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
      },
    });
    const recentChanges =
      stocks.length > 0
        ? await prisma.drugMasterChangeEvent.findMany({
            where: {
              yj_code: { in: stocks.map((stock) => stock.drug_master.yj_code) },
              source: 'mhlw_price',
              created_at: { gte: addDays(now, -30) },
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
    const changedYjCodes = new Set(recentChanges.map((change) => change.yj_code));

    const reviewDue = stocks.filter(
      (stock) => !stock.last_reviewed_at || stock.last_reviewed_at < reviewCutoff,
    );
    const missingReorderPoint = stocks.filter((stock) => stock.reorder_point == null);
    const safetyFlagged = stocks.filter(
      (stock) =>
        stock.drug_master.is_high_risk ||
        stock.drug_master.is_lasa_risk ||
        stock.drug_master.is_narcotic ||
        stock.drug_master.is_psychotropic,
    );
    const transitionalExpiry = stocks.filter((stock) => {
      const expiry = stock.drug_master.transitional_expiry_date;
      return Boolean(expiry && expiry >= now && expiry <= expiryUntil);
    });
    const actionRequired = stocks.filter((stock) => {
      if (stock.follow_up_status && stock.follow_up_status !== 'active') {
        return stock.follow_up_status !== 'resolved';
      }
      const expiry = stock.drug_master.transitional_expiry_date;
      return Boolean(
        (expiry && expiry >= now && expiry <= expiryUntil) ||
          changedYjCodes.has(stock.drug_master.yj_code),
      );
    });
    const recentlyChanged = stocks.filter((stock) => changedYjCodes.has(stock.drug_master.yj_code));
    const queueRowsByKey = {
      action_required: actionRequired,
      recently_changed: recentlyChanged,
      transitional_expiry: transitionalExpiry,
      missing_reorder_point: missingReorderPoint,
      safety_flagged: safetyFlagged,
      review_due: reviewDue,
    };
    const selectedQueueRows = queueRowsByKey[parsed.data.queue].slice(0, parsed.data.queue_limit);

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
        total_count: queueRowsByKey[parsed.data.queue].length,
      },
      totals: {
        stocked_count: stocks.length,
        review_due_count: reviewDue.length,
        missing_reorder_point_count: missingReorderPoint.length,
        safety_flagged_count: safetyFlagged.length,
        transitional_expiry_count: transitionalExpiry.length,
        action_required_count: actionRequired.length,
        recent_master_change_count: recentlyChanged.length,
      },
      recent_changes: recentChanges,
      samples: {
        review_due: reviewDue.slice(0, 10),
        missing_reorder_point: missingReorderPoint.slice(0, 10),
        safety_flagged: safetyFlagged.slice(0, 10),
        transitional_expiry: transitionalExpiry.slice(0, 10),
        action_required: actionRequired.slice(0, 10),
        recently_changed: recentlyChanged.slice(0, 10),
      },
    });
  },
  { permission: 'canAdmin' },
);
