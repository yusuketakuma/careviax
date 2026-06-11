import type { VisitProposalStatus } from '@prisma/client';
import { formatDateKey } from '@/lib/date-key';

export const OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES: VisitProposalStatus[] = [
  'proposed',
  'patient_contact_pending',
  'reschedule_pending',
];

export type ProposalRouteOrderDraft = {
  proposed_pharmacist_id: string;
  proposed_date: Date;
  route_order: number;
};

type RouteOrderScheduleRecord = {
  scheduled_date: Date;
  pharmacist_id: string;
  route_order: number | null;
};

type RouteOrderProposalRecord = {
  proposed_date: Date;
  proposed_pharmacist_id: string;
  route_order: number | null;
  reschedule_source_schedule_id: string | null;
};

type ProposalRouteOrderTx = {
  visitSchedule: {
    findMany(args: unknown): Promise<RouteOrderScheduleRecord[]>;
  };
  visitScheduleProposal: {
    findMany(args: unknown): Promise<RouteOrderProposalRecord[]>;
  };
};

export function buildProposalRouteCellKey(args: { pharmacistId: string; date: Date }) {
  return `${args.pharmacistId}:${formatDateKey(args.date)}`;
}

function toPositiveRouteOrder(value: number | null | undefined) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function nextRouteOrderAfter(args: { currentMax: number; preferredOrder: number }) {
  const fallbackOrder = args.currentMax + 1;
  const preferredOrder = toPositiveRouteOrder(args.preferredOrder);
  return Math.max(fallbackOrder, preferredOrder);
}

export async function allocateProposalRouteOrders<TDraft extends ProposalRouteOrderDraft>(
  tx: ProposalRouteOrderTx,
  args: {
    orgId: string;
    drafts: TDraft[];
    excludeProposalSourceScheduleIds?: string[];
  },
) {
  if (args.drafts.length === 0) return args.drafts;

  const routeCells = Array.from(
    new Map(
      args.drafts.map((draft) => [
        buildProposalRouteCellKey({
          pharmacistId: draft.proposed_pharmacist_id,
          date: draft.proposed_date,
        }),
        {
          pharmacistId: draft.proposed_pharmacist_id,
          date: draft.proposed_date,
        },
      ]),
    ).values(),
  );

  const activeSchedules = await tx.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      route_order: { not: null },
      OR: routeCells.map((cell) => ({
        pharmacist_id: cell.pharmacistId,
        scheduled_date: cell.date,
      })),
    },
    select: {
      scheduled_date: true,
      pharmacist_id: true,
      route_order: true,
    },
  });
  const openProposals = await tx.visitScheduleProposal.findMany({
    where: {
      org_id: args.orgId,
      finalized_schedule_id: null,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      route_order: { not: null },
      OR: routeCells.map((cell) => ({
        proposed_pharmacist_id: cell.pharmacistId,
        proposed_date: cell.date,
      })),
    },
    select: {
      proposed_date: true,
      proposed_pharmacist_id: true,
      route_order: true,
      reschedule_source_schedule_id: true,
    },
  });

  const excludedSourceIds = new Set(args.excludeProposalSourceScheduleIds ?? []);
  const maxRouteOrderByCell = new Map<string, number>();
  for (const schedule of activeSchedules) {
    const key = buildProposalRouteCellKey({
      pharmacistId: schedule.pharmacist_id,
      date: schedule.scheduled_date,
    });
    maxRouteOrderByCell.set(
      key,
      Math.max(maxRouteOrderByCell.get(key) ?? 0, toPositiveRouteOrder(schedule.route_order)),
    );
  }
  for (const proposal of openProposals) {
    if (
      proposal.reschedule_source_schedule_id &&
      excludedSourceIds.has(proposal.reschedule_source_schedule_id)
    ) {
      continue;
    }

    const key = buildProposalRouteCellKey({
      pharmacistId: proposal.proposed_pharmacist_id,
      date: proposal.proposed_date,
    });
    maxRouteOrderByCell.set(
      key,
      Math.max(maxRouteOrderByCell.get(key) ?? 0, toPositiveRouteOrder(proposal.route_order)),
    );
  }

  return args.drafts.map((draft) => {
    const key = buildProposalRouteCellKey({
      pharmacistId: draft.proposed_pharmacist_id,
      date: draft.proposed_date,
    });
    const nextRouteOrder = nextRouteOrderAfter({
      currentMax: maxRouteOrderByCell.get(key) ?? 0,
      preferredOrder: draft.route_order,
    });
    maxRouteOrderByCell.set(key, nextRouteOrder);
    return {
      ...draft,
      route_order: nextRouteOrder,
    };
  });
}
