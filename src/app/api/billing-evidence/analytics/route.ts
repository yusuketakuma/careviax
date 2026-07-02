import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectString } from '@/lib/db/json';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { billingMonthForJapanTimestamp } from '@/server/services/billing-evidence';

function addUtcMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function formatMonth(value: Date) {
  return value.toISOString().slice(0, 7);
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '請求分析の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const currentMonth = billingMonthForJapanTimestamp(new Date());
    const rangeStart = addUtcMonths(currentMonth, -5);
    const candidateWhere = {
      org_id: ctx.orgId,
      billing_month: {
        gte: rangeStart,
      },
    };
    const evidenceWhere = {
      org_id: ctx.orgId,
      billing_month: {
        gte: rangeStart,
      },
    };

    const [
      candidateRevisionRows,
      candidateStatusGroups,
      topCodeGroups,
      evidenceContextRows,
      evidenceClaimableGroups,
      blockerReasonGroups,
      ssotRuleCount,
    ] = await Promise.all([
      prisma.billingCandidate.findMany({
        where: candidateWhere,
        select: {
          billing_month: true,
          source_snapshot: true,
        },
        orderBy: [{ billing_month: 'asc' }, { created_at: 'asc' }],
      }),
      prisma.billingCandidate.groupBy({
        by: ['billing_month', 'status'],
        where: candidateWhere,
        _count: { id: true },
      }),
      prisma.billingCandidate.groupBy({
        by: ['billing_code', 'billing_name'],
        where: {
          ...candidateWhere,
          status: { in: ['confirmed', 'exported'] },
        },
        _count: { id: true },
        orderBy: [{ _count: { id: 'desc' } }, { billing_code: 'asc' }],
        take: 5,
      }),
      prisma.billingEvidence.findMany({
        where: evidenceWhere,
        select: {
          billing_month: true,
          calculation_context: true,
        },
        orderBy: [{ billing_month: 'asc' }, { created_at: 'asc' }],
      }),
      prisma.billingEvidence.groupBy({
        by: ['billing_month', 'claimable'],
        where: evidenceWhere,
        _count: { id: true },
      }),
      prisma.billingEvidence.groupBy({
        by: ['exclusion_reason'],
        where: {
          ...evidenceWhere,
          claimable: false,
          exclusion_reason: { not: null },
        },
        _count: { id: true },
        orderBy: [{ _count: { id: 'desc' } }, { exclusion_reason: 'asc' }],
        take: 5,
      }),
      prisma.billingRule.count({
        where: {
          org_id: ctx.orgId,
          billing_scope: 'home_care_ssot',
          is_active: true,
        },
      }),
    ]);

    const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
      const month = addUtcMonths(currentMonth, index - 5);
      return {
        month: formatMonth(month),
        total_candidates: 0,
        review_pending: 0,
        confirmed: 0,
        excluded: 0,
        exported: 0,
        claimable_evidence: 0,
        unclaimable_evidence: 0,
        revision_counts: {} as Record<string, number>,
        site_config_issue_count: 0,
      };
    });
    const monthlyTrendByMonth = new Map(monthlyTrend.map((item) => [item.month, item]));
    const topCodes = new Map<
      string,
      { billing_code: string; billing_name: string; count: number }
    >();
    const blockerReasons = new Map<string, number>();
    const observedMonths = new Set<string>();

    for (const group of candidateStatusGroups) {
      const monthKey = formatMonth(group.billing_month);
      observedMonths.add(monthKey);
      const bucket = monthlyTrendByMonth.get(monthKey);
      if (!bucket) continue;

      const count = group._count.id;
      bucket.total_candidates += count;
      switch (group.status) {
        case 'confirmed':
          bucket.confirmed += count;
          break;
        case 'excluded':
          bucket.excluded += count;
          break;
        case 'exported':
          bucket.exported += count;
          break;
        default:
          bucket.review_pending += count;
          break;
      }
    }

    for (const candidate of candidateRevisionRows) {
      const monthKey = formatMonth(candidate.billing_month);
      observedMonths.add(monthKey);
      const bucket = monthlyTrendByMonth.get(monthKey);
      if (!bucket) continue;
      const candidateRevision =
        readJsonObjectString(candidate.source_snapshot, 'revision_code') ?? 'unknown';
      bucket.revision_counts[candidateRevision] =
        (bucket.revision_counts[candidateRevision] ?? 0) + 1;
    }

    for (const group of topCodeGroups) {
      topCodes.set(`${group.billing_code}:${group.billing_name}`, {
        billing_code: group.billing_code,
        billing_name: group.billing_name,
        count: group._count.id,
      });
    }

    for (const group of evidenceClaimableGroups) {
      if (!group.billing_month) continue;
      const monthKey = formatMonth(group.billing_month);
      observedMonths.add(monthKey);
      const bucket = monthlyTrendByMonth.get(monthKey);
      if (!bucket) continue;
      if (group.claimable) {
        bucket.claimable_evidence += group._count.id;
      } else {
        bucket.unclaimable_evidence += group._count.id;
      }
    }

    for (const group of blockerReasonGroups) {
      if (group.exclusion_reason) {
        blockerReasons.set(group.exclusion_reason, group._count.id);
      }
    }

    for (const evidence of evidenceContextRows) {
      if (!evidence.billing_month) continue;
      const monthKey = formatMonth(evidence.billing_month);
      observedMonths.add(monthKey);
      const bucket = monthlyTrendByMonth.get(monthKey);
      if (!bucket) continue;
      const evidenceRevision =
        readJsonObjectString(evidence.calculation_context, 'effective_revision_code') ?? 'unknown';
      bucket.revision_counts[evidenceRevision] =
        (bucket.revision_counts[evidenceRevision] ?? 0) + 1;
      const siteConfigStatus = readJsonObjectString(
        evidence.calculation_context,
        'site_config_status',
      );
      if (siteConfigStatus === 'config_missing' || siteConfigStatus === 'revision_mismatch') {
        bucket.site_config_issue_count += 1;
      }
    }

    const currentMonthKey = formatMonth(currentMonth);
    const summaryMonthKey =
      monthlyTrendByMonth.get(currentMonthKey)?.total_candidates ||
      monthlyTrendByMonth.get(currentMonthKey)?.claimable_evidence ||
      monthlyTrendByMonth.get(currentMonthKey)?.unclaimable_evidence
        ? currentMonthKey
        : ([...observedMonths].sort().at(-1) ?? currentMonthKey);
    const currentMonthBucket =
      monthlyTrendByMonth.get(summaryMonthKey) ?? monthlyTrend[monthlyTrend.length - 1];
    const claimableEvidenceTotal =
      currentMonthBucket.claimable_evidence + currentMonthBucket.unclaimable_evidence;
    const currentMonthClaimableRate =
      claimableEvidenceTotal === 0
        ? 0
        : Math.round((currentMonthBucket.claimable_evidence / claimableEvidenceTotal) * 100);
    const currentMonthCloseRate =
      currentMonthBucket.total_candidates === 0
        ? 0
        : Math.round(
            ((currentMonthBucket.confirmed +
              currentMonthBucket.exported +
              currentMonthBucket.excluded) /
              currentMonthBucket.total_candidates) *
              100,
          );

    return success({
      data: {
        summary: {
          ssot_rule_count: ssotRuleCount,
          current_month: summaryMonthKey,
          current_month_candidates: currentMonthBucket.total_candidates,
          current_month_review_pending: currentMonthBucket.review_pending,
          current_month_claimable_rate: currentMonthClaimableRate,
          current_month_close_rate: currentMonthCloseRate,
          current_month_exported: currentMonthBucket.exported,
          current_month_revision_counts: currentMonthBucket.revision_counts,
          current_month_site_config_issue_count: currentMonthBucket.site_config_issue_count,
        },
        monthly_trend: monthlyTrend,
        blocker_reasons: Array.from(blockerReasons.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort(
            (left, right) =>
              right.count - left.count || left.reason.localeCompare(right.reason, 'ja'),
          )
          .slice(0, 5),
        top_codes: Array.from(topCodes.values())
          .sort(
            (left, right) =>
              right.count - left.count || left.billing_code.localeCompare(right.billing_code),
          )
          .slice(0, 5),
      },
    });
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'billing_evidence_analytics_unhandled_error',
          route: req.nextUrl?.pathname ?? '/api/billing-evidence/analytics',
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
