import { describe, expect, it } from 'vitest';
import {
  buildUpdatedOperationalPolicyResponseSchema,
  operationalPolicyResponseSchema,
} from './operational-policy-response-schema';

function response() {
  return {
    data: {
      generated_at: '2026-07-13T00:00:00.000Z',
      pharmacy_label: 'ひまわり薬局',
      can_edit: true,
      policy: {
        safety_sign_sensitivity: 'standard',
        slack_auto_calc: true,
        interrupt_guard: true,
        wait_release_notification: true,
        quiet_hours: true,
      },
      locked_items: [
        { key: 'safety_tag_display', label: '安全タグ', reason: '常時表示' },
        { key: 'two_person_audit', label: '二人制監査', reason: '無効化不可' },
        { key: 'emergency_notification', label: '緊急通知', reason: '常時ON' },
      ],
      wip_revision_label: '4/1改定',
      change_log_count_this_month: 3,
    },
  };
}

describe('operational policy response schemas', () => {
  it('accepts a complete policy response', () => {
    expect(operationalPolicyResponseSchema.safeParse(response()).success).toBe(true);
  });

  it('rejects duplicate locked item identities', () => {
    const value = structuredClone(response());
    value.data.locked_items[2] = { ...value.data.locked_items[0] };
    expect(operationalPolicyResponseSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a requested update with one additional audit entry', () => {
    const value = structuredClone(response());
    value.data.policy.quiet_hours = false;
    value.data.change_log_count_this_month = 4;
    expect(
      buildUpdatedOperationalPolicyResponseSchema({
        values: { quiet_hours: false },
        previousChangeLogCount: 3,
      }).safeParse(value).success,
    ).toBe(true);
  });

  it('rejects an update result that does not apply the requested value', () => {
    const value = structuredClone(response());
    value.data.change_log_count_this_month = 4;
    expect(
      buildUpdatedOperationalPolicyResponseSchema({
        values: { quiet_hours: false },
        previousChangeLogCount: 3,
      }).safeParse(value).success,
    ).toBe(false);
  });

  it('rejects an update result without the expected audit count increment', () => {
    const value = structuredClone(response());
    value.data.policy.quiet_hours = false;
    expect(
      buildUpdatedOperationalPolicyResponseSchema({
        values: { quiet_hours: false },
        previousChangeLogCount: 3,
      }).safeParse(value).success,
    ).toBe(false);
  });
});
