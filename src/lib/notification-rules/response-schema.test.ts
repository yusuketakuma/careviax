import { describe, expect, it } from 'vitest';
import { notificationRulesResponseSchema } from './response-schema';

const RULE = {
  id: 'rule_1',
  event_type: 'visit_schedule_created',
  channel: 'in_app',
  enabled: true,
  recipients: { roles: ['admin'] },
  created_at: '2026-07-16T00:00:00.000Z',
};

const META = {
  generated_at: '2026-07-16T00:01:00.000Z',
  total_count: 1,
  visible_count: 1,
  hidden_count: 0,
  truncated: false,
  count_basis: 'notification_rules',
  filters_applied: {},
  limit: 100,
};

describe('notificationRulesResponseSchema', () => {
  it('accepts canonical counted metadata and strips provider-only rule fields', () => {
    expect(
      notificationRulesResponseSchema.parse({
        data: [
          {
            ...RULE,
            org_id: 'org_1',
            conditions: { min_priority: 'urgent' },
            updated_at: '2026-07-16T00:02:00.000Z',
          },
        ],
        meta: META,
      }),
    ).toEqual({ data: [RULE], meta: META });
  });

  it.each([
    [
      'missing generated_at',
      {
        data: [RULE],
        meta: {
          total_count: 1,
          visible_count: 1,
          hidden_count: 0,
          truncated: false,
          count_basis: 'notification_rules',
          filters_applied: {},
          limit: 100,
        },
      },
    ],
    ['invalid generated_at', { data: [RULE], meta: { ...META, generated_at: 'invalid' } }],
  ])('rejects %s', (_label, payload) => {
    expect(notificationRulesResponseSchema.safeParse(payload).success).toBe(false);
  });
});
