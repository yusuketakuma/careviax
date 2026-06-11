import { describe, expect, it, vi } from 'vitest';
import {
  OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES,
  allocateProposalRouteOrders,
  buildProposalRouteCellKey,
} from './route-order';

describe('visit schedule proposal route order allocation', () => {
  it('allocates after active schedules and open proposals per pharmacist/day cell', async () => {
    const scheduleFindMany = vi.fn().mockResolvedValue([
      {
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
        route_order: 2,
      },
    ]);
    const proposalFindMany = vi.fn().mockResolvedValue([
      {
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-03T00:00:00.000Z'),
        route_order: 4,
        reschedule_source_schedule_id: null,
      },
    ]);

    const allocated = await allocateProposalRouteOrders(
      {
        visitSchedule: { findMany: scheduleFindMany },
        visitScheduleProposal: { findMany: proposalFindMany },
      },
      {
        orgId: 'org_1',
        drafts: [
          {
            id: 'draft_1',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 1,
          },
          {
            id: 'draft_2',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 3,
          },
        ],
      },
    );

    expect(scheduleFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        route_order: { not: null },
        OR: [
          {
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
          },
        ],
      },
      select: {
        scheduled_date: true,
        pharmacist_id: true,
        route_order: true,
      },
    });
    expect(proposalFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(allocated).toEqual([
      expect.objectContaining({ id: 'draft_1', route_order: 5 }),
      expect.objectContaining({ id: 'draft_2', route_order: 6 }),
    ]);
  });

  it('ignores open proposals from excluded reschedule source schedules', async () => {
    const allocated = await allocateProposalRouteOrders(
      {
        visitSchedule: { findMany: vi.fn().mockResolvedValue([]) },
        visitScheduleProposal: {
          findMany: vi.fn().mockResolvedValue([
            {
              proposed_pharmacist_id: 'pharmacist_1',
              proposed_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: 9,
              reschedule_source_schedule_id: 'schedule_excluded',
            },
            {
              proposed_pharmacist_id: 'pharmacist_1',
              proposed_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: 3,
              reschedule_source_schedule_id: 'schedule_other',
            },
          ]),
        },
      },
      {
        orgId: 'org_1',
        excludeProposalSourceScheduleIds: ['schedule_excluded'],
        drafts: [
          {
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 1,
          },
        ],
      },
    );

    expect(allocated[0]?.route_order).toBe(4);
  });

  it('allocates independent route orders per pharmacist/day cell', async () => {
    const allocated = await allocateProposalRouteOrders(
      {
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              pharmacist_id: 'pharmacist_1',
              scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: 2,
            },
            {
              pharmacist_id: 'pharmacist_2',
              scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: 7,
            },
          ]),
        },
        visitScheduleProposal: { findMany: vi.fn().mockResolvedValue([]) },
      },
      {
        orgId: 'org_1',
        drafts: [
          {
            id: 'draft_1',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 1,
          },
          {
            id: 'draft_2',
            proposed_pharmacist_id: 'pharmacist_2',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 1,
          },
          {
            id: 'draft_3',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-04T00:00:00.000Z'),
            route_order: 1,
          },
        ],
      },
    );

    expect(allocated).toEqual([
      expect.objectContaining({ id: 'draft_1', route_order: 3 }),
      expect.objectContaining({ id: 'draft_2', route_order: 8 }),
      expect.objectContaining({ id: 'draft_3', route_order: 1 }),
    ]);
  });

  it('normalizes invalid route orders before they can poison allocation', async () => {
    const allocated = await allocateProposalRouteOrders(
      {
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              pharmacist_id: 'pharmacist_1',
              scheduled_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: Number.NaN,
            },
          ]),
        },
        visitScheduleProposal: {
          findMany: vi.fn().mockResolvedValue([
            {
              proposed_pharmacist_id: 'pharmacist_1',
              proposed_date: new Date('2026-04-03T00:00:00.000Z'),
              route_order: 2.5,
              reschedule_source_schedule_id: null,
            },
          ]),
        },
      },
      {
        orgId: 'org_1',
        drafts: [
          {
            id: 'draft_1',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: Number.NaN,
          },
          {
            id: 'draft_2',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: -4,
          },
          {
            id: 'draft_3',
            proposed_pharmacist_id: 'pharmacist_1',
            proposed_date: new Date('2026-04-03T00:00:00.000Z'),
            route_order: 5,
          },
        ],
      },
    );

    expect(allocated).toEqual([
      expect.objectContaining({ id: 'draft_1', route_order: 1 }),
      expect.objectContaining({ id: 'draft_2', route_order: 2 }),
      expect.objectContaining({ id: 'draft_3', route_order: 5 }),
    ]);
  });

  it('does not query when there are no drafts to allocate', async () => {
    const scheduleFindMany = vi.fn();
    const proposalFindMany = vi.fn();
    const drafts: Array<{
      proposed_pharmacist_id: string;
      proposed_date: Date;
      route_order: number;
    }> = [];

    const allocated = await allocateProposalRouteOrders(
      {
        visitSchedule: { findMany: scheduleFindMany },
        visitScheduleProposal: { findMany: proposalFindMany },
      },
      {
        orgId: 'org_1',
        drafts,
      },
    );

    expect(allocated).toBe(drafts);
    expect(scheduleFindMany).not.toHaveBeenCalled();
    expect(proposalFindMany).not.toHaveBeenCalled();
  });

  it('uses stable date keys for route cells', () => {
    expect(
      buildProposalRouteCellKey({
        pharmacistId: 'pharmacist_1',
        date: new Date(2026, 3, 3, 15, 0, 0),
      }),
    ).toBe('pharmacist_1:2026-04-03');
  });
});
