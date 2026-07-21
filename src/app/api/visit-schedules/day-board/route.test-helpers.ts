import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

export function createDayBoardRequest(date?: string) {
  const url = new URL('http://localhost/api/visit-schedules/day-board');
  if (date) url.searchParams.set('date', date);
  return new NextRequest(url, { headers: { 'x-org-id': 'org_1' } });
}

export function createDayBoardRequestWithSearch(search: string) {
  return new NextRequest(`http://localhost/api/visit-schedules/day-board${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function installDayBoardLoaderMocks(args: {
  loadSchedules: Mock;
  visitScheduleFindMany: Mock;
  loadProposals: Mock;
  proposalFindMany: Mock;
}) {
  args.loadSchedules.mockImplementation(
    async (
      _db: unknown,
      options: { orgId: string; dayStart: Date; dayEnd: Date; pageSize: number },
    ) =>
      args.visitScheduleFindMany({
        where: {
          org_id: options.orgId,
          scheduled_date: { gte: options.dayStart, lt: options.dayEnd },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }, { id: 'asc' }],
        take: options.pageSize,
        select: {
          id: true,
          display_id: true,
          case_id: true,
          cycle_id: true,
          carry_items_status: true,
          facility_batch_id: true,
        },
      }),
  );
  args.loadProposals.mockImplementation(
    async (_db: unknown, options: { where: Record<string, unknown>; limit: number }) =>
      args.proposalFindMany({
        where: options.where,
        orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }, { id: 'asc' }],
        take: options.limit,
        select: {
          id: true,
          display_id: true,
          case_id: true,
          visit_type: true,
          proposal_status: true,
          patient_contact_status: true,
          proposed_date: true,
          time_window_start: true,
          time_window_end: true,
          proposed_pharmacist_id: true,
        },
      }),
  );
}
