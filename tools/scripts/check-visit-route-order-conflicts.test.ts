import { describe, expect, it, vi } from 'vitest';
import {
  VISIT_ROUTE_ORDER_CONFLICT_SQL,
  checkVisitRouteOrderConflicts,
} from './check-visit-route-order-conflicts';

describe('checkVisitRouteOrderConflicts', () => {
  it('checks active schedules and open proposals in the same route cells', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(checkVisitRouteOrderConflicts({ query })).resolves.toEqual({
      ok: true,
      conflict_groups: 0,
      checked: [
        'active-visit-schedule-route-order',
        'open-visit-schedule-proposal-route-order',
        'cross-table-visit-route-order',
      ],
      conflicts: [],
    });

    expect(query).toHaveBeenCalledWith(VISIT_ROUTE_ORDER_CONFLICT_SQL);
    expect(VISIT_ROUTE_ORDER_CONFLICT_SQL).toContain(
      "schedule_status NOT IN ('cancelled', 'rescheduled')",
    );
    expect(VISIT_ROUTE_ORDER_CONFLICT_SQL).toContain('finalized_schedule_id IS NULL');
    expect(VISIT_ROUTE_ORDER_CONFLICT_SQL).toContain(
      "proposal_status IN ('proposed', 'patient_contact_pending', 'reschedule_pending')",
    );
    expect(VISIT_ROUTE_ORDER_CONFLICT_SQL).toContain('UNION ALL');
    expect(VISIT_ROUTE_ORDER_CONFLICT_SQL).toContain('HAVING COUNT(*) > 1');
  });

  it('returns conflict groups with schedule and proposal identifiers', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          org_id: 'org_1',
          pharmacist_id: 'pharmacist_1',
          route_date: '2026-04-03',
          route_order: '4',
          conflict_count: '3',
          schedule_ids: ['schedule_1'],
          proposal_ids: ['proposal_1', 'proposal_2'],
        },
      ],
    });

    await expect(checkVisitRouteOrderConflicts({ query })).resolves.toEqual({
      ok: false,
      conflict_groups: 1,
      checked: [
        'active-visit-schedule-route-order',
        'open-visit-schedule-proposal-route-order',
        'cross-table-visit-route-order',
      ],
      conflicts: [
        {
          org_id: 'org_1',
          pharmacist_id: 'pharmacist_1',
          route_date: '2026-04-03',
          route_order: 4,
          conflict_count: 3,
          schedule_ids: ['schedule_1'],
          proposal_ids: ['proposal_1', 'proposal_2'],
        },
      ],
    });
  });
});
