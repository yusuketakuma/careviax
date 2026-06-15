import type {
  Proposal,
  VisitSchedule,
  VisitPriority,
} from '@/app/(dashboard)/schedules/day-view.shared';
import { buildScheduleProposalHref } from '@/app/(dashboard)/schedules/proposals/proposal-query-state';

export type HomeVisitScope = 'pharmacy' | 'mine' | 'user';
export type HomeProposalFilter = 'all' | 'pending' | 'change_requested' | 'reschedule';
export type HomeVisitStatusFilter = 'all' | 'before_departure' | 'ready_to_depart' | 'in_progress';
export type HomeScheduleStaffOption = {
  id: string;
  name: string;
  siteName: string | null;
  monthlyVisitCount?: number;
};
export type HomeScheduleStaffSummary = {
  id: string;
  name: string;
  siteName: string | null;
  totalVisits: number;
  preparationPending: number;
  timingGaps: number;
  inProgress: number;
};
export type HomeScheduleReasonKey =
  | 'urgent_priority'
  | 'preparation_pending'
  | 'timing_gap'
  | 'ready_to_depart'
  | 'in_progress'
  | 'override_pending';
export type HomeProposalReasonKey =
  | 'reschedule_origin'
  | 'change_requested'
  | 'unreachable'
  | 'pending_contact'
  | 'urgent_priority';
export type HomeScheduleBoardTab = 'confirmed' | 'proposals';
export type HomeScheduleAction = {
  href: string;
  label: string;
  emphasis: 'primary' | 'secondary';
};
export type HomeProposalAction = {
  href: string;
  label: string;
};
export type HomePriorityReason = {
  key: HomeScheduleReasonKey | HomeProposalReasonKey;
  label: string;
  tone: 'warning' | 'danger' | 'info' | 'success';
};

function priorityRank(priority: VisitPriority) {
  switch (priority) {
    case 'emergency':
      return 0;
    case 'urgent':
      return 1;
    default:
      return 2;
  }
}

function timeValue(value: string | null) {
  if (!value) return '99:99';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '99:99';
  return parsed.toISOString().slice(11, 16);
}

export function scheduleNeedsPreparation(schedule: VisitSchedule) {
  return (
    !['completed', 'cancelled'].includes(schedule.schedule_status) &&
    !schedule.preparation?.prepared_at
  );
}

export function scheduleHasTimingGap(schedule: VisitSchedule) {
  return !schedule.time_window_start || !schedule.time_window_end;
}

export function proposalNeedsCoordination(proposal: Proposal) {
  return (
    proposal.proposal_status === 'patient_contact_pending' ||
    proposal.proposal_status === 'reschedule_pending' ||
    proposal.patient_contact_status === 'pending' ||
    proposal.patient_contact_status === 'change_requested' ||
    proposal.patient_contact_status === 'unreachable'
  );
}

export function filterSchedulesByScope(
  schedules: VisitSchedule[],
  scope: HomeVisitScope,
  currentUserId: string | null,
  selectedUserId?: string | null,
) {
  switch (scope) {
    case 'mine':
      return currentUserId
        ? schedules.filter((schedule) => schedule.pharmacist_id === currentUserId)
        : [];
    case 'user':
      return selectedUserId
        ? schedules.filter((schedule) => schedule.pharmacist_id === selectedUserId)
        : [];
    default:
      return schedules;
  }
}

export function countSchedulesByScope(
  schedules: VisitSchedule[],
  scope: HomeVisitScope,
  currentUserId: string | null,
  selectedUserId?: string | null,
) {
  return filterSchedulesByScope(schedules, scope, currentUserId, selectedUserId).length;
}

export function filterSchedulesByStatus(schedules: VisitSchedule[], filter: HomeVisitStatusFilter) {
  switch (filter) {
    case 'before_departure':
      return schedules.filter(
        (schedule) =>
          schedule.schedule_status === 'planned' || schedule.schedule_status === 'in_preparation',
      );
    case 'ready_to_depart':
      return schedules.filter((schedule) => schedule.schedule_status === 'ready');
    case 'in_progress':
      return schedules.filter(
        (schedule) =>
          schedule.schedule_status === 'departed' || schedule.schedule_status === 'in_progress',
      );
    default:
      return schedules;
  }
}

export function countSchedulesByStatus(schedules: VisitSchedule[], filter: HomeVisitStatusFilter) {
  return filterSchedulesByStatus(schedules, filter).length;
}

export function filterSchedulesByReason(
  schedules: VisitSchedule[],
  reasonKey: HomeScheduleReasonKey | 'all',
) {
  if (reasonKey === 'all') return schedules;

  return schedules.filter((schedule) =>
    resolveSchedulePriorityReasons(schedule).some((reason) => reason.key === reasonKey),
  );
}

export function countSchedulesByReason(
  schedules: VisitSchedule[],
  reasonKey: HomeScheduleReasonKey | 'all',
) {
  return filterSchedulesByReason(schedules, reasonKey).length;
}

export function buildScheduleBoardHref(
  schedule: VisitSchedule,
  tab: HomeScheduleBoardTab = 'confirmed',
) {
  const params = new URLSearchParams({
    date: schedule.scheduled_date.slice(0, 10),
    tab,
    schedule: schedule.id,
  });
  return `/schedules?${params.toString()}#schedule-${schedule.id}`;
}

export function buildSchedulePatientHref(schedule: VisitSchedule) {
  return `/patients/${schedule.case_.patient.id}#card-recent-activities`;
}

export function buildProposalBoardHref(proposal: Proposal): string {
  const patch: Record<string, string | null | undefined> = {
    workspace: 'dashboard',
    detail: proposal.id,
    focus: 'detail',
  };

  if (proposal.proposal_status === 'patient_contact_pending') {
    patch.status = 'patient_contact_pending';
    patch.preset = 'contact';
  } else if (proposal.proposal_status === 'confirmed') {
    patch.status = 'confirmed';
    patch.preset = null;
  } else if (proposal.proposal_status === 'rejected') {
    patch.status = 'rejected';
    patch.preset = null;
  } else if (proposal.proposal_status === 'reschedule_pending') {
    patch.status = 'proposed';
    patch.preset = 'reschedule';
  } else {
    patch.status = 'proposed';
    patch.preset = null;
  }

  return buildScheduleProposalHref({
    params: { workspace: 'dashboard' },
    patch,
  });
}

export function buildProposalPatientHref(proposal: Proposal) {
  return `/patients/${proposal.case_.patient.id}#card-recent-activities`;
}

export function resolveProposalPrimaryAction(proposal: Proposal): HomeProposalAction {
  if (proposal.proposal_status === 'reschedule_pending') {
    return {
      href: buildProposalBoardHref(proposal),
      label: '再調整を開く',
    };
  }

  if (proposal.patient_contact_status === 'change_requested') {
    return {
      href: buildProposalBoardHref(proposal),
      label: '変更希望を確認',
    };
  }

  if (
    proposal.proposal_status === 'patient_contact_pending' ||
    proposal.patient_contact_status === 'pending'
  ) {
    return {
      href: buildProposalBoardHref(proposal),
      label: '架電対応を開く',
    };
  }

  return {
    href: buildProposalBoardHref(proposal),
    label: '提案一覧で確認',
  };
}

export function resolveSchedulePriorityReasons(schedule: VisitSchedule): HomePriorityReason[] {
  const reasons: HomePriorityReason[] = [];

  if (schedule.priority === 'emergency') {
    reasons.push({ key: 'urgent_priority', label: '緊急訪問', tone: 'danger' });
  } else if (schedule.priority === 'urgent') {
    reasons.push({ key: 'urgent_priority', label: '至急対応', tone: 'warning' });
  }

  if (scheduleNeedsPreparation(schedule)) {
    reasons.push({ key: 'preparation_pending', label: '準備未完了', tone: 'warning' });
  }

  if (scheduleHasTimingGap(schedule)) {
    reasons.push({ key: 'timing_gap', label: '時間未確定', tone: 'danger' });
  }

  if (schedule.schedule_status === 'ready') {
    reasons.push({ key: 'ready_to_depart', label: '出発待ち', tone: 'info' });
  }

  if (schedule.schedule_status === 'departed' || schedule.schedule_status === 'in_progress') {
    reasons.push({ key: 'in_progress', label: '訪問進行中', tone: 'info' });
  }

  if (schedule.override_request?.status === 'pending') {
    reasons.push({ key: 'override_pending', label: '変更承認待ち', tone: 'warning' });
  }

  return reasons.slice(0, 3);
}

export function resolveSchedulePrimaryAction(schedule: VisitSchedule): HomeScheduleAction {
  if (schedule.schedule_status === 'ready') {
    return {
      href: `/visits/${schedule.id}/record`,
      label: '出発確認',
      emphasis: 'primary',
    };
  }

  if (schedule.schedule_status === 'departed' || schedule.schedule_status === 'in_progress') {
    return {
      href: `/visits/${schedule.id}/record`,
      label: '記録を再開',
      emphasis: 'primary',
    };
  }

  return {
    href: buildScheduleBoardHref(schedule),
    label: scheduleNeedsPreparation(schedule) ? '準備を開く' : '予定を確認',
    emphasis: 'primary',
  };
}

export function resolveScheduleSecondaryAction(schedule: VisitSchedule): HomeScheduleAction {
  if (
    schedule.schedule_status === 'ready' ||
    schedule.schedule_status === 'departed' ||
    schedule.schedule_status === 'in_progress'
  ) {
    return {
      href: buildScheduleBoardHref(schedule),
      label: 'スケジュールで確認',
      emphasis: 'secondary',
    };
  }

  return {
    href: `/visits/${schedule.id}/record`,
    label: '訪問記録',
    emphasis: 'secondary',
  };
}

export function resolveProposalPriorityReasons(proposal: Proposal): HomePriorityReason[] {
  const reasons: HomePriorityReason[] = [];

  if (proposal.proposal_status === 'reschedule_pending') {
    reasons.push({ key: 'reschedule_origin', label: '再調整由来', tone: 'warning' });
  }

  if (proposal.patient_contact_status === 'change_requested') {
    reasons.push({ key: 'change_requested', label: '変更希望', tone: 'danger' });
  }

  if (proposal.patient_contact_status === 'unreachable') {
    reasons.push({ key: 'unreachable', label: '連絡不通', tone: 'warning' });
  }

  if (
    proposal.proposal_status === 'patient_contact_pending' ||
    proposal.patient_contact_status === 'pending'
  ) {
    reasons.push({ key: 'pending_contact', label: '未架電', tone: 'info' });
  }

  if (proposal.priority === 'emergency') {
    reasons.push({ key: 'urgent_priority', label: '緊急候補', tone: 'danger' });
  } else if (proposal.priority === 'urgent') {
    reasons.push({ key: 'urgent_priority', label: '至急候補', tone: 'warning' });
  }

  return reasons.slice(0, 3);
}

export function filterProposalsByReason(
  proposals: Proposal[],
  reasonKey: HomeProposalReasonKey | 'all',
) {
  if (reasonKey === 'all') return proposals;

  return proposals.filter((proposal) =>
    resolveProposalPriorityReasons(proposal).some((reason) => reason.key === reasonKey),
  );
}

export function countProposalsByReason(
  proposals: Proposal[],
  reasonKey: HomeProposalReasonKey | 'all',
) {
  return filterProposalsByReason(proposals, reasonKey).length;
}

export function filterCoordinationProposals(proposals: Proposal[], filter: HomeProposalFilter) {
  switch (filter) {
    case 'pending':
      return proposals.filter(
        (proposal) =>
          proposal.proposal_status === 'patient_contact_pending' ||
          proposal.patient_contact_status === 'pending',
      );
    case 'change_requested':
      return proposals.filter((proposal) => proposal.patient_contact_status === 'change_requested');
    case 'reschedule':
      return proposals.filter(
        (proposal) =>
          proposal.proposal_status === 'reschedule_pending' ||
          proposal.patient_contact_status === 'unreachable',
      );
    default:
      return proposals;
  }
}

export function countCoordinationProposalsByFilter(
  proposals: Proposal[],
  filter: HomeProposalFilter,
) {
  return filterCoordinationProposals(proposals, filter).length;
}

export function sortHomeSchedules(schedules: VisitSchedule[]) {
  return [...schedules].sort((left, right) => {
    const timeDiff = timeValue(left.time_window_start).localeCompare(
      timeValue(right.time_window_start),
    );
    if (timeDiff !== 0) return timeDiff;

    const routeDiff =
      (left.route_order ?? Number.MAX_SAFE_INTEGER) -
      (right.route_order ?? Number.MAX_SAFE_INTEGER);
    if (routeDiff !== 0) return routeDiff;

    return priorityRank(left.priority) - priorityRank(right.priority);
  });
}

export function sortCoordinationProposals(proposals: Proposal[]) {
  return [...proposals].sort((left, right) => {
    const dateDiff = left.proposed_date.localeCompare(right.proposed_date);
    if (dateDiff !== 0) return dateDiff;

    const timeDiff = timeValue(left.time_window_start).localeCompare(
      timeValue(right.time_window_start),
    );
    if (timeDiff !== 0) return timeDiff;

    return priorityRank(left.priority) - priorityRank(right.priority);
  });
}

export function buildHomeScheduleMetrics(schedules: VisitSchedule[], proposals: Proposal[]) {
  const totalVisits = schedules.length;
  const preparationPending = schedules.filter(scheduleNeedsPreparation).length;
  const timingGaps = schedules.filter(scheduleHasTimingGap).length;
  const coordinationPending = proposals.filter(proposalNeedsCoordination).length;

  return {
    totalVisits,
    preparationPending,
    timingGaps,
    coordinationPending,
  };
}

export function buildHomeScheduleStaffOptions(
  schedules: VisitSchedule[],
  staffOptions: HomeScheduleStaffOption[],
) {
  const optionsById = new Map(staffOptions.map((staff) => [staff.id, staff]));

  for (const schedule of schedules) {
    if (!optionsById.has(schedule.pharmacist_id)) {
      optionsById.set(schedule.pharmacist_id, {
        id: schedule.pharmacist_id,
        name: '担当者未登録',
        siteName: null,
      });
    }
  }

  return Array.from(optionsById.values()).sort((left, right) =>
    left.name.localeCompare(right.name, 'ja'),
  );
}

export function buildHomeScheduleStaffSummaries(
  schedules: VisitSchedule[],
  staffOptions: HomeScheduleStaffOption[],
): HomeScheduleStaffSummary[] {
  const options = buildHomeScheduleStaffOptions(schedules, staffOptions);

  return options
    .map((staff) => {
      const staffSchedules = schedules.filter((schedule) => schedule.pharmacist_id === staff.id);
      return {
        id: staff.id,
        name: staff.name,
        siteName: staff.siteName,
        totalVisits: staffSchedules.length,
        preparationPending: staffSchedules.filter(scheduleNeedsPreparation).length,
        timingGaps: staffSchedules.filter(scheduleHasTimingGap).length,
        inProgress: staffSchedules.filter(
          (schedule) =>
            schedule.schedule_status === 'departed' || schedule.schedule_status === 'in_progress',
        ).length,
      };
    })
    .filter((summary) => summary.totalVisits > 0)
    .sort((left, right) => {
      const totalDiff = right.totalVisits - left.totalVisits;
      if (totalDiff !== 0) return totalDiff;
      return left.name.localeCompare(right.name, 'ja');
    });
}
