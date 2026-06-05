import type { Proposal, VisitSchedule } from './day-view.shared';
import { deriveVisitPlaceGroup } from '@/lib/utils/facility';

export type WeekProposalStats = {
  approvalPending: number;
  contactPending: number;
  confirmedSchedules: number;
  lockedSchedules: number;
  pendingOverrides: number;
  emergencyImpacts: number;
  fallbackAssignments: number;
};

export type DepartureCarryWarning = {
  title: string;
  description: string;
};

export type LockBadge = {
  label: string;
  className: string;
  detail?: string;
};

export type FacilityTrackerGroup = {
  key: string;
  batchId: string | null;
  label: string;
  siteName: string | null;
  patientNames: string[];
  scheduleIds: string[];
  patients: Array<{
    scheduleId: string;
    patientName: string;
    unitName: string | null;
    routeOrder: number | null;
  }>;
  preparedCount: number;
  carryPendingCount: number;
  incompleteCount: number;
  routeOrders: number[];
};

export type FacilityTrackableSchedule = {
  case_: {
    patient: {
      residences: Array<
        VisitSchedule['case_']['patient']['residences'][number] & {
          facility_id?: string | null;
          facility_unit_id?: string | null;
        }
      >;
    };
  };
  facility_batch_id: VisitSchedule['facility_batch_id'];
  facility_hint: Pick<NonNullable<VisitSchedule['facility_hint']>, 'label'> | null;
  site: Pick<NonNullable<VisitSchedule['site']>, 'id' | 'name'> | null;
};

export type ScheduleLockState = {
  confirmed_at: VisitSchedule['confirmed_at'];
  applied_override: unknown | null;
  override_request: Pick<
    NonNullable<VisitSchedule['override_request']>,
    'status' | 'reason'
  > | null;
};

export type FacilityTrackerSchedule = FacilityTrackableSchedule &
  Pick<VisitSchedule, 'id' | 'route_order' | 'schedule_status'> & {
    case_: FacilityTrackableSchedule['case_'] & {
      patient: FacilityTrackableSchedule['case_']['patient'] & {
        name: string;
      };
    };
    preparation: Pick<
      NonNullable<VisitSchedule['preparation']>,
      'prepared_at' | 'carry_items_confirmed'
    > | null;
  };

export type FacilityTrackerGrouping = {
  key: string;
  label: string;
};

export function getFacilityTrackerGrouping(
  schedule: FacilityTrackableSchedule,
): FacilityTrackerGrouping | null {
  const visitPlaceGroup = deriveVisitPlaceGroup(schedule.case_.patient.residences[0] ?? null);
  const label = schedule.facility_hint?.label ?? visitPlaceGroup?.label ?? null;
  const placeKey = schedule.facility_hint?.label ?? visitPlaceGroup?.key ?? null;
  if (!label || !placeKey) return null;

  return {
    key: [
      schedule.site?.id ?? 'site:none',
      schedule.facility_batch_id ?? 'batch:none',
      placeKey,
    ].join(':'),
    label,
  };
}

export function buildWeekProposalStats(
  proposals: Pick<Proposal, 'proposal_status' | 'priority' | 'assignment_mode'>[],
  schedules: Pick<
    VisitSchedule,
    'confirmed_at' | 'override_request' | 'priority' | 'assignment_mode'
  >[],
): WeekProposalStats {
  return {
    approvalPending: proposals.filter((proposal) =>
      ['proposed', 'reschedule_pending'].includes(proposal.proposal_status),
    ).length,
    contactPending: proposals.filter(
      (proposal) => proposal.proposal_status === 'patient_contact_pending',
    ).length,
    confirmedSchedules: schedules.filter((schedule) => schedule.confirmed_at).length,
    lockedSchedules: schedules.filter((schedule) => Boolean(schedule.confirmed_at)).length,
    pendingOverrides: schedules.filter(
      (schedule) => schedule.override_request?.status === 'pending',
    ).length,
    emergencyImpacts:
      proposals.filter((proposal) => proposal.priority === 'emergency').length +
      schedules.filter((schedule) => schedule.priority === 'emergency').length,
    fallbackAssignments:
      proposals.filter((proposal) => proposal.assignment_mode === 'fallback').length +
      schedules.filter((schedule) => schedule.assignment_mode === 'fallback').length,
  };
}

export function getDepartureCarryWarning(
  schedule: Pick<VisitSchedule, 'carry_items_status'> | null,
): DepartureCarryWarning | null {
  if (!schedule) return null;

  if (schedule.carry_items_status === 'blocked') {
    return {
      title: '持参薬が未確定のままです',
      description:
        'この訪問は持参物が blocked です。代替手配または持参物の確定を行わないまま出発すると、訪問先で投薬継続が止まる可能性があります。',
    };
  }

  if (schedule.carry_items_status === 'partial') {
    return {
      title: '持参物の一部が未確定です',
      description:
        'この訪問は持参物が partial です。未確定分を確認しないまま出発すると、現地で一部対応のみになる可能性があります。',
    };
  }

  return null;
}

export function buildDirectionsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function buildMapEmbedUrl(address: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
}

export function splitTrace(reason: string) {
  return reason
    .split(' / ')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function scheduleLockText(schedule: ScheduleLockState): LockBadge {
  if (schedule.override_request?.status === 'pending') {
    return {
      label: '変更承認待ち',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      detail: schedule.override_request.reason,
    };
  }
  if (schedule.confirmed_at) {
    return {
      label: '運用ロック',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      detail: '確定後は原則変更せず、専用リスケのみ許可します',
    };
  }
  if (schedule.applied_override) {
    return {
      label: '再調整済み',
      className: 'border-orange-200 bg-orange-50 text-orange-700',
      detail: '確定済み訪問の変更から再構成されています',
    };
  }
  return {
    label: '変更可能',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    detail: '未確定のため調整可能です',
  };
}

export function proposalLockText(
  proposal: Pick<Proposal, 'proposal_status' | 'finalized_schedule_id'>,
): LockBadge {
  if (proposal.proposal_status === 'confirmed' || proposal.finalized_schedule_id) {
    return {
      label: '確定済み',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (proposal.proposal_status === 'patient_contact_pending') {
    return {
      label: '電話待ち',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    };
  }
  if (proposal.proposal_status === 'reschedule_pending') {
    return {
      label: '再調整中',
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    };
  }
  return {
    label: '提案中',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  };
}

export function buildFacilityTracker(schedules: FacilityTrackerSchedule[]): FacilityTrackerGroup[] {
  const groups = new Map<string, FacilityTrackerGroup>();

  for (const schedule of schedules) {
    const grouping = getFacilityTrackerGrouping(schedule);
    if (!grouping) continue;

    const existing = groups.get(grouping.key) ?? {
      key: grouping.key,
      batchId: schedule.facility_batch_id,
      label: grouping.label,
      siteName: schedule.site?.name ?? null,
      patientNames: [],
      scheduleIds: [],
      patients: [],
      preparedCount: 0,
      carryPendingCount: 0,
      incompleteCount: 0,
      routeOrders: [],
    };

    existing.batchId = existing.batchId ?? schedule.facility_batch_id;
    existing.patientNames.push(schedule.case_.patient.name);
    existing.scheduleIds.push(schedule.id);
    existing.patients.push({
      scheduleId: schedule.id,
      patientName: schedule.case_.patient.name,
      unitName: schedule.case_.patient.residences[0]?.unit_name ?? null,
      routeOrder: schedule.route_order,
    });
    if (schedule.preparation?.prepared_at) existing.preparedCount += 1;
    if (!schedule.preparation?.carry_items_confirmed) existing.carryPendingCount += 1;
    if (!['completed', 'cancelled'].includes(schedule.schedule_status)) {
      existing.incompleteCount += 1;
    }
    if (schedule.route_order != null) existing.routeOrders.push(schedule.route_order);

    groups.set(grouping.key, existing);
  }

  return Array.from(groups.values())
    .filter((group) => group.patientNames.length > 1)
    .sort((left, right) => left.label.localeCompare(right.label, 'ja'));
}

export function buildFacilityRouteDefaults(
  groups: FacilityTrackerGroup[],
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    groups.map((group) => [
      group.key,
      Object.fromEntries(
        group.patients.map((patient, index) => [
          patient.scheduleId,
          String(patient.routeOrder ?? index + 1),
        ]),
      ),
    ]),
  ) as Record<string, Record<string, string>>;
}
