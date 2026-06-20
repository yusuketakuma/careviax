import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findVisitRouteOrderConflict,
  hasDuplicateVisitRouteOrderCells,
} from './route-order-conflicts';

const visitScheduleFindFirst = vi.fn();
const visitScheduleProposalFindFirst = vi.fn();

const reader = {
  visitSchedule: {
    findFirst: visitScheduleFindFirst,
  },
  visitScheduleProposal: {
    findFirst: visitScheduleProposalFindFirst,
  },
};

describe('visit route order conflicts', () => {
  beforeEach(() => {
    visitScheduleFindFirst.mockReset();
    visitScheduleProposalFindFirst.mockReset();
  });

  it('detects duplicate route-order cells by pharmacist, date, and order', () => {
    expect(
      hasDuplicateVisitRouteOrderCells([
        { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 },
        { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 },
      ]),
    ).toBe(true);
    expect(
      hasDuplicateVisitRouteOrderCells([
        { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 },
        { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 2 },
        { pharmacistId: 'pharmacist_2', dateKey: '2026-06-20', routeOrder: 1 },
      ]),
    ).toBe(false);
  });

  it('skips database reads when no route cells are supplied', async () => {
    await expect(
      findVisitRouteOrderConflict(reader, {
        orgId: 'org_1',
        cells: [],
      }),
    ).resolves.toBeNull();
    expect(visitScheduleFindFirst).not.toHaveBeenCalled();
    expect(visitScheduleProposalFindFirst).not.toHaveBeenCalled();
  });

  it('queries active schedule and open proposal conflicts for route cells', async () => {
    visitScheduleFindFirst.mockResolvedValueOnce(null);
    visitScheduleProposalFindFirst.mockResolvedValueOnce({ id: 'proposal_1' });

    await expect(
      findVisitRouteOrderConflict(reader, {
        orgId: 'org_1',
        cells: [
          { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 2 },
          { pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 3 },
        ],
        excludeScheduleIds: ['schedule_1'],
        excludeProposalIds: ['proposal_2'],
      }),
    ).resolves.toEqual({ kind: 'proposal', id: 'proposal_1' });

    expect(visitScheduleFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'schedule_1' },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        OR: [
          {
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-06-20'),
            route_order: 2,
          },
          {
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-06-20'),
            route_order: 3,
          },
        ],
      },
      select: { id: true },
    });
    expect(visitScheduleProposalFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { not: 'proposal_2' },
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        OR: [
          {
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-06-20'),
            route_order: 2,
          },
          {
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-06-20'),
            route_order: 3,
          },
        ],
      },
      select: { id: true },
    });
  });

  it('preserves callers that intentionally check any schedule status', async () => {
    visitScheduleFindFirst.mockResolvedValueOnce({ id: 'schedule_1' });
    visitScheduleProposalFindFirst.mockResolvedValueOnce(null);

    await expect(
      findVisitRouteOrderConflict(reader, {
        orgId: 'org_1',
        cells: [{ pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 }],
        scheduleStatusScope: 'any',
      }),
    ).resolves.toEqual({ kind: 'schedule', id: 'schedule_1' });

    expect(visitScheduleFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-06-20'),
        route_order: 1,
      },
      select: { id: true },
    });
  });

  it('uses multi-id exclusion filters for schedules and proposals', async () => {
    visitScheduleFindFirst.mockResolvedValueOnce(null);
    visitScheduleProposalFindFirst.mockResolvedValueOnce(null);

    await expect(
      findVisitRouteOrderConflict(reader, {
        orgId: 'org_1',
        cells: [{ pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 }],
        excludeScheduleIds: ['schedule_1', 'schedule_2'],
        excludeProposalIds: ['proposal_1', 'proposal_2'],
      }),
    ).resolves.toBeNull();

    expect(visitScheduleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ['schedule_1', 'schedule_2'] },
        }),
      }),
    );
    expect(visitScheduleProposalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ['proposal_1', 'proposal_2'] },
        }),
      }),
    );
  });

  it('prefers committed schedule conflicts when a proposal also matches', async () => {
    visitScheduleFindFirst.mockResolvedValueOnce({ id: 'schedule_1' });
    visitScheduleProposalFindFirst.mockResolvedValueOnce({ id: 'proposal_1' });

    await expect(
      findVisitRouteOrderConflict(reader, {
        orgId: 'org_1',
        cells: [{ pharmacistId: 'pharmacist_1', dateKey: '2026-06-20', routeOrder: 1 }],
      }),
    ).resolves.toEqual({ kind: 'schedule', id: 'schedule_1' });
  });
});
