import { describe, expect, it } from 'vitest';
import { enrichSchedulesWithHints } from './schedule-enrichment';

type ScheduleFixture = Parameters<typeof enrichSchedulesWithHints>[0][number] & { id: string };

describe('enrichSchedulesWithHints', () => {
  it('adds facility, workload, and handoff hints to related schedules', () => {
    const schedules: ScheduleFixture[] = [
      {
        id: 'schedule_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        priority: 'urgent',
        assignment_mode: 'fallback',
        site: { id: 'site_1' },
        facility_batch: { id: 'batch_1' },
        override_request: { status: 'pending' },
        applied_override: null,
        preparation: { prepared_at: null },
        case_: {
          patient: {
            name: '患者A',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
      {
        id: 'schedule_2',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        priority: 'normal',
        assignment_mode: 'primary',
        site: { id: 'site_1' },
        facility_batch: null,
        override_request: null,
        applied_override: null,
        preparation: { prepared_at: new Date('2026-03-30T09:00:00.000Z') },
        case_: {
          patient: {
            name: '患者B',
            residences: [{ building_id: 'facility_alpha', address: '施設A' }],
          },
        },
      },
    ];
    const enriched = enrichSchedulesWithHints(schedules);

    expect(enriched[0]).toMatchObject({
      facility_batch_id: 'batch_1',
      facility_hint: {
        label: 'facility_alpha',
        patient_count: 2,
      },
      workload_hint: {
        daily_visit_count: 2,
        urgent_visit_count: 1,
      },
      handoff_hint: {
        summary: expect.stringContaining('代替担当'),
      },
    });
  });
});
