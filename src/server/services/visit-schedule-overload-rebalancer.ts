import type { VisitPriority, VisitType } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { ACTIVE_BILLING_SCHEDULE_STATUSES } from './billing-cadence';
import { generateVisitScheduleProposalDrafts } from './visit-schedule-planner';

type OverloadProposalRow = {
  id: string;
  case_id: string;
  site_id: string | null;
  visit_type: VisitType;
  priority: VisitPriority;
  proposal_status: string;
  patient_contact_status: string;
  finalized_schedule_id: string | null;
  proposed_date: Date;
  proposed_pharmacist_id: string;
  route_order: number | null;
  vehicle_resource_id: string | null;
  reschedule_source_schedule_id: string | null;
};

type OverloadScheduleRow = {
  id: string;
  scheduled_date: Date;
  pharmacist_id: string;
  vehicle_resource_id: string | null;
};

type OverloadUserRow = {
  id: string;
  max_daily_visits: number | null;
};

type OverloadVehicleResourceRow = {
  id: string;
  max_stops: number | null;
};

export type OverloadRebalancerDb = {
  visitScheduleProposal: {
    findMany(args: unknown): Promise<OverloadProposalRow[]>;
  };
  visitSchedule: {
    findMany(args: unknown): Promise<OverloadScheduleRow[]>;
  };
  user: {
    findMany(args: unknown): Promise<OverloadUserRow[]>;
  };
  visitVehicleResource: {
    findMany(args: unknown): Promise<OverloadVehicleResourceRow[]>;
  };
};

export type OverloadRebalancePreviewDraft = Pick<
  ProposalDraft,
  | 'case_id'
  | 'site_id'
  | 'visit_type'
  | 'priority'
  | 'proposed_date'
  | 'time_window_start'
  | 'time_window_end'
  | 'proposed_pharmacist_id'
  | 'route_order'
  | 'vehicle_resource_id'
  | 'visit_deadline_date'
>;

export type OverloadRebalancePreview = {
  source_proposal_id: string;
  reason_code: 'overload_advance';
  from: {
    proposed_date: string;
    proposed_pharmacist_id: string;
    route_order: number | null;
    occupancy_count: number;
    max_daily_visits: number;
  };
  replacement: OverloadRebalancePreviewDraft;
  diagnostics: {
    destination_date: string;
    destination_occupancy_count: number;
    destination_max_daily_visits: number | null;
  };
};

export type OverloadRebalanceSkipReason =
  | 'not_mutable'
  | 'no_earlier_candidate'
  | 'destination_capacity_full'
  | 'vehicle_capacity_full';

export type OverloadRebalanceSkippedProposal = {
  source_proposal_id: string;
  reason_code: OverloadRebalanceSkipReason;
};

export type OverloadRebalanceOverloadedCell = {
  proposed_pharmacist_id: string;
  proposed_date: string;
  occupancy_count: number;
  max_daily_visits: number;
  eligible_proposal_count: number;
};

export type PreviewVisitScheduleOverloadRebalanceResult = {
  overloaded_cells: OverloadRebalanceOverloadedCell[];
  previews: OverloadRebalancePreview[];
  skipped: OverloadRebalanceSkippedProposal[];
};

const OVERLOAD_REBALANCE_UNSUPPORTED_GUARDS = [
  'pharmacist_review_required',
  'billing_cap_recheck',
] as const;

const OVERLOAD_REBALANCE_SKIP_REASONS: OverloadRebalanceSkipReason[] = [
  'not_mutable',
  'no_earlier_candidate',
  'destination_capacity_full',
  'vehicle_capacity_full',
];

export type OverloadRebalanceUnsupportedGuard =
  (typeof OVERLOAD_REBALANCE_UNSUPPORTED_GUARDS)[number];

export type VisitScheduleOverloadRebalanceApiPreview = {
  preview_only: true;
  apply_available: false;
  unsupported_guards: OverloadRebalanceUnsupportedGuard[];
  overloaded_cells: Array<{
    date: string;
    pharmacist_id: string;
    occupancy_count: number;
    capacity_limit: number;
    over_by: number;
    eligible_proposal_count: number;
  }>;
  recommendations: Array<{
    source_proposal_id: string;
    reason_code: 'overload_advance';
    from: {
      date: string;
      pharmacist_id: string;
      route_order: number | null;
      occupancy_count: number;
      capacity_limit: number;
    };
    replacement: {
      date: string;
      time_window_start: string | null;
      time_window_end: string | null;
      pharmacist_id: string;
      route_order: number;
      site_id: string | null;
      vehicle_resource_id: string | null;
      visit_deadline_date: string | null;
      visit_type: VisitType;
      priority: VisitPriority;
    };
  }>;
  skipped_summary: Array<{
    reason_code: OverloadRebalanceSkipReason;
    count: number;
  }>;
};

type DraftGenerator = typeof generateVisitScheduleProposalDrafts;
type ProposalDraft = Awaited<ReturnType<DraftGenerator>>['drafts'][number];

export type PreviewVisitScheduleOverloadRebalanceArgs = {
  orgId: string;
  dateFrom: Date;
  dateTo: Date;
  searchStartDate?: Date;
  db?: OverloadRebalancerDb;
  generateDrafts?: DraftGenerator;
};

function cellKey(args: { pharmacistId: string; date: Date }) {
  return `${args.pharmacistId}:${formatUtcDateKey(args.date)}`;
}

function vehicleCellKey(args: { vehicleResourceId: string; date: Date }) {
  return `${args.vehicleResourceId}:${formatUtcDateKey(args.date)}`;
}

function proposalCellKey(
  proposal: Pick<OverloadProposalRow, 'proposed_pharmacist_id' | 'proposed_date'>,
) {
  return cellKey({
    pharmacistId: proposal.proposed_pharmacist_id,
    date: proposal.proposed_date,
  });
}

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function isMutableOverloadProposal(proposal: OverloadProposalRow) {
  return (
    proposal.proposal_status === 'proposed' &&
    proposal.patient_contact_status === 'pending' &&
    proposal.finalized_schedule_id == null &&
    proposal.reschedule_source_schedule_id == null
  );
}

function isEarlierDate(candidate: Date, source: Date) {
  return formatUtcDateKey(candidate) < formatUtcDateKey(source);
}

function minDate(left: Date, right: Date) {
  return left.getTime() <= right.getTime() ? left : right;
}

function selectEarlierCapacitySafeDraft(args: {
  drafts: ProposalDraft[];
  source: OverloadProposalRow;
  occupancyByCell: Map<string, number>;
  maxDailyByPharmacist: Map<string, number | null>;
  vehicleOccupancyByCell: Map<string, number>;
  maxStopsByVehicleResource: Map<string, number | null>;
}):
  | {
      ok: true;
      draft: ProposalDraft;
      destinationCount: number;
      destinationMax: number | null;
    }
  | {
      ok: false;
      reasonCode: Extract<
        OverloadRebalanceSkipReason,
        'no_earlier_candidate' | 'destination_capacity_full' | 'vehicle_capacity_full'
      >;
    } {
  let sawEarlier = false;
  let sawPharmacistCapacityFull = false;
  let sawVehicleCapacityFull = false;

  for (const draft of args.drafts) {
    if (!isEarlierDate(draft.proposed_date, args.source.proposed_date)) continue;
    sawEarlier = true;
    const destinationKey = cellKey({
      pharmacistId: draft.proposed_pharmacist_id,
      date: draft.proposed_date,
    });
    const destinationMax = args.maxDailyByPharmacist.get(draft.proposed_pharmacist_id) ?? null;
    const destinationCount = args.occupancyByCell.get(destinationKey) ?? 0;
    if (destinationMax != null && destinationCount >= destinationMax) {
      sawPharmacistCapacityFull = true;
      continue;
    }
    const vehicleResourceId = draft.vehicle_resource_id ?? null;
    if (vehicleResourceId) {
      const vehicleKey = vehicleCellKey({
        vehicleResourceId,
        date: draft.proposed_date,
      });
      if (!args.maxStopsByVehicleResource.has(vehicleResourceId)) {
        sawVehicleCapacityFull = true;
        continue;
      }
      const vehicleMax = args.maxStopsByVehicleResource.get(vehicleResourceId) ?? null;
      const vehicleCount = args.vehicleOccupancyByCell.get(vehicleKey) ?? 0;
      if (vehicleMax != null && vehicleCount >= vehicleMax) {
        sawVehicleCapacityFull = true;
        continue;
      }
    }
    return {
      ok: true,
      draft,
      destinationCount,
      destinationMax,
    };
  }
  if (!sawEarlier) return { ok: false, reasonCode: 'no_earlier_candidate' };
  return {
    ok: false,
    reasonCode:
      sawVehicleCapacityFull && !sawPharmacistCapacityFull
        ? 'vehicle_capacity_full'
        : 'destination_capacity_full',
  };
}

export async function previewVisitScheduleOverloadRebalance(
  args: PreviewVisitScheduleOverloadRebalanceArgs,
): Promise<PreviewVisitScheduleOverloadRebalanceResult> {
  const db = args.db ?? prisma;
  const generateDrafts = args.generateDrafts ?? generateVisitScheduleProposalDrafts;
  const occupancyStartDate = args.searchStartDate
    ? minDate(args.searchStartDate, args.dateFrom)
    : args.dateFrom;
  const occupancyProposals = await db.visitScheduleProposal.findMany({
    where: {
      org_id: args.orgId,
      finalized_schedule_id: null,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      proposed_date: {
        gte: occupancyStartDate,
        lte: args.dateTo,
      },
    },
    select: {
      id: true,
      case_id: true,
      site_id: true,
      visit_type: true,
      priority: true,
      proposal_status: true,
      patient_contact_status: true,
      finalized_schedule_id: true,
      proposed_date: true,
      proposed_pharmacist_id: true,
      route_order: true,
      vehicle_resource_id: true,
      reschedule_source_schedule_id: true,
    },
  });
  const proposals = occupancyProposals.filter(
    (proposal) => proposal.proposed_date >= args.dateFrom && proposal.proposed_date <= args.dateTo,
  );
  const pharmacistIds = Array.from(
    new Set(occupancyProposals.map((proposal) => proposal.proposed_pharmacist_id)),
  );
  if (proposals.length === 0) {
    return { overloaded_cells: [], previews: [], skipped: [] };
  }

  const [schedules, users, vehicleResources] = await Promise.all([
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
        scheduled_date: {
          gte: occupancyStartDate,
          lte: args.dateTo,
        },
        OR: [
          ...(pharmacistIds.length > 0 ? [{ pharmacist_id: { in: pharmacistIds } }] : []),
          { vehicle_resource_id: { not: null } },
        ],
      },
      select: {
        id: true,
        scheduled_date: true,
        pharmacist_id: true,
        vehicle_resource_id: true,
      },
    }),
    db.user.findMany({
      where: {
        org_id: args.orgId,
        id: { in: pharmacistIds },
      },
      select: {
        id: true,
        max_daily_visits: true,
      },
    }),
    db.visitVehicleResource.findMany({
      where: {
        org_id: args.orgId,
      },
      select: {
        id: true,
        max_stops: true,
      },
    }),
  ]);
  const maxDailyByPharmacist = new Map(users.map((user) => [user.id, user.max_daily_visits]));
  const maxStopsByVehicleResource = new Map(
    vehicleResources.map((vehicle) => [vehicle.id, vehicle.max_stops]),
  );
  const occupancyByCell = new Map<string, number>();
  const vehicleOccupancyByCell = new Map<string, number>();
  for (const schedule of schedules) {
    increment(
      occupancyByCell,
      cellKey({ pharmacistId: schedule.pharmacist_id, date: schedule.scheduled_date }),
    );
    if (schedule.vehicle_resource_id) {
      increment(
        vehicleOccupancyByCell,
        vehicleCellKey({
          vehicleResourceId: schedule.vehicle_resource_id,
          date: schedule.scheduled_date,
        }),
      );
    }
  }
  for (const proposal of occupancyProposals) {
    increment(occupancyByCell, proposalCellKey(proposal));
    if (proposal.vehicle_resource_id) {
      increment(
        vehicleOccupancyByCell,
        vehicleCellKey({
          vehicleResourceId: proposal.vehicle_resource_id,
          date: proposal.proposed_date,
        }),
      );
    }
  }
  const previewOccupancyByCell = new Map(occupancyByCell);
  const previewVehicleOccupancyByCell = new Map(vehicleOccupancyByCell);

  const proposalsByCell = new Map<string, OverloadProposalRow[]>();
  for (const proposal of proposals) {
    const key = proposalCellKey(proposal);
    const cellProposals = proposalsByCell.get(key);
    if (cellProposals) cellProposals.push(proposal);
    else proposalsByCell.set(key, [proposal]);
  }

  const overloadedCells: OverloadRebalanceOverloadedCell[] = [];
  const previews: OverloadRebalancePreview[] = [];
  const skipped: OverloadRebalanceSkippedProposal[] = [];

  for (const [key, cellProposals] of proposalsByCell.entries()) {
    const [pharmacistId, proposedDate] = key.split(':');
    if (!pharmacistId || !proposedDate) continue;
    const maxDailyVisits = maxDailyByPharmacist.get(pharmacistId) ?? null;
    if (maxDailyVisits == null) continue;
    const occupancyCount = occupancyByCell.get(key) ?? 0;
    if (occupancyCount <= maxDailyVisits) continue;
    const eligible = cellProposals.filter(isMutableOverloadProposal);
    overloadedCells.push({
      proposed_pharmacist_id: pharmacistId,
      proposed_date: proposedDate,
      occupancy_count: occupancyCount,
      max_daily_visits: maxDailyVisits,
      eligible_proposal_count: eligible.length,
    });

    for (const proposal of cellProposals) {
      if (!isMutableOverloadProposal(proposal)) {
        skipped.push({ source_proposal_id: proposal.id, reason_code: 'not_mutable' });
        continue;
      }
      const result = await generateDrafts({
        orgId: args.orgId,
        caseId: proposal.case_id,
        visitType: proposal.visit_type,
        priority: proposal.priority,
        candidateCount: 5,
        startDate: args.searchStartDate ?? args.dateFrom,
        preferredPharmacistId: proposal.proposed_pharmacist_id,
        vehicleResourceId: proposal.vehicle_resource_id ?? undefined,
      });
      const selected = selectEarlierCapacitySafeDraft({
        drafts: result.drafts,
        source: proposal,
        occupancyByCell: previewOccupancyByCell,
        maxDailyByPharmacist,
        vehicleOccupancyByCell: previewVehicleOccupancyByCell,
        maxStopsByVehicleResource,
      });
      if (!selected.ok) {
        skipped.push({
          source_proposal_id: proposal.id,
          reason_code: selected.reasonCode,
        });
        continue;
      }
      increment(
        previewOccupancyByCell,
        cellKey({
          pharmacistId: selected.draft.proposed_pharmacist_id,
          date: selected.draft.proposed_date,
        }),
      );
      if (selected.draft.vehicle_resource_id) {
        increment(
          previewVehicleOccupancyByCell,
          vehicleCellKey({
            vehicleResourceId: selected.draft.vehicle_resource_id,
            date: selected.draft.proposed_date,
          }),
        );
      }
      previews.push({
        source_proposal_id: proposal.id,
        reason_code: 'overload_advance',
        from: {
          proposed_date: formatUtcDateKey(proposal.proposed_date),
          proposed_pharmacist_id: proposal.proposed_pharmacist_id,
          route_order: proposal.route_order,
          occupancy_count: occupancyCount,
          max_daily_visits: maxDailyVisits,
        },
        replacement: {
          case_id: selected.draft.case_id,
          site_id: selected.draft.site_id,
          visit_type: selected.draft.visit_type,
          priority: selected.draft.priority,
          proposed_date: selected.draft.proposed_date,
          time_window_start: selected.draft.time_window_start,
          time_window_end: selected.draft.time_window_end,
          proposed_pharmacist_id: selected.draft.proposed_pharmacist_id,
          route_order: selected.draft.route_order,
          vehicle_resource_id: selected.draft.vehicle_resource_id,
          visit_deadline_date: selected.draft.visit_deadline_date,
        },
        diagnostics: {
          destination_date: formatUtcDateKey(selected.draft.proposed_date),
          destination_occupancy_count: selected.destinationCount,
          destination_max_daily_visits: selected.destinationMax,
        },
      });
    }
  }

  return {
    overloaded_cells: overloadedCells,
    previews,
    skipped,
  };
}

export function toVisitScheduleOverloadRebalanceApiPreview(
  result: PreviewVisitScheduleOverloadRebalanceResult,
): VisitScheduleOverloadRebalanceApiPreview {
  const skippedCounts = new Map<OverloadRebalanceSkipReason, number>();
  for (const skipped of result.skipped) {
    skippedCounts.set(skipped.reason_code, (skippedCounts.get(skipped.reason_code) ?? 0) + 1);
  }

  return {
    preview_only: true,
    apply_available: false,
    unsupported_guards: [...OVERLOAD_REBALANCE_UNSUPPORTED_GUARDS],
    overloaded_cells: result.overloaded_cells.map((cell) => ({
      date: cell.proposed_date,
      pharmacist_id: cell.proposed_pharmacist_id,
      occupancy_count: cell.occupancy_count,
      capacity_limit: cell.max_daily_visits,
      over_by: Math.max(0, cell.occupancy_count - cell.max_daily_visits),
      eligible_proposal_count: cell.eligible_proposal_count,
    })),
    recommendations: result.previews.map((preview) => ({
      source_proposal_id: preview.source_proposal_id,
      reason_code: preview.reason_code,
      from: {
        date: preview.from.proposed_date,
        pharmacist_id: preview.from.proposed_pharmacist_id,
        route_order: preview.from.route_order,
        occupancy_count: preview.from.occupancy_count,
        capacity_limit: preview.from.max_daily_visits,
      },
      replacement: {
        date: formatUtcDateKey(preview.replacement.proposed_date),
        time_window_start: timeDateToString(preview.replacement.time_window_start) ?? null,
        time_window_end: timeDateToString(preview.replacement.time_window_end) ?? null,
        pharmacist_id: preview.replacement.proposed_pharmacist_id,
        route_order: preview.replacement.route_order,
        site_id: preview.replacement.site_id,
        vehicle_resource_id: preview.replacement.vehicle_resource_id ?? null,
        visit_deadline_date: preview.replacement.visit_deadline_date
          ? formatUtcDateKey(preview.replacement.visit_deadline_date)
          : null,
        visit_type: preview.replacement.visit_type,
        priority: preview.replacement.priority,
      },
    })),
    skipped_summary: OVERLOAD_REBALANCE_SKIP_REASONS.map((reasonCode) => ({
      reason_code: reasonCode,
      count: skippedCounts.get(reasonCode) ?? 0,
    })),
  };
}
