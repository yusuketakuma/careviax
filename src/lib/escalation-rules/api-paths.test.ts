import { describe, expect, it } from 'vitest';
import {
  ESCALATION_RULES_API_PATH,
  buildEscalationRuleApiPath,
  buildEscalationRulesApiPath,
} from './api-paths';

describe('escalation rule API path helpers', () => {
  it('builds escalation rule collection paths', () => {
    expect(ESCALATION_RULES_API_PATH).toBe('/api/admin/escalation-rules');
    expect(buildEscalationRulesApiPath()).toBe('/api/admin/escalation-rules');
  });

  it('builds escalation rule collection paths with encoded query params', () => {
    const params = new URLSearchParams({
      limit: '50',
      cursor: 'rule/1?x=y#frag',
    });

    expect(buildEscalationRulesApiPath(params)).toBe(
      '/api/admin/escalation-rules?limit=50&cursor=rule%2F1%3Fx%3Dy%23frag',
    );
  });

  it('builds escalation rule detail paths for normal ids', () => {
    expect(buildEscalationRuleApiPath('rule_1')).toBe('/api/admin/escalation-rules/rule_1');
  });

  it('encodes hostile escalation rule ids exactly once', () => {
    const hostileId = 'rule/1?x=y#frag';
    expect(buildEscalationRuleApiPath(hostileId)).toBe(
      '/api/admin/escalation-rules/rule%2F1%3Fx%3Dy%23frag',
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment escalation rule id %s', (ruleId) => {
    expect(() => buildEscalationRuleApiPath(ruleId)).toThrow(RangeError);
  });
});
