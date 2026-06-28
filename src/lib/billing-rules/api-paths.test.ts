import { describe, expect, it } from 'vitest';
import { BILLING_RULES_API_PATH, buildBillingRuleApiPath } from './api-paths';

describe('billing rule API path helpers', () => {
  it('builds the collection API path', () => {
    expect(BILLING_RULES_API_PATH).toBe('/api/billing-rules');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildBillingRuleApiPath('rule_1')).toBe('/api/billing-rules/rule_1');
  });

  it('encodes hostile ids as a single path segment', () => {
    const hostileId = 'rule/1 space?mode=x#frag';

    expect(buildBillingRuleApiPath(hostileId)).toBe(
      `/api/billing-rules/${encodeURIComponent(hostileId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment billing rule id %s', (ruleId) => {
    expect(() => buildBillingRuleApiPath(ruleId)).toThrow(RangeError);
  });
});
