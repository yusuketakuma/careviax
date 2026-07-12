import { describe, expect, it } from 'vitest';
import { performanceScheduleSchema } from './performance-schedule-schema';

const SCHEDULE = {
  id: 'schedule_1',
  scheduled_date: '2026-07-13T00:00:00.000Z',
  priority: 'emergency',
  assignment_mode: 'fallback',
  confirmed_at: null,
  case_: { patient: { name: '患者A', residences: [{ address: 'provider-only' }] } },
  override_request: { status: 'pending', reason: '時間変更', impact_summary: {} },
  org_id: 'org_1',
};

describe('performanceScheduleSchema', () => {
  it('projects only fields used by performance metrics', () => {
    const parsed = performanceScheduleSchema.parse(SCHEDULE);

    expect(parsed).not.toHaveProperty('org_id');
    expect(parsed.case_.patient).toEqual({ name: '患者A' });
    expect(parsed.override_request).toEqual({ status: 'pending', reason: '時間変更' });
  });

  it.each([
    ['missing patient name', { ...SCHEDULE, case_: { patient: {} } }],
    ['invalid priority', { ...SCHEDULE, priority: 'critical' }],
    [
      'invalid override state',
      { ...SCHEDULE, override_request: { status: 'open', reason: '時間変更' } },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(performanceScheduleSchema.safeParse(payload).success).toBe(false);
  });
});
