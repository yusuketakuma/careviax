import { describe, expect, it, vi } from 'vitest';
import {
  fetchCalendarSchedules,
  formatCalendarTimeRange,
  groupCalendarSchedulesByDate,
  sortCalendarSchedules,
  type CalendarVisitSchedule,
} from './calendar-view.helpers';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('calendar-view.helpers', () => {
  it('sorts schedules by route order, time, and patient name', () => {
    const schedules: CalendarVisitSchedule[] = [
      {
        id: 'schedule_3',
        scheduled_date: '2026-03-31',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_3',
        cycle_id: null,
        route_order: null,
        time_window_start: '1970-01-01T10:00:00.000Z',
        case_: { patient: { id: 'patient_3', name: '佐藤' } },
      },
      {
        id: 'schedule_2',
        scheduled_date: '2026-03-31',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_2',
        cycle_id: null,
        route_order: 2,
        time_window_start: '1970-01-01T09:30:00.000Z',
        case_: { patient: { id: 'patient_2', name: '高橋' } },
      },
      {
        id: 'schedule_1',
        scheduled_date: '2026-03-31',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_1',
        cycle_id: null,
        route_order: 1,
        time_window_start: '1970-01-01T09:00:00.000Z',
        case_: { patient: { id: 'patient_1', name: '田中' } },
      },
    ];

    expect(sortCalendarSchedules(schedules).map((schedule) => schedule.id)).toEqual([
      'schedule_1',
      'schedule_2',
      'schedule_3',
    ]);
  });

  it('formats calendar time windows', () => {
    expect(
      formatCalendarTimeRange({
        time_window_start: '1970-01-01T09:00:00.000Z',
        time_window_end: '1970-01-01T10:30:00.000Z',
      }),
    ).toBe('09:00 - 10:30');
  });

  it('groups schedules by date and sorts each day bucket', () => {
    const grouped = groupCalendarSchedulesByDate([
      {
        id: 'schedule_2',
        scheduled_date: '2026-03-31T10:00:00.000Z',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_2',
        cycle_id: null,
        route_order: 2,
        time_window_start: '1970-01-01T10:00:00.000Z',
        case_: { patient: { id: 'patient_2', name: '高橋' } },
      },
      {
        id: 'schedule_1',
        scheduled_date: '2026-03-31T09:00:00.000Z',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_1',
        cycle_id: null,
        route_order: 1,
        time_window_start: '1970-01-01T09:00:00.000Z',
        case_: { patient: { id: 'patient_1', name: '田中' } },
      },
      {
        id: 'schedule_3',
        scheduled_date: '2026-04-01T09:00:00.000Z',
        schedule_status: 'planned',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        case_id: 'case_3',
        cycle_id: null,
        route_order: null,
        time_window_start: '1970-01-01T11:00:00.000Z',
        case_: { patient: { id: 'patient_3', name: '佐藤' } },
      },
    ]);

    expect(grouped.get('2026-03-31')?.map((schedule) => schedule.id)).toEqual([
      'schedule_1',
      'schedule_2',
    ]);
    expect(grouped.get('2026-04-01')?.map((schedule) => schedule.id)).toEqual([
      'schedule_3',
    ]);
  });

  it('follows pagination until all schedules are collected', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'schedule_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'schedule_2' }],
          hasMore: false,
        }),
      );

    const schedules = await fetchCalendarSchedules({
      orgId: 'org_1',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      fetchImpl,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(schedules).toHaveLength(2);
  });
});
