import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { deriveVisitPlaceGroup } from '@/lib/utils/facility';
import {
  formatEtaLabel,
  minutesFromTimestamp,
  roundDownToSlot,
  roundUpToSlot,
} from './calendar-view.helpers';
import { timeLabel, toDateKey, type Proposal, type VisitSchedule } from './day-view.shared';

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
    carryItemsStatus: VisitSchedule['carry_items_status'];
    carryItemsConfirmed: boolean;
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
  Pick<VisitSchedule, 'id' | 'route_order' | 'schedule_status' | 'carry_items_status'> & {
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

export type ScheduleDayRoutePharmacistOption = {
  id: string;
  name: string;
  siteName: string | null;
};

export type ScheduleDayViewModel = {
  selectedDateSchedules: VisitSchedule[];
  facilityTracker: FacilityTrackerGroup[];
  facilityRouteDefaults: Record<string, Record<string, string>>;
  activeFacilityFilter: string | null;
  visibleSchedules: VisitSchedule[];
  mobileVisitSchedules: VisitSchedule[];
  mobileFacilityGroups: FacilityTrackerGroup[];
  routePharmacistOptions: ScheduleDayRoutePharmacistOption[];
  resolvedRoutePharmacistId: string;
  routeMapSchedules: VisitSchedule[];
  currentOrderedRouteScheduleIds: string[];
  routeDepartureTime: string | null;
  routeSelectionLabel: string | null;
};

export type ScheduleDayViewModelInput = {
  schedules: VisitSchedule[];
  selectedDate: string;
  facilityFilter: string | null;
  pharmacistNameById: ReadonlyMap<string, string>;
  selectedRoutePharmacistId: string;
};

export type ScheduleDayRoutePlanStopSummary = {
  scheduleId: string;
  arrivalOffsetSeconds: number | null;
};

export type ScheduleDayRouteMapPoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  orderLabel: string;
  status: VisitSchedule['schedule_status'];
  priority: VisitSchedule['priority'];
  etaLabel: string | null;
  timeLabel: string;
  pointKind: 'schedule';
};

export type ScheduleDayRouteMapSite = {
  name: string;
  lat: number;
  lng: number;
};

export type ScheduleDayRouteMapInput = {
  routeMapSchedules: VisitSchedule[];
  draftScheduleIds: string[];
  manualDirty: boolean;
  selectedDate: string;
  routeDepartureTime: string | null;
  routePlanByScheduleId: ReadonlyMap<string, ScheduleDayRoutePlanStopSummary>;
};

export type ScheduleDayGanttWindow = {
  startMinutes: number;
  endMinutes: number;
};

export type ScheduleDayGanttSchedule = VisitSchedule & {
  blockStartMinutes: number;
  blockEndMinutes: number;
};

export type ScheduleDayGanttColumn = {
  pharmacistId: string;
  pharmacistName: string;
  siteName: string | null;
  schedules: ScheduleDayGanttSchedule[];
};

export type ScheduleDayGanttTableCell = {
  schedule: ScheduleDayGanttSchedule;
  schedules: ScheduleDayGanttSchedule[];
  span: number;
  overlapKind: 'same_start' | 'overlap' | null;
};

export type ScheduleDayGanttTableColumn = ScheduleDayGanttColumn & {
  scheduleStarts: Map<number, ScheduleDayGanttTableCell>;
  coveredSlots: Set<number>;
};

export type ScheduleDayGanttViewModel = {
  window: ScheduleDayGanttWindow;
  slots: number[];
  columns: ScheduleDayGanttColumn[];
  tableColumns: ScheduleDayGanttTableColumn[];
};

export type ScheduleDayGanttInput = {
  visibleSchedules: VisitSchedule[];
  pharmacistNameById: ReadonlyMap<string, string>;
};

export type ScheduleDayOfflineStatusViewModel = {
  visible: boolean;
  networkBadgeLabel: 'オフライン' | 'オンライン';
  networkBadgeClassName: string;
  pendingSyncLabel: string;
  conflictLabel: string;
  ttlLabel: string;
  visitBriefCoverageLabel: string;
  visitBriefCoverageClassName: string;
  visitBriefStatusLabel: string;
  visitBriefStatusClassName: string;
  lastSyncLabel: string;
  canManualSync: boolean;
  manualSyncDisabledReason: string | null;
  showConflictResolutionHint: boolean;
};

export type ScheduleDayVisitBriefCacheStatus = 'ready' | 'load_failed' | 'refresh_failed';

export type ScheduleDayOfflineStatusInput = {
  isOffline: boolean;
  pendingSyncCount: number;
  syncConflictCount: number;
  cachedVisitBriefCount: number;
  selectedDateScheduleCount: number;
  cachedVisitBriefUpdatedAt: string | null;
  visitBriefCacheStatus: ScheduleDayVisitBriefCacheStatus;
  cacheTtlHours: number;
};

export type ProposalBillingPreviewRequest = {
  proposalId: string;
  caseId: string;
  proposedDate: string;
  pharmacistId: string;
  siteId: string | null;
  visitType: Proposal['visit_type'];
};

export type ScheduleBillingPreviewRequest = {
  scheduleId: string;
  caseId: string;
  proposedDate: string;
  pharmacistId: string;
  siteId: string | null;
  visitType: VisitSchedule['visit_type'];
};

export const SCHEDULE_DAY_GANTT_SLOT_MINUTES = 30;
export const SCHEDULE_DAY_GANTT_DEFAULT_START_MINUTES = 8 * 60;
export const SCHEDULE_DAY_GANTT_DEFAULT_END_MINUTES = 18 * 60;

export function buildScheduleDayOfflineStatus({
  isOffline,
  pendingSyncCount,
  syncConflictCount,
  cachedVisitBriefCount,
  selectedDateScheduleCount,
  cachedVisitBriefUpdatedAt,
  visitBriefCacheStatus,
  cacheTtlHours,
}: ScheduleDayOfflineStatusInput): ScheduleDayOfflineStatusViewModel {
  const missingVisitBriefCount = Math.max(0, selectedDateScheduleCount - cachedVisitBriefCount);
  const hasVisitBriefCoverageGap = selectedDateScheduleCount > 0 && missingVisitBriefCount > 0;
  const hasVisitBriefFailure = visitBriefCacheStatus !== 'ready';
  const visitBriefCoverageLabel =
    selectedDateScheduleCount > 0
      ? `ブリーフ ${cachedVisitBriefCount}/${selectedDateScheduleCount} 件`
      : 'ブリーフ対象 0 件';
  const visitBriefCoverageClassName =
    hasVisitBriefCoverageGap || hasVisitBriefFailure
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  const visitBriefStatusLabel =
    visitBriefCacheStatus === 'load_failed'
      ? '端末キャッシュを読み込めません。患者詳細と処方を確認してください。'
      : visitBriefCacheStatus === 'refresh_failed'
        ? '軽量 brief を更新できません。患者詳細と処方を確認してください。'
        : hasVisitBriefCoverageGap
          ? `未取得 ${missingVisitBriefCount} 件。患者詳細と処方を確認してください。`
          : selectedDateScheduleCount > 0
            ? '当日予定の軽量 brief を同期済みです。'
            : '当日の確定訪問はありません。';
  const visitBriefStatusClassName =
    hasVisitBriefCoverageGap || hasVisitBriefFailure ? 'text-amber-700' : 'text-muted-foreground';

  return {
    visible:
      isOffline ||
      pendingSyncCount > 0 ||
      syncConflictCount > 0 ||
      cachedVisitBriefCount > 0 ||
      hasVisitBriefCoverageGap ||
      hasVisitBriefFailure,
    networkBadgeLabel: isOffline ? 'オフライン' : 'オンライン',
    networkBadgeClassName: isOffline
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700',
    pendingSyncLabel: `同期待ち ${pendingSyncCount} 件`,
    conflictLabel: `競合 ${syncConflictCount} 件`,
    ttlLabel: `読取専用 TTL ${cacheTtlHours}h`,
    visitBriefCoverageLabel,
    visitBriefCoverageClassName,
    visitBriefStatusLabel,
    visitBriefStatusClassName,
    lastSyncLabel: cachedVisitBriefUpdatedAt
      ? format(parseISO(cachedVisitBriefUpdatedAt), 'M/d HH:mm', { locale: ja })
      : '未実施',
    canManualSync: pendingSyncCount > 0,
    manualSyncDisabledReason:
      pendingSyncCount > 0
        ? null
        : syncConflictCount > 0
          ? '競合を解決してから同期してください'
          : '同期待ちの下書きはありません',
    showConflictResolutionHint: syncConflictCount > 0,
  };
}

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

export function canOverrideDepartureCarryWarning(
  schedule: Pick<VisitSchedule, 'carry_items_status'> | null,
) {
  return schedule?.carry_items_status === 'partial';
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
      carryItemsStatus: schedule.carry_items_status,
      carryItemsConfirmed: schedule.preparation?.carry_items_confirmed ?? false,
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

export function formatFacilityCarryItemsStatus(status: VisitSchedule['carry_items_status']) {
  if (status === 'ready') return '持参準備済み';
  if (status === 'partial') return '一部不足';
  if (status === 'blocked') return '不足で出発不可';
  return '未判定';
}

export function getUnsafeFacilityCarryPatients(group: FacilityTrackerGroup | null) {
  if (!group) return [];
  return group.patients.filter((patient) => patient.carryItemsStatus !== 'ready');
}

export function canBulkConfirmFacilityCarryItems(group: FacilityTrackerGroup | null) {
  return group !== null && getUnsafeFacilityCarryPatients(group).length === 0;
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

export function buildProposalBillingPreviewRequests(
  proposals: Pick<
    Proposal,
    'id' | 'case_id' | 'proposed_date' | 'proposed_pharmacist_id' | 'site' | 'visit_type'
  >[],
): ProposalBillingPreviewRequest[] {
  return proposals.map((proposal) => ({
    proposalId: proposal.id,
    caseId: proposal.case_id,
    proposedDate: toDateKey(proposal.proposed_date),
    pharmacistId: proposal.proposed_pharmacist_id,
    siteId: proposal.site?.id ?? null,
    visitType: proposal.visit_type,
  }));
}

export function buildScheduleBillingPreviewRequests(
  schedules: Pick<
    VisitSchedule,
    'id' | 'case_id' | 'scheduled_date' | 'pharmacist_id' | 'site' | 'visit_type'
  >[],
): ScheduleBillingPreviewRequest[] {
  return schedules.map((schedule) => ({
    scheduleId: schedule.id,
    caseId: schedule.case_id,
    proposedDate: toDateKey(schedule.scheduled_date),
    pharmacistId: schedule.pharmacist_id,
    siteId: schedule.site?.id ?? null,
    visitType: schedule.visit_type,
  }));
}

function compareSchedulesByRouteOrderThenTime(left: VisitSchedule, right: VisitSchedule) {
  if (left.route_order != null || right.route_order != null) {
    if (left.route_order == null) return 1;
    if (right.route_order == null) return -1;
    if (left.route_order !== right.route_order) {
      return left.route_order - right.route_order;
    }
  }

  const leftTime = left.time_window_start ?? '';
  const rightTime = right.time_window_start ?? '';
  return leftTime.localeCompare(rightTime);
}

export function buildScheduleDayRouteMapPoints({
  routeMapSchedules,
  draftScheduleIds,
  manualDirty,
  selectedDate,
  routeDepartureTime,
  routePlanByScheduleId,
}: ScheduleDayRouteMapInput): ScheduleDayRouteMapPoint[] {
  const schedulesById = new Map(routeMapSchedules.map((schedule) => [schedule.id, schedule]));

  return draftScheduleIds
    .map((scheduleId, index) => {
      const schedule = schedulesById.get(scheduleId);
      const residence = schedule?.case_.patient.residences[0];
      if (!schedule || residence?.lat == null || residence.lng == null) return null;

      return {
        scheduleId,
        patientName: schedule.case_.patient.name,
        address: residence.address,
        lat: residence.lat,
        lng: residence.lng,
        orderLabel: String(index + 1),
        status: schedule.schedule_status,
        priority: schedule.priority,
        pointKind: 'schedule' as const,
        timeLabel: timeLabel(schedule.time_window_start, schedule.time_window_end),
        etaLabel: manualDirty
          ? null
          : formatEtaLabel(
              selectedDate,
              routeDepartureTime,
              routePlanByScheduleId.get(scheduleId)?.arrivalOffsetSeconds ?? null,
              schedule.time_window_start,
            ),
      };
    })
    .filter((point): point is ScheduleDayRouteMapPoint => point !== null);
}

export function buildScheduleDayRouteMapSite(
  routeMapSchedules: VisitSchedule[],
): ScheduleDayRouteMapSite | null {
  const site = routeMapSchedules[0]?.site;
  if (!site || site.lat == null || site.lng == null) return null;

  return {
    name: site.name,
    lat: site.lat,
    lng: site.lng,
  };
}

function buildScheduleDayGanttWindow(visibleSchedules: VisitSchedule[]): ScheduleDayGanttWindow {
  if (visibleSchedules.length === 0) {
    return {
      startMinutes: SCHEDULE_DAY_GANTT_DEFAULT_START_MINUTES,
      endMinutes: SCHEDULE_DAY_GANTT_DEFAULT_END_MINUTES,
    };
  }

  let earliest = SCHEDULE_DAY_GANTT_DEFAULT_END_MINUTES;
  let latest = SCHEDULE_DAY_GANTT_DEFAULT_START_MINUTES;

  for (const schedule of visibleSchedules) {
    const startMinutes = minutesFromTimestamp(
      schedule.time_window_start,
      SCHEDULE_DAY_GANTT_DEFAULT_START_MINUTES,
    );
    const endMinutes = minutesFromTimestamp(schedule.time_window_end, startMinutes + 60);
    earliest = Math.min(earliest, startMinutes);
    latest = Math.max(latest, endMinutes);
  }

  return {
    startMinutes: Math.max(
      6 * 60,
      roundDownToSlot(earliest - SCHEDULE_DAY_GANTT_SLOT_MINUTES, SCHEDULE_DAY_GANTT_SLOT_MINUTES),
    ),
    endMinutes: Math.min(
      22 * 60,
      roundUpToSlot(latest + SCHEDULE_DAY_GANTT_SLOT_MINUTES, SCHEDULE_DAY_GANTT_SLOT_MINUTES),
    ),
  };
}

function buildScheduleDayGanttSlots(window: ScheduleDayGanttWindow) {
  const slots: number[] = [];
  for (
    let minutes = window.startMinutes;
    minutes < window.endMinutes;
    minutes += SCHEDULE_DAY_GANTT_SLOT_MINUTES
  ) {
    slots.push(minutes);
  }
  return slots;
}

function buildScheduleDayGanttColumns(
  visibleSchedules: VisitSchedule[],
  pharmacistNameById: ReadonlyMap<string, string>,
  window: ScheduleDayGanttWindow,
): ScheduleDayGanttColumn[] {
  const columns = new Map<string, ScheduleDayGanttColumn>();

  for (const schedule of visibleSchedules) {
    const existing = columns.get(schedule.pharmacist_id) ?? {
      pharmacistId: schedule.pharmacist_id,
      pharmacistName: pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録',
      siteName: schedule.site?.name ?? null,
      schedules: [],
    };

    const blockStartMinutes = minutesFromTimestamp(schedule.time_window_start, window.startMinutes);
    const blockEndMinutes = Math.max(
      blockStartMinutes + SCHEDULE_DAY_GANTT_SLOT_MINUTES,
      minutesFromTimestamp(
        schedule.time_window_end,
        blockStartMinutes + SCHEDULE_DAY_GANTT_SLOT_MINUTES * 2,
      ),
    );

    existing.schedules.push({
      ...schedule,
      blockStartMinutes,
      blockEndMinutes,
    });
    columns.set(schedule.pharmacist_id, existing);
  }

  return Array.from(columns.values())
    .map((column) => ({
      ...column,
      schedules: column.schedules.sort((left, right) => {
        if (left.route_order != null || right.route_order != null) {
          if (left.route_order == null) return 1;
          if (right.route_order == null) return -1;
          if (left.route_order !== right.route_order) {
            return left.route_order - right.route_order;
          }
        }
        return left.blockStartMinutes - right.blockStartMinutes;
      }),
    }))
    .sort((left, right) => left.pharmacistName.localeCompare(right.pharmacistName, 'ja'));
}

function compareScheduleDayGanttSchedulesByStartThenRoute(
  left: ScheduleDayGanttSchedule,
  right: ScheduleDayGanttSchedule,
) {
  if (left.blockStartMinutes !== right.blockStartMinutes) {
    return left.blockStartMinutes - right.blockStartMinutes;
  }

  if (left.route_order != null || right.route_order != null) {
    if (left.route_order == null) return 1;
    if (right.route_order == null) return -1;
    if (left.route_order !== right.route_order) {
      return left.route_order - right.route_order;
    }
  }

  return left.id.localeCompare(right.id);
}

function buildScheduleDayGanttTableColumns(
  columns: ScheduleDayGanttColumn[],
  slots: number[],
  window: ScheduleDayGanttWindow,
): ScheduleDayGanttTableColumn[] {
  return columns.map((column) => {
    const scheduleStarts = new Map<number, ScheduleDayGanttTableCell>();
    const coveredSlots = new Set<number>();
    const schedulesByStart = [...column.schedules].sort(
      compareScheduleDayGanttSchedulesByStartThenRoute,
    );

    for (const schedule of schedulesByStart) {
      const startIndex = Math.max(
        0,
        Math.floor(
          (schedule.blockStartMinutes - window.startMinutes) / SCHEDULE_DAY_GANTT_SLOT_MINUTES,
        ),
      );
      const endIndex = Math.min(
        slots.length,
        Math.max(
          startIndex + 1,
          Math.ceil(
            (schedule.blockEndMinutes - window.startMinutes) / SCHEDULE_DAY_GANTT_SLOT_MINUTES,
          ),
        ),
      );
      const span = Math.max(1, endIndex - startIndex);

      const overlappingEntry = Array.from(scheduleStarts.entries()).find(
        ([cellStartIndex, cell]) => {
          const cellEndIndex = cellStartIndex + cell.span;
          return startIndex < cellEndIndex && cellStartIndex < endIndex;
        },
      );

      if (overlappingEntry) {
        const [cellStartIndex, existingCell] = overlappingEntry;
        const nextSpan = Math.max(existingCell.span, endIndex - cellStartIndex);
        const schedules = [...existingCell.schedules, schedule].sort(
          compareScheduleDayGanttSchedulesByStartThenRoute,
        );
        const overlapKind =
          existingCell.overlapKind === 'overlap' || startIndex !== cellStartIndex
            ? 'overlap'
            : 'same_start';

        scheduleStarts.set(cellStartIndex, {
          ...existingCell,
          schedule: schedules[0] ?? existingCell.schedule,
          schedules,
          span: nextSpan,
          overlapKind,
        });
        for (let index = cellStartIndex + 1; index < cellStartIndex + nextSpan; index += 1) {
          coveredSlots.add(index);
        }
        continue;
      }

      const scheduleCell = { schedule, schedules: [schedule], span, overlapKind: null };

      scheduleStarts.set(startIndex, scheduleCell);
      for (let index = startIndex + 1; index < startIndex + scheduleCell.span; index += 1) {
        coveredSlots.add(index);
      }
    }

    return {
      ...column,
      scheduleStarts,
      coveredSlots,
    };
  });
}

export function buildScheduleDayGanttViewModel({
  visibleSchedules,
  pharmacistNameById,
}: ScheduleDayGanttInput): ScheduleDayGanttViewModel {
  const window = buildScheduleDayGanttWindow(visibleSchedules);
  const slots = buildScheduleDayGanttSlots(window);
  const columns = buildScheduleDayGanttColumns(visibleSchedules, pharmacistNameById, window);
  const tableColumns = buildScheduleDayGanttTableColumns(columns, slots, window);

  return {
    window,
    slots,
    columns,
    tableColumns,
  };
}

export function buildScheduleDayViewModel({
  schedules,
  selectedDate,
  facilityFilter,
  pharmacistNameById,
  selectedRoutePharmacistId,
}: ScheduleDayViewModelInput): ScheduleDayViewModel {
  const selectedDateSchedules = schedules
    .filter((schedule) => toDateKey(schedule.scheduled_date) === selectedDate)
    .sort((left, right) => {
      const leftTime = left.time_window_start ?? '';
      const rightTime = right.time_window_start ?? '';
      return leftTime.localeCompare(rightTime);
    });
  const facilityTracker = buildFacilityTracker(selectedDateSchedules);
  const facilityRouteDefaults = buildFacilityRouteDefaults(facilityTracker);
  const activeFacilityFilter =
    facilityFilter && facilityTracker.some((group) => group.key === facilityFilter)
      ? facilityFilter
      : null;
  const visibleSchedules = activeFacilityFilter
    ? selectedDateSchedules.filter(
        (schedule) => getFacilityTrackerGrouping(schedule)?.key === activeFacilityFilter,
      )
    : selectedDateSchedules;
  const mobileVisitSchedules = [...visibleSchedules].sort(compareSchedulesByRouteOrderThenTime);
  const mobileFacilityGroups = activeFacilityFilter
    ? facilityTracker.filter((group) => group.key === activeFacilityFilter)
    : facilityTracker;
  const routePharmacistOptions = Array.from(
    new Map(
      visibleSchedules.map((schedule) => [
        schedule.pharmacist_id,
        {
          id: schedule.pharmacist_id,
          name: pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録',
          siteName: schedule.site?.name ?? null,
        },
      ]),
    ).values(),
  );
  const resolvedRoutePharmacistId = routePharmacistOptions.some(
    (option) => option.id === selectedRoutePharmacistId,
  )
    ? selectedRoutePharmacistId
    : (routePharmacistOptions[0]?.id ?? '');
  const routeMapSchedules = visibleSchedules.filter(
    (schedule) => schedule.pharmacist_id === resolvedRoutePharmacistId,
  );
  const currentOrderedRouteScheduleIds = [...routeMapSchedules]
    .sort(compareSchedulesByRouteOrderThenTime)
    .map((schedule) => schedule.id);
  const routeDepartureTime =
    routeMapSchedules
      .map((schedule) => schedule.time_window_start)
      .find((value): value is string => Boolean(value)) ?? null;
  const selectedRoutePharmacist = routePharmacistOptions.find(
    (option) => option.id === resolvedRoutePharmacistId,
  );
  const routeSelectionLabel = selectedRoutePharmacist
    ? `${selectedRoutePharmacist.name} / ${selectedDate}`
    : null;

  return {
    selectedDateSchedules,
    facilityTracker,
    facilityRouteDefaults,
    activeFacilityFilter,
    visibleSchedules,
    mobileVisitSchedules,
    mobileFacilityGroups,
    routePharmacistOptions,
    resolvedRoutePharmacistId,
    routeMapSchedules,
    currentOrderedRouteScheduleIds,
    routeDepartureTime,
    routeSelectionLabel,
  };
}
