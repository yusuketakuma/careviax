import { describe, expect, it } from 'vitest';
import type { FeeRuleView } from '@/phos/contracts/phos_contracts';
import { evaluateFeeRuleCandidate, evaluateFeeRuleCondition, FeeRuleDslError } from './feeRuleDsl';

const allowed = new Set(['visit_type', 'same_building_count', 'has_management_plan']);

const rule = {
  rule_id: 'rule_1',
  rule_version_id: 'rv_2026',
  fee_code: 'M001',
  fee_label: '在宅患者訪問薬剤管理指導料',
  tenant_scope: 'SYSTEM',
  revision_code: '2026',
  active_from: '2026-04-01',
  condition: {
    op: 'AND',
    conditions: [
      { op: 'EQ', field: 'visit_type', value: 'home_visit' },
      { op: 'LTE', field: 'same_building_count', value: 9 },
    ],
  },
  evidence_requirements: [
    {
      evidence_key: 'management_plan',
      label: '薬学的管理指導計画',
      required: true,
      source_kind: 'EVIDENCE_FILE',
    },
  ],
  source_refs: [{ kind: 'RULE_DOCUMENT', ref_id: 'rule_doc_1', label: '2026改定' }],
} satisfies FeeRuleView;

describe('FeeRule DSL', () => {
  it('evaluates only the allowed typed operators', () => {
    expect(
      evaluateFeeRuleCondition(
        {
          op: 'OR',
          conditions: [
            { op: 'EXISTS', field: 'has_management_plan' },
            { op: 'IN', field: 'visit_type', values: ['home_visit', 'facility_visit'] },
          ],
        },
        { visit_type: 'home_visit', has_management_plan: null },
        allowed,
      ),
    ).toBe(true);
  });

  it('rejects unknown fact fields instead of evaluating arbitrary expressions', () => {
    expect(() =>
      evaluateFeeRuleCondition(
        { op: 'EQ', field: 'constructor.prototype.polluted', value: true },
        { 'constructor.prototype.polluted': true },
        allowed,
      ),
    ).toThrow(FeeRuleDslError);
  });

  it('returns missing evidence keys for matched rules', () => {
    expect(
      evaluateFeeRuleCandidate({
        rule,
        facts: { visit_type: 'home_visit', same_building_count: 3 },
        available_evidence_keys: [],
        allowed_fields: allowed,
      }),
    ).toEqual({
      matched: true,
      missing_evidence_keys: ['management_plan'],
      candidate_status: 'MISSING_EVIDENCE',
    });
  });

  it('marks matched rules ready when required evidence exists', () => {
    expect(
      evaluateFeeRuleCandidate({
        rule,
        facts: { visit_type: 'home_visit', same_building_count: 3 },
        available_evidence_keys: ['management_plan'],
        allowed_fields: allowed,
      }),
    ).toMatchObject({
      matched: true,
      missing_evidence_keys: [],
      candidate_status: 'READY',
    });
  });
});
