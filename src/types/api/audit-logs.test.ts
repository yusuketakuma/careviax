import { describe, expect, it } from 'vitest';
import { auditLogReviewResponseSchemaFor } from './audit-logs';

describe('auditLogReviewResponseSchemaFor', () => {
  it('projects a matching review mutation response to the client contract', () => {
    expect(
      auditLogReviewResponseSchemaFor('log_1').parse({
        data: {
          audit_log_id: 'log_1',
          review_state: 'reviewed',
          reviewed_at: '2026-07-12T10:00:00.000Z',
          reviewed_by: 'admin_1',
          reason_code: 'expected_access',
        },
      }),
    ).toEqual({
      data: {
        audit_log_id: 'log_1',
        review_state: 'reviewed',
      },
    });
  });

  it.each([
    ['legacy root', { audit_log_id: 'log_1', review_state: 'reviewed' }],
    ['wrong identity', { data: { audit_log_id: 'log_2', review_state: 'reviewed' } }],
    ['invalid state', { data: { audit_log_id: 'log_1', review_state: 'complete' } }],
    ['missing identity', { data: { review_state: 'reviewed' } }],
    [
      'unexpected envelope field',
      { data: { audit_log_id: 'log_1', review_state: 'reviewed' }, message: 'ok' },
    ],
  ])('rejects %s review mutation responses', (_label, payload) => {
    expect(auditLogReviewResponseSchemaFor('log_1').safeParse(payload).success).toBe(false);
  });
});
