import { describe, expect, it } from 'vitest';
import { billingEvidenceAnalyticsResponseSchema } from './analytics-response-schema';

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

function response() {
  return {
    data: {
      summary: {
        ssot_rule_count: 4,
        current_month: '2026-06',
        current_month_candidates: 12,
        current_month_review_pending: 6,
        current_month_claimable_rate: 75,
        current_month_close_rate: 50,
        current_month_exported: 3,
        current_month_revision_counts: { v1: 12 },
        current_month_site_config_issue_count: 0,
      },
      monthly_trend: MONTHS.map((month) => ({
        month,
        total_candidates: month === '2026-06' ? 12 : 0,
        review_pending: month === '2026-06' ? 6 : 0,
        confirmed: month === '2026-06' ? 2 : 0,
        excluded: month === '2026-06' ? 1 : 0,
        exported: month === '2026-06' ? 3 : 0,
        claimable_evidence: month === '2026-06' ? 9 : 0,
        unclaimable_evidence: month === '2026-06' ? 3 : 0,
        revision_counts: {},
        site_config_issue_count: 0,
      })),
      blocker_reasons: [{ reason: '添付書類未確認', count: 2 }],
      top_codes: [
        { billing_code: 'ZAI-001', billing_name: '在宅患者訪問薬剤管理指導料', count: 5 },
      ],
    },
  };
}

describe('billingEvidenceAnalyticsResponseSchema', () => {
  it('projects provider-only revision metadata out of the client contract', () => {
    const parsed = billingEvidenceAnalyticsResponseSchema.parse(response());

    expect(parsed.data.summary).not.toHaveProperty('current_month_revision_counts');
    expect(parsed.data.monthly_trend[5]).not.toHaveProperty('revision_counts');
  });

  it.each([
    ['legacy root', () => response().data],
    [
      'non-consecutive months',
      () => {
        const payload = response();
        payload.data.monthly_trend[3].month = '2026-05';
        return payload;
      },
    ],
    [
      'status-count drift',
      () => {
        const payload = response();
        payload.data.monthly_trend[5].total_candidates = 13;
        return payload;
      },
    ],
    [
      'summary-rate drift',
      () => {
        const payload = response();
        payload.data.summary.current_month_claimable_rate = 74;
        return payload;
      },
    ],
    [
      'summary month outside trend',
      () => {
        const payload = response();
        payload.data.summary.current_month = '2025-12';
        return payload;
      },
    ],
  ])('rejects %s analytics payloads', (_label, buildPayload) => {
    expect(billingEvidenceAnalyticsResponseSchema.safeParse(buildPayload()).success).toBe(false);
  });
});
