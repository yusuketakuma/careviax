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
};

type OverloadUserRow = {
  id: string;
  max_daily_visits: number | null;
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
  | 'destination_capacity_full';

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
  'vehicle_open_proposal_capacity',
  'billing_cap_recheck',
] as const;

const OVERLOAD_REBALANCE_SKIP_REASONS: OverloadRebalanceSkipReason[] = [
  'not_mutable',
  'no_earlier_candidate',
  'destination_capacity_full',
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

function selectEarlierCapacitySafeDraft(args: {
  drafts: ProposalDraft[];
  source: OverloadProposalRow;
  occupancyByCell: Map<string, number>;
  maxDailyByPharmacist: Map<string, number | null>;
}) {
  for (const draft of args.drafts) {
    if (!isEarlierDate(draft.proposed_date, args.source.proposed_date)) continue;
    const destinationKey = cellKey({
      pharmacistId: draft.proposed_pharmacist_id,
      date: draft.proposed_date,
    });
    const destinationMax = args.maxDailyByPharmacist.get(draft.proposed_pharmacist_id) ?? null;
    const destinationCount = args.occupancyByCell.get(destinationKey) ?? 0;
    if (destinationMax != null && destinationCount >= destinationMax) {
      continue;
    }
    return {
      draft,
      destinationCount,
      destinationMax,
    };
  }
  return null;
}

export async function previewVisitScheduleOverloadRebalance(
  args: PreviewVisitScheduleOverloadRebalanceArgs,
): Promise<PreviewVisitScheduleOverloadRebalanceResult> {
  const db = args.db ?? prisma;
  const generateDrafts = args.generateDrafts ?? generateVisitScheduleProposalDrafts;
  const proposals = await db.visitScheduleProposal.findMany({
    where: {
      org_id: args.orgId,
      finalized_schedule_id: null,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      proposed_date: {
        gte: args.dateFrom,
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
  const pharmacistIds = Array.from(
    new Set(proposals.map((proposal) => proposal.proposed_pharmacist_id)),
  );
  if (pharmacistIds.length === 0) {
    return { overloaded_cells: [], previews: [], skipped: [] };
  }

  const [schedules, users] = await Promise.all([
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
        scheduled_date: {
          gte: args.dateFrom,
          lte: args.dateTo,
        },
        pharmacist_id: { in: pharmacistIds },
      },
      select: {
        id: true,
        scheduled_date: true,
        pharmacist_id: true,
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
  ]);
  const maxDailyByPharmacist = new Map(users.map((user) => [user.id, user.max_daily_visits]));
  const occupancyByCell = new Map<string, number>();
  for (const schedule of schedules) {
    increment(
      occupancyByCell,
      cellKey({ pharmacistId: schedule.pharmacist_id, date: schedule.scheduled_date }),
    );
  }
  for (const proposal of proposals) {
    increment(occupancyByCell, proposalCellKey(proposal));
  }
  const previewOccupancyByCell = new Map(occupancyByCell);

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
      });
      if (!selected) {
        const hasEarlier = result.drafts.some((draft) =>
          isEarlierDate(draft.proposed_date, proposal.proposed_date),
        );
        skipped.push({
          source_proposal_id: proposal.id,
          reason_code: hasEarlier ? 'destination_capacity_full' : 'no_earlier_candidate',
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
