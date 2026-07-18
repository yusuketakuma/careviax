import { describe, expect, it } from 'vitest';
import type { BillingCheckResponse } from '@/types/billing-check';
import { billingCheckResponseSchema } from './billing-check-response-schema';

function validResponse(): { data: BillingCheckResponse } {
  return {
    data: {
      generated_at: '2026-07-13T00:00:00.000Z',
      month: 'current',
      month_label: '2026年7月分',
      month_short_label: '7月分',
      passed_count: 1,
      review_count: 1,
      today_pending_count: 0,
      review_rows: [
        {
          id: 'candidate_1',
          patient_label: '患者A 様',
          patient_href: '/patients/patient_1',
          billing_name: '在宅患者訪問薬剤管理指導料',
          confirm_text: '算定要件の事実確認が必要です',
          evidence_label: '算定要件',
          evidence_href: '/admin/billing-rules',
          action_label: '→ カードへ',
          action_href: '/patients/patient_1',
        },
      ],
      records: {
        rule_revision_label: '令和8年改定',
        rejection_count: 0,
        summary_template_kind_count: 1,
      },
      rail: {
        next_action: {
          label: '疑義を確認',
          description: '確認待ち候補を確認します。',
          href: '/billing/candidates',
        },
        blocked_reasons: [],
      },
    },
  };
}

describe('billingCheckResponseSchema', () => {
  it('accepts the bounded provider envelope and strips unused provider fields', () => {
    const payload = validResponse();
    const parsed = billingCheckResponseSchema.parse({
      ...payload,
      data: {
        ...payload.data,
        provider_internal: 'not cached',
        review_rows: [{ ...payload.data.review_rows[0], patient_id: 'not cached' }],
      },
    });

    expect(parsed).toEqual(payload);
  });

  it('accepts official MHLW evidence URLs but rejects untrusted external evidence URLs', () => {
    const official = validResponse();
    official.data.review_rows[0].evidence_href =
      'https://www.mhlw.go.jp/content/12400000/001665294.pdf';
    expect(billingCheckResponseSchema.safeParse(official).success).toBe(true);

    const untrusted = validResponse();
    untrusted.data.review_rows[0].evidence_href = 'https://example.test/billing-rule';
    expect(billingCheckResponseSchema.safeParse(untrusted).success).toBe(false);
  });

  it.each([
    [
      'negative count',
      (payload: ReturnType<typeof validResponse>) => (payload.data.passed_count = -1),
    ],
    [
      'duplicate review identity',
      (payload: ReturnType<typeof validResponse>) => {
        payload.data.review_count = 2;
        payload.data.review_rows.push({ ...payload.data.review_rows[0] });
      },
    ],
    [
      'too many blocked reasons',
      (payload: ReturnType<typeof validResponse>) => {
        payload.data.rail.blocked_reasons = Array.from({ length: 4 }, (_, index) => ({
          id: `reason_${index}`,
          label: '確認待ち',
          severity: 'warning' as const,
          category: '事務',
          age_minutes: index,
          action_label: '確認する',
          action_href: '/billing/candidates',
        }));
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const payload = validResponse();
    mutate(payload);
    expect(billingCheckResponseSchema.safeParse(payload).success).toBe(false);
  });
});
