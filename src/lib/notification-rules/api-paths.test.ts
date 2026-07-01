import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_RULES_API_PATH,
  buildNotificationRuleApiPath,
  buildNotificationRulesApiPath,
} from './api-paths';

describe('notification rule API path helpers', () => {
  it('builds notification rule collection paths', () => {
    expect(NOTIFICATION_RULES_API_PATH).toBe('/api/notification-rules');
    expect(buildNotificationRulesApiPath()).toBe('/api/notification-rules');
  });

  it('builds notification rule collection paths with encoded query params', () => {
    const params = new URLSearchParams({
      limit: '50',
      cursor: 'rule/1?x=y#frag',
    });

    expect(buildNotificationRulesApiPath(params)).toBe(
      '/api/notification-rules?limit=50&cursor=rule%2F1%3Fx%3Dy%23frag',
    );
  });

  it('builds notification rule detail paths for normal ids', () => {
    expect(buildNotificationRuleApiPath('rule_1')).toBe('/api/notification-rules/rule_1');
  });

  it('encodes hostile notification rule ids exactly once', () => {
    const hostileId = 'rule/1?x=y#frag';
    expect(buildNotificationRuleApiPath(hostileId)).toBe(
      '/api/notification-rules/rule%2F1%3Fx%3Dy%23frag',
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment notification rule id %s', (ruleId) => {
    expect(() => buildNotificationRuleApiPath(ruleId)).toThrow(RangeError);
  });
});
