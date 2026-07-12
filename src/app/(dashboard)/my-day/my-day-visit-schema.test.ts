import { describe, expect, it } from 'vitest';
import { myDayVisitSchema } from './my-day-visit-schema';

const VISIT = {
  id: 'visit_1',
  visit_type: 'regular',
  schedule_status: 'planned',
  time_window_start: '2026-04-10T09:00:00.000Z',
  time_window_end: '2026-04-10T10:00:00.000Z',
  preparation: null,
  case_: {
    patient: {
      name: '患者A',
      residences: [{ address: 'provider-only' }],
    },
  },
  org_id: 'org_1',
};

describe('myDayVisitSchema', () => {
  it('projects only operationally required visit fields', () => {
    const parsed = myDayVisitSchema.parse(VISIT);

    expect(parsed).not.toHaveProperty('org_id');
    expect(parsed.case_.patient).toEqual({ name: '患者A' });
  });

  it.each([
    ['missing patient identity', { ...VISIT, case_: { patient: {} } }],
    ['invalid status', { ...VISIT, schedule_status: 'unknown' }],
    [
      'reversed time window',
      {
        ...VISIT,
        time_window_start: '2026-04-10T11:00:00.000Z',
        time_window_end: '2026-04-10T10:00:00.000Z',
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(myDayVisitSchema.safeParse(payload).success).toBe(false);
  });
});
