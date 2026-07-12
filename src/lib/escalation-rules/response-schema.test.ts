import { describe, expect, it } from 'vitest';
import { escalationRuleResponseSchema } from './response-schema';

const RULE = {
  id: 'rule_1',
  trigger_type: 'communication_response_overdue',
  condition: { threshold_hours: 24, severity: 'high' },
  action: 'in_app_notification',
  notify_role: 'admin',
  is_active: true,
  created_at: '2026-06-19T10:00:00.000Z',
};

describe('escalationRuleResponseSchema', () => {
  it('projects a mutation response to the client escalation-rule contract', () => {
    expect(
      escalationRuleResponseSchema.parse({
        data: {
          ...RULE,
          org_id: 'org_1',
          display_id: 'erul_1',
          updated_at: '2026-06-19T11:00:00.000Z',
        },
      }),
    ).toEqual({ data: RULE });
  });

  it.each([
    ['legacy root', { message: 'エスカレーションルールを保存しました' }],
    ['malformed condition', { data: { ...RULE, condition: { threshold_hours: 0 } } }],
    [
      'missing rule field',
      {
        data: {
          id: RULE.id,
          trigger_type: RULE.trigger_type,
          condition: RULE.condition,
          action: RULE.action,
          is_active: RULE.is_active,
          created_at: RULE.created_at,
        },
      },
    ],
    ['unexpected envelope field', { data: RULE, meta: {} }],
  ])('rejects %s mutation responses', (_label, payload) => {
    expect(escalationRuleResponseSchema.safeParse(payload).success).toBe(false);
  });
});
