import { describe, expect, it } from 'vitest';
import {
  billingRulesResponseSchema,
  billingSsotSyncResponseSchema,
  buildBillingRuleResponseSchema,
} from './response-schema';

const rule = {
  id: 'rule_1',
  org_id: 'org_1',
  billing_scope: 'custom',
  rule_type: 'addition',
  service_type: 'generic',
  payer_basis: null,
  provider_scope: null,
  selection_mode: 'manual',
  calculation_unit: 'point',
  display_order: 1000,
  name: '夜間加算',
  code: 'YAKAN',
  conditions: {},
  evidence_requirements: {},
  amount: 100,
  source_url: null,
  source_note: null,
  is_system: false,
  is_active: true,
  effective_from: null,
  effective_to: null,
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

describe('billingRulesResponseSchema', () => {
  const response = {
    data: [rule],
    meta: {
      source: null,
      summary: { ssot_rule_count: 0, custom_rule_count: 1 },
    },
  };

  it('strips tenant and unused calculation metadata from the client projection', () => {
    const parsed = billingRulesResponseSchema.parse(response);
    expect(parsed.data[0]).not.toHaveProperty('org_id');
    expect(parsed.data[0]).not.toHaveProperty('display_order');
    expect(parsed.data[0]).not.toHaveProperty('effective_from');
  });

  it('rejects duplicate identity, summary drift, and system-scope mismatch', () => {
    expect(billingRulesResponseSchema.safeParse({ ...response, data: [rule, rule] }).success).toBe(
      false,
    );
    expect(
      billingRulesResponseSchema.safeParse({
        ...response,
        meta: { ...response.meta, summary: { ssot_rule_count: 0, custom_rule_count: 0 } },
      }).success,
    ).toBe(false);
    expect(
      billingRulesResponseSchema.safeParse({
        data: [{ ...rule, is_system: true }],
        meta: response.meta,
      }).success,
    ).toBe(false);
  });
});

describe('billing rule mutation schemas', () => {
  it('requires update identity and non-negative SSOT counts', () => {
    expect(buildBillingRuleResponseSchema('rule_2').safeParse({ data: rule }).success).toBe(false);
    expect(
      billingSsotSyncResponseSchema.safeParse({ data: { message: '同期しました', seeded: -1 } })
        .success,
    ).toBe(false);
  });
});
