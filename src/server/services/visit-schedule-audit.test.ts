import { describe, expect, it } from 'vitest';
import { buildVisitScheduleSnapshot } from './visit-schedule-audit';

describe('buildVisitScheduleSnapshot', () => {
  it('stores visit time windows as wall-clock labels, not ISO sentinels', () => {
    const snapshot = buildVisitScheduleSnapshot({
      id: 'schedule_1',
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      schedule_status: 'planned',
      scheduled_date: new Date('2026-06-18T00:00:00.000Z'),
      time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0)),
      time_window_end: new Date(Date.UTC(1970, 0, 1, 10, 30)),
      pharmacist_id: 'user_1',
      assignment_mode: 'primary',
      route_order: 1,
      vehicle_resource_id: null,
      confirmed_at: null,
      confirmed_by: null,
    }) as Record<string, unknown>;

    expect(snapshot.time_window_start).toBe('09:00');
    expect(snapshot.time_window_end).toBe('10:30');
    expect(JSON.stringify(snapshot)).not.toContain('1970-01-01T09:00:00.000Z');
  });
});
