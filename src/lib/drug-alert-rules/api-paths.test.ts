import { describe, expect, it } from 'vitest';
import { DRUG_ALERT_RULES_API_PATH, buildDrugAlertRuleApiPath } from './api-paths';

describe('drug alert rule API path helpers', () => {
  it('builds the collection API path', () => {
    expect(DRUG_ALERT_RULES_API_PATH).toBe('/api/drug-alert-rules');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildDrugAlertRuleApiPath('rule_1')).toBe('/api/drug-alert-rules/rule_1');
  });

  it('encodes only the rule id path segment', () => {
    const ruleId = 'rule/1?mode=x#frag';

    expect(buildDrugAlertRuleApiPath(ruleId)).toBe(
      `/api/drug-alert-rules/${encodeURIComponent(ruleId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment rule id %s', (ruleId) => {
    expect(() => buildDrugAlertRuleApiPath(ruleId)).toThrow(RangeError);
  });
});
