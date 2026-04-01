import { describe, expect, it } from 'vitest';
import {
  deriveStatusFromPatient,
  selectNextVisit,
} from './patient-detail-helpers';

describe('patient-detail-helpers', () => {
  it('prioritizes on-hold cases when deriving patient status', () => {
    expect(
      deriveStatusFromPatient(
        {
          risk_summary: {
            score: 9,
            level: 'high',
            pending_reports: 2,
            open_tasks: 1,
            unresolved_self_reports: 1,
          },
          cases: [{ status: 'on_hold' }],
          visit_schedules: [],
        },
        new Date('2026-03-31T00:00:00Z')
      )
    ).toBe('paused');
  });

  it('marks patients as first_visit_soon when they only have an upcoming visit', () => {
    expect(
      deriveStatusFromPatient(
        {
          risk_summary: null,
          cases: [{ status: 'assessment' }],
          visit_schedules: [
            {
              scheduled_date: '2026-04-02T09:00:00.000Z',
              schedule_status: 'planned',
              visit_record: null,
            },
          ],
        },
        new Date('2026-03-31T00:00:00Z')
      )
    ).toBe('first_visit_soon');
  });

  it('selects the earliest schedule without a visit record as the next visit', () => {
    const nextVisit = selectNextVisit([
      {
        scheduled_date: '2026-04-03T09:00:00.000Z',
        schedule_status: 'planned',
        visit_record: null,
      },
      {
        scheduled_date: '2026-04-01T09:00:00.000Z',
        schedule_status: 'completed',
        visit_record: { id: 'record_1', outcome_status: 'completed' },
      },
      {
        scheduled_date: '2026-04-02T09:00:00.000Z',
        schedule_status: 'ready',
        visit_record: null,
      },
    ]);

    expect(nextVisit?.scheduled_date).toBe('2026-04-02T09:00:00.000Z');
  });

  it('falls back to the earliest schedule when every visit already has a record', () => {
    const nextVisit = selectNextVisit([
      {
        scheduled_date: '2026-04-03T09:00:00.000Z',
        schedule_status: 'completed',
        visit_record: { id: 'record_2', outcome_status: 'completed' },
      },
      {
        scheduled_date: '2026-04-01T09:00:00.000Z',
        schedule_status: 'completed',
        visit_record: { id: 'record_1', outcome_status: 'completed' },
      },
    ]);

    expect(nextVisit?.scheduled_date).toBe('2026-04-01T09:00:00.000Z');
  });
});
