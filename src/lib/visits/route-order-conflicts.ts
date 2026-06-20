import type { Prisma, ScheduleStatus } from '@prisma/client';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';

const ACTIVE_SCHEDULE_STATUS_EXCLUSIONS = ['cancelled', 'rescheduled'] satisfies ScheduleStatus[];

export type VisitRouteOrderCell = {
  pharmacistId: string;
  dateKey: string;
  routeOrder: number;
};

export type VisitRouteOrderConflict = {
  kind: 'schedule' | 'proposal';
  id: string;
};

type VisitRouteOrderConflictReader = {
  visitSchedule: {
    findFirst(args: Prisma.VisitScheduleFindFirstArgs): Promise<{ id: string } | null>;
  };
  visitScheduleProposal: {
    findFirst(args: Prisma.VisitScheduleProposalFindFirstArgs): Promise<{ id: string } | null>;
  };
};

function routeOrderCellKey(cell: VisitRouteOrderCell) {
  return `${cell.pharmacistId}:${cell.dateKey}:${cell.routeOrder}`;
}

export function hasDuplicateVisitRouteOrderCells(cells: readonly VisitRouteOrderCell[]) {
  const seen = new Set<string>();
  return cells.some((cell) => {
    const key = routeOrderCellKey(cell);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function visitScheduleCellWhere(cell: VisitRouteOrderCell): Prisma.VisitScheduleWhereInput {
  return {
    pharmacist_id: cell.pharmacistId,
    scheduled_date: new Date(cell.dateKey),
    route_order: cell.routeOrder,
  };
}

function visitScheduleProposalCellWhere(
  cell: VisitRouteOrderCell,
): Prisma.VisitScheduleProposalWhereInput {
  return {
    proposed_pharmacist_id: cell.pharmacistId,
    proposed_date: new Date(cell.dateKey),
    route_order: cell.routeOrder,
  };
}

function buildScheduleRouteOrderWhere(
  cells: readonly VisitRouteOrderCell[],
): Prisma.VisitScheduleWhereInput {
  if (cells.length === 1) return visitScheduleCellWhere(cells[0]);
  return { OR: cells.map(visitScheduleCellWhere) };
}

function buildProposalRouteOrderWhere(
  cells: readonly VisitRouteOrderCell[],
): Prisma.VisitScheduleProposalWhereInput {
  if (cells.length === 1) return visitScheduleProposalCellWhere(cells[0]);
  return { OR: cells.map(visitScheduleProposalCellWhere) };
}

function excludedIdFilter(ids: readonly string[] | undefined) {
  if (!ids || ids.length === 0) return null;
  if (ids.length === 1) return { not: ids[0] };
  return { notIn: [...ids] };
}

export async function findVisitRouteOrderConflict(
  reader: VisitRouteOrderConflictReader,
  args: {
    orgId: string;
    cells: readonly VisitRouteOrderCell[];
    excludeScheduleIds?: readonly string[];
    excludeProposalIds?: readonly string[];
    scheduleStatusScope?: 'active' | 'any';
  },
): Promise<VisitRouteOrderConflict | null> {
  if (args.cells.length === 0) return null;

  const excludedScheduleIds = excludedIdFilter(args.excludeScheduleIds);
  const excludedProposalIds = excludedIdFilter(args.excludeProposalIds);
  const [scheduleConflict, proposalConflict] = await Promise.all([
    reader.visitSchedule.findFirst({
      where: {
        org_id: args.orgId,
        ...(excludedScheduleIds ? { id: excludedScheduleIds } : {}),
        ...(args.scheduleStatusScope === 'any'
          ? {}
          : { schedule_status: { notIn: ACTIVE_SCHEDULE_STATUS_EXCLUSIONS } }),
        ...buildScheduleRouteOrderWhere(args.cells),
      },
      select: { id: true },
    }),
    reader.visitScheduleProposal.findFirst({
      where: {
        org_id: args.orgId,
        ...(excludedProposalIds ? { id: excludedProposalIds } : {}),
        finalized_schedule_id: null,
        proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
        ...buildProposalRouteOrderWhere(args.cells),
      },
      select: { id: true },
    }),
  ]);

  if (scheduleConflict) return { kind: 'schedule', id: scheduleConflict.id };
  if (proposalConflict) return { kind: 'proposal', id: proposalConflict.id };
  return null;
}
