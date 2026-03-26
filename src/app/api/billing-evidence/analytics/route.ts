import { NextRequest } from 'next/server';
import { subMonths } from 'date-fns';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { success } from '@/lib/api/response';

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function formatMonth(value: Date) {
  return value.toISOString().slice(0, 7);
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '請求分析の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const currentMonth = startOfMonth(new Date());
  const rangeStart = startOfMonth(subMonths(currentMonth, 5));

  const [candidates, evidences, ssotRuleCount] = await Promise.all([
    prisma.billingCandidate.findMany({
      where: {
        org_id: ctx.orgId,
        billing_month: {
          gte: rangeStart,
        },
      },
      select: {
        billing_month: true,
        status: true,
        billing_code: true,
        billing_name: true,
      },
      orderBy: [{ billing_month: 'asc' }, { created_at: 'asc' }],
    }),
    prisma.billingEvidence.findMany({
      where: {
        org_id: ctx.orgId,
        billing_month: {
          gte: rangeStart,
        },
      },
      select: {
        billing_month: true,
        claimable: true,
        exclusion_reason: true,
      },
      orderBy: [{ billing_month: 'asc' }, { created_at: 'asc' }],
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
    const month = startOfMonth(subMonths(currentMonth, 5 - index));
    return {
      month: formatMonth(month),
      total_candidates: 0,
      review_pending: 0,
      confirmed: 0,
      excluded: 0,
      exported: 0,
      claimable_evidence: 0,
      unclaimable_evidence: 0,
    };
  });
  const monthlyTrendByMonth = new Map(monthlyTrend.map((item) => [item.month, item]));
  const topCodes = new Map<string, { billing_code: string; billing_name: string; count: number }>();
  const blockerReasons = new Map<string, number>();
  const observedMonths = new Set<string>();

  for (const candidate of candidates) {
    const monthKey = formatMonth(candidate.billing_month);
    observedMonths.add(monthKey);
    const bucket = monthlyTrendByMonth.get(monthKey);
    if (!bucket) continue;

    bucket.total_candidates += 1;
    switch (candidate.status) {
      case 'confirmed':
        bucket.confirmed += 1;
        break;
      case 'excluded':
        bucket.excluded += 1;
        break;
      case 'exported':
        bucket.exported += 1;
        break;
      default:
        bucket.review_pending += 1;
        break;
    }

    if (candidate.status === 'confirmed' || candidate.status === 'exported') {
      const key = `${candidate.billing_code}:${candidate.billing_name}`;
      const existing = topCodes.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        topCodes.set(key, {
          billing_code: candidate.billing_code,
          billing_name: candidate.billing_name,
          count: 1,
        });
      }
    }
  }

  for (const evidence of evidences) {
    if (!evidence.billing_month) continue;
    const monthKey = formatMonth(evidence.billing_month);
    observedMonths.add(monthKey);
    const bucket = monthlyTrendByMonth.get(monthKey);
    if (!bucket) continue;

    if (evidence.claimable) {
      bucket.claimable_evidence += 1;
    } else {
      bucket.unclaimable_evidence += 1;
      if (evidence.exclusion_reason) {
        blockerReasons.set(
          evidence.exclusion_reason,
          (blockerReasons.get(evidence.exclusion_reason) ?? 0) + 1
        );
      }
    }
  }

  const currentMonthKey = formatMonth(currentMonth);
  const summaryMonthKey =
    monthlyTrendByMonth.get(currentMonthKey)?.total_candidates ||
    monthlyTrendByMonth.get(currentMonthKey)?.claimable_evidence ||
    monthlyTrendByMonth.get(currentMonthKey)?.unclaimable_evidence
      ? currentMonthKey
      : [...observedMonths].sort().at(-1) ?? currentMonthKey;
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
          ((currentMonthBucket.confirmed + currentMonthBucket.exported + currentMonthBucket.excluded) /
            currentMonthBucket.total_candidates) *
            100
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
      },
      monthly_trend: monthlyTrend,
      blocker_reasons: Array.from(blockerReasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'ja'))
        .slice(0, 5),
      top_codes: Array.from(topCodes.values())
        .sort((left, right) => right.count - left.count || left.billing_code.localeCompare(right.billing_code))
        .slice(0, 5),
    },
  });
}
