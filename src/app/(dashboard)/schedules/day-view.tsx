'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, eachDayOfInterval, endOfWeek, format, parseISO, startOfWeek } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Car,
  CheckCircle2,
  Navigation,
  PlayCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { HomeCareFeatureHighlights } from '@/components/home-care/home-care-feature-board';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { OFFLINE_CACHE_TTL_HOURS } from '@/lib/offline/cache-policy';
import { offlineDb } from '@/lib/stores/offline-db';
import { useOfflineStore } from '@/lib/stores/offline-store';
import {
  createFacilityVisitRecordHref,
  type FacilityVisitContext,
} from '@/lib/visits/facility-visit-context';
import { extractConferenceProposalOrigin } from '@/lib/visits/visit-workflow-projection';
import { type CachedVisitBriefCard } from '@/lib/visits/visit-brief-cache';
import {
  discardSyncQueueItem,
  overwriteVisitRecordConflict,
  processSyncQueue,
  setupAutoSync,
} from '@/lib/stores/sync-engine';
import { cn } from '@/lib/utils';
import { VisitCardMobile } from '@/components/features/visits/visit-card-mobile';
import { FacilityPatientSwipeRail } from '@/components/features/visits/facility-patient-swipe-rail';
import { VISIT_ROUTE_TRAVEL_MODE_LABELS } from '@/components/features/visits/visit-route-shared';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { moveRouteItem, useRouteOrderDraft } from './route-order-draft';
import {
  handleScheduleDayFacilityBatchSuccess,
  saveScheduleDayFacilityBatch,
} from './schedule-day-facility-batch';
import {
  handleScheduleDayFacilityVisitDaySuccess,
  saveScheduleDayFacilityVisitDay,
} from './schedule-day-facility-visit-day';
import {
  generateScheduleDayRescheduleProposals,
  handleScheduleDayRescheduleSuccess,
} from './schedule-day-reschedule';
import { ScheduleDayOfflinePanel } from './schedule-day-offline-panel';
import { ScheduleDayOperationalTasksPanel } from './schedule-day-operational-tasks-panel';
import {
  buildScheduleDayRescheduleApprovalTargetFromProposal,
  buildScheduleDayRescheduleApprovalTargetFromSchedule,
  ScheduleDayRescheduleApprovalDialog,
  type ScheduleDayRescheduleApprovalTarget,
} from './schedule-day-reschedule-approval-dialog';
import { ScheduleDayRoutePreview } from './schedule-day-route-preview';
import {
  applyScheduleDayRouteOrderDraft,
  handleScheduleDayRouteOrderApplySuccess,
} from './schedule-day-route-order-apply';
import {
  applyScheduleDayPlannerBillingRecommendations,
  applyScheduleDayPlannerCaseSelection,
  applyScheduleDayPlannerCandidateCount,
  applyScheduleDayPlannerPreferredTimeFrom,
  applyScheduleDayPlannerPreferredTimeTo,
  applyScheduleDayPlannerPriority,
  applyScheduleDayPlannerStartDate,
  applyScheduleDayPlannerVehicleResourceSelection,
  applyScheduleDayPlannerVisitType,
  buildScheduleDaySelectedDateProposals,
  filterScheduleDayPlannerCases,
  generateScheduleDayProposals,
  getDefaultScheduleDayPlannerForm,
  getScheduleDayEffectivePlannerCandidateCount,
  handleScheduleDayProposalGenerationSuccess,
  resolveScheduleDayPlannerVehicleRouteTravelMode,
  type ScheduleDayRouteTravelMode,
} from './schedule-day-planner';
import { useScheduleDayPlannerQueries } from './schedule-day-planner-hooks';
import { ProposalHumanDecisionFlow } from './proposal-human-decision-flow';
import { buildOrderedFacilityScheduleIds, formatMinutesLabel } from './calendar-view.helpers';
import { fetchVisitSchedulesWindow } from './visit-schedule-fetch.helpers';
import {
  buildScheduleDayContactAttemptRequest,
  closeScheduleDayContactLogDialog,
  getDefaultScheduleDayContactLogForm,
  handleScheduleDayProposalActionSuccess,
  openScheduleDayContactLogDialog,
  updateScheduleDayProposalAction,
  type ScheduleDayContactLogForm,
  type ScheduleDayProposalActionRequest,
} from './schedule-day-proposal-action';
import {
  PREPARATION_PACK_MISSING_MESSAGE,
  PREPARATION_ITEM_DESCRIPTIONS,
  buildScheduleDayPreparationClinicalViewModel,
  buildScheduleDayPreparationForm,
  buildScheduleDayPreparationReadiness,
  fetchScheduleDayPreparationDetails,
  getPreparationPackIdentityError,
  handleScheduleDayPreparationSuccess,
  saveScheduleDayPreparation,
  type ScheduleDayPreparationDetailsState,
  type ScheduleDayPreparationForm,
} from './schedule-day-preparation';
import {
  addressOfPatient,
  CONTACT_STATUS_LABELS,
  countCompletedPreparationItems,
  PREPARATION_ITEMS,
  PRIORITY_LABELS,
  priorityBadgeClass,
  readImpactCount,
  readImpactedPatientNames,
  PROPOSAL_STATUS_LABELS,
  SCHEDULE_STATUS_LABELS,
  SCHEDULING_TASK_TYPES,
  statusBadgeClass,
  timeLabel,
  toDateKey,
  type CaseOption,
  type Pharmacist,
  type Proposal,
  type ScheduleTask,
  type ScheduleTaskStatus,
  type VisitPriority,
  type VisitVehicleResourceSummary,
  type VisitSchedule,
  type VisitType,
  type VisitScheduleBillingPreview,
  VISIT_TYPE_LABELS,
} from './day-view.shared';
import { OnboardingWarningBadges, ScheduleBoardSkeleton } from './schedule-day-view.chrome';
import {
  buildProposalBillingPreviewRequests,
  buildScheduleDayGanttViewModel,
  buildScheduleDayOfflineStatus,
  buildScheduleDayRouteMapPoints,
  buildScheduleDayRouteMapSite,
  buildScheduleDayViewModel,
  buildScheduleBillingPreviewRequests,
  buildWeekProposalStats,
  canBulkConfirmFacilityCarryItems,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  formatFacilityCarryItemsStatus,
  type FacilityTrackerGroup,
  type ScheduleDayVisitBriefCacheStatus,
  canOverrideDepartureCarryWarning,
  getFacilityTrackerGrouping,
  getDepartureCarryWarning,
  getUnsafeFacilityCarryPatients,
  proposalLockText,
  scheduleLockText,
  splitTrace,
} from './schedule-day-view.helpers';
import {
  RelatedManagementLinks,
  RouteBoardSummary,
  ScheduleBoardMetrics,
  WeeklyScheduleControls,
} from './schedule-day-view.sections';
import {
  createScheduleDayVisitBriefCacheRepository,
  fetchMissingScheduleDayVisitBriefCards,
  mergeScheduleDayCachedVisitBriefCards,
  readScheduleDayCachedVisitBriefs,
  saveScheduleDayVisitBriefCards,
} from './schedule-day-visit-brief-cache';

type RouteTravelMode = ScheduleDayRouteTravelMode;

type VisitRoutePlan = {
  status: 'ok' | 'unavailable';
  note: string | null;
  travelMode: RouteTravelMode;
  origin: {
    lat: number;
    lng: number;
    label: string;
  } | null;
  encodedPath: string | null;
  orderedScheduleIds: string[];
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  stopSummaries: Array<{
    scheduleId: string;
    optimizedOrder: number;
    arrivalOffsetSeconds: number | null;
    distanceFromPreviousMeters: number | null;
    durationFromPreviousSeconds: number | null;
  }>;
};

const AUTO_VEHICLE_RESOURCE_VALUE = '__auto_vehicle_resource__';

const FACILITY_VISIT_DAY_WEEKDAY_OPTIONS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

function formatVehicleResourceLabel(vehicle: VisitVehicleResourceSummary | null | undefined) {
  if (!vehicle) return '自動割当';
  const constraints = [
    vehicle.max_stops != null ? `最大${vehicle.max_stops}件` : null,
    vehicle.max_route_duration_minutes != null
      ? `${vehicle.max_route_duration_minutes}分以内`
      : null,
  ].filter((category): category is string => category !== null);
  return constraints.length > 0 ? `${vehicle.label} (${constraints.join(' / ')})` : vehicle.label;
}

function visitStartActionText(schedule: Pick<VisitSchedule, 'carry_items_status'>) {
  if (!getDepartureCarryWarning(schedule)) return '訪問開始';
  return canOverrideDepartureCarryWarning(schedule)
    ? '警告を確認して訪問開始'
    : '持参物未確定を確認';
}

function conferenceContextLabel(noteType: 'pre_discharge' | 'service_manager') {
  return noteType === 'pre_discharge' ? '退院前カンファ' : '担当者会議';
}

type ScheduleDayViewProps = {
  initialSelectedDate?: string;
  initialTab?: 'proposals' | 'confirmed';
  highlightedScheduleId?: string;
};

type ProposalConfirmAction = {
  proposal: Proposal;
  action: 'approve' | 'confirm';
};

function proposalConfirmActionLabel(action: ProposalConfirmAction['action']) {
  return action === 'approve' ? '承認して架電へ進める' : '日時確定する';
}

function proposalConfirmResultLabel(action: ProposalConfirmAction['action']) {
  return action === 'approve' ? '患者連絡待ち' : '訪問予定確定';
}

function canExecuteProposalConfirmAction(action: ProposalConfirmAction) {
  if (action.action === 'approve') {
    return ['proposed', 'reschedule_pending'].includes(action.proposal.proposal_status);
  }

  return (
    action.proposal.proposal_status === 'patient_contact_pending' &&
    action.proposal.patient_contact_status === 'confirmed'
  );
}

function shortEntityIdentifier(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return '未設定';
  return candidate.length <= 8 ? candidate : candidate.slice(-8);
}

function proposalSafeIdentifierLabel(proposal: Pick<Proposal, 'case_id' | 'id'>) {
  return `ケース ${shortEntityIdentifier(proposal.case_id)} / 候補 ${shortEntityIdentifier(proposal.id)}`;
}

export function ScheduleDayView({
  initialSelectedDate,
  initialTab = 'confirmed',
  highlightedScheduleId,
}: ScheduleDayViewProps = {}) {
  const router = useRouter();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();
  const [plannerCandidateCountManual, setPlannerCandidateCountManual] = useState(false);
  const initialScheduleDate = initialSelectedDate ?? format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(() => initialScheduleDate);
  const [plannerForm, setPlannerForm] = useState(() =>
    getDefaultScheduleDayPlannerForm(initialScheduleDate),
  );
  function selectScheduleDate(dateKey: string) {
    setPlannerForm((current) =>
      current.start_date === selectedDate
        ? applyScheduleDayPlannerStartDate(current, dateKey)
        : current,
    );
    setSelectedDate(dateKey);
  }
  const [rescheduleTarget, setRescheduleTarget] = useState<VisitSchedule | null>(null);
  const [rescheduleApprovalTarget, setRescheduleApprovalTarget] =
    useState<ScheduleDayRescheduleApprovalTarget | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    reason: '',
    reason_code: 'other' as
      | 'emergency_insert'
      | 'pharmacist_unavailable'
      | 'patient_request'
      | 'facility_request'
      | 'weather'
      | 'other',
    communication_channel: 'phone' as 'phone' | 'fax' | 'email' | 'collaboration' | 'in_person',
    communication_result: 'pending' as 'pending' | 'sent' | 'verbal_notified',
    start_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    priority: 'normal' as VisitPriority,
  });
  const [contactLogTarget, setContactLogTarget] = useState<Proposal | null>(null);
  const [proposalConfirmAction, setProposalConfirmAction] = useState<ProposalConfirmAction | null>(
    null,
  );
  const [contactLogForm, setContactLogForm] = useState<ScheduleDayContactLogForm>(() =>
    getDefaultScheduleDayContactLogForm(),
  );
  const [preparationTarget, setPreparationTarget] = useState<VisitSchedule | null>(null);
  const [departureWarningTarget, setDepartureWarningTarget] = useState<VisitSchedule | null>(null);
  const [departureWarningAcknowledged, setDepartureWarningAcknowledged] = useState(false);
  const [preparationDetails, setPreparationDetails] =
    useState<ScheduleDayPreparationDetailsState | null>(null);
  const [preparationLoading, setPreparationLoading] = useState(false);
  const [preparationForm, setPreparationForm] = useState<ScheduleDayPreparationForm>(() =>
    buildScheduleDayPreparationForm(null),
  );
  const [facilityFilter, setFacilityFilter] = useState<string | null>(null);
  const [facilityRouteOverrides, setFacilityRouteOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const [draggingFacilityPatient, setDraggingFacilityPatient] = useState<{
    groupKey: string;
    scheduleId: string;
  } | null>(null);
  const [facilityRouteAnnouncement, setFacilityRouteAnnouncement] = useState('');
  const [facilityVisitDayTarget, setFacilityVisitDayTarget] = useState<{
    key: string;
    label: string;
    scheduleIds: string[];
    patientNames: string[];
  } | null>(null);
  const [facilityCarryConfirmTarget, setFacilityCarryConfirmTarget] =
    useState<FacilityTrackerGroup | null>(null);
  const [facilityVisitDayForm, setFacilityVisitDayForm] = useState({
    preferred_weekdays: [] as number[],
    preferred_time_from: '',
    preferred_time_to: '',
    facility_time_from: '',
    facility_time_to: '',
    visit_buffer_minutes: '',
    notes: '',
  });
  const [cachedVisitBriefs, setCachedVisitBriefs] = useState<CachedVisitBriefCard[]>([]);
  const [cachedVisitBriefLoadedDate, setCachedVisitBriefLoadedDate] = useState<string | null>(null);
  const [cachedVisitBriefUpdatedAt, setCachedVisitBriefUpdatedAt] = useState<string | null>(null);
  const [cachedVisitBriefStatus, setCachedVisitBriefStatus] =
    useState<ScheduleDayVisitBriefCacheStatus>('ready');
  const [mobileVisitSurface, setMobileVisitSurface] = useState<'list' | 'map'>('list');
  const [selectedRoutePharmacistId, setSelectedRoutePharmacistId] = useState('');
  const [routePreviewTravelMode, setRoutePreviewTravelMode] = useState<RouteTravelMode>('DRIVE');
  const [plannerRouteTravelMode, setPlannerRouteTravelMode] = useState<RouteTravelMode>('DRIVE');
  const [routeOrderConfirmOpen, setRouteOrderConfirmOpen] = useState(false);
  const preparationRequestSeqRef = useRef(0);
  const preparationFormDirtyRef = useRef(false);
  const isOffline = useOfflineStore((state) => state.isOffline);
  const pendingSyncCount = useOfflineStore((state) => state.pendingSyncCount);
  const syncConflicts = useOfflineStore((state) => state.syncConflicts);
  const syncOnlineStatus = useOfflineStore((state) => state.syncOnlineStatus);
  const refreshSyncState = useOfflineStore((state) => state.refreshSyncState);
  const visitBriefCacheRepository = useMemo(
    () => createScheduleDayVisitBriefCacheRepository(offlineDb.visitBriefCache),
    [],
  );

  const selectedDay = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const weekStart = useMemo(() => startOfWeek(selectedDay, { weekStartsOn: 1 }), [selectedDay]);
  const weekEnd = useMemo(() => endOfWeek(selectedDay, { weekStartsOn: 1 }), [selectedDay]);
  const visibleDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekEnd, weekStart],
  );

  const { data: casesData, isLoading: casesLoading } = useQuery({
    queryKey: ['cases', 'schedule-planner', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      const res = await fetch(`/api/cases?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ケースの取得に失敗しました');
      return res.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId,
  });

  const { data: pharmacistsData, isLoading: pharmacistsLoading } = useQuery({
    queryKey: ['pharmacists', orgId, 'schedule-board'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{ data: Pharmacist[] }>;
    },
    enabled: !!orgId,
  });

  const { data: proposalsData, isLoading: proposalsLoading } = useRealtimeQuery({
    queryKey: [
      'visit-schedule-proposals',
      orgId,
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: format(weekStart, 'yyyy-MM-dd'),
        date_to: format(weekEnd, 'yyyy-MM-dd'),
      });
      const res = await fetch(`/api/visit-schedule-proposals?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問候補の取得に失敗しました');
      return res.json() as Promise<{ data: Proposal[] }>;
    },
    enabled: !!orgId,
    invalidateOn: ['workflow_refresh'],
  });

  const { data: schedulesData, isLoading: schedulesLoading } = useRealtimeQuery({
    queryKey: [
      'visit-schedules',
      'week-board',
      orgId,
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const data = await fetchVisitSchedulesWindow<VisitSchedule>({
        orgId,
        dateFrom: format(weekStart, 'yyyy-MM-dd'),
        dateTo: format(weekEnd, 'yyyy-MM-dd'),
      });
      return { data };
    },
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    invalidateOn: ['workflow_refresh'],
  });

  const { data: tasksData, isLoading: tasksLoading } = useRealtimeQuery({
    queryKey: ['tasks', 'schedule-board', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'pending' });
      const res = await fetch(`/api/tasks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('運用タスクの取得に失敗しました');
      return res.json() as Promise<{ data: ScheduleTask[] }>;
    },
    enabled: !!orgId,
    invalidateOn: ['workflow_refresh'],
  });

  const { data: callbackTasksData, isLoading: callbackTasksLoading } = useRealtimeQuery({
    queryKey: ['tasks', 'visit-contact-followup', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({
        task_type: 'visit_contact_followup',
      });
      const res = await fetch(`/api/tasks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('再架電タスクの取得に失敗しました');
      return res.json() as Promise<{ data: ScheduleTask[] }>;
    },
    enabled: !!orgId,
    invalidateOn: ['workflow_refresh'],
  });

  const cases = useMemo(() => filterScheduleDayPlannerCases(casesData?.data ?? []), [casesData]);
  const pharmacists = useMemo(() => pharmacistsData?.data ?? [], [pharmacistsData]);
  const proposals = useMemo(() => proposalsData?.data ?? [], [proposalsData]);
  const schedules = useMemo(() => schedulesData?.data ?? [], [schedulesData]);
  const tasks = useMemo(() => tasksData?.data ?? [], [tasksData]);
  const callbackTasks = useMemo(
    () =>
      (callbackTasksData?.data ?? []).filter((task) =>
        ['pending', 'in_progress'].includes(task.status),
      ),
    [callbackTasksData],
  );
  const {
    pharmacistNameById,
    resolvedPlannerCaseId,
    selectedCase,
    selectedPlannerSiteId,
    vehicleResourcesLoading,
    vehicleResourcesEnabled,
    plannerVehicleResources,
    selectedPlannerVehicle,
    billingPreviewData,
    billingPreviewLoading,
  } = useScheduleDayPlannerQueries({
    orgId,
    plannerForm,
    cases,
    pharmacists,
  });
  const proposalById = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal])),
    [proposals],
  );
  const scheduleById = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules],
  );
  const billingCadence = billingPreviewData?.cadence ?? null;
  const billingAlerts = billingPreviewData?.alerts ?? [];
  const billingPreviewWarnings = billingPreviewData?.warnings ?? [];
  const billedDateSet = useMemo(
    () => new Set(billingCadence?.scheduled_dates_current_month ?? []),
    [billingCadence],
  );
  const suggestedDateSet = useMemo(
    () => new Set(billingCadence?.suggested_dates ?? []),
    [billingCadence],
  );
  const selectedDateProposals = useMemo(
    () => buildScheduleDaySelectedDateProposals(proposals, selectedDate),
    [proposals, selectedDate],
  );
  const currentProposalConfirmAction = useMemo(() => {
    if (!proposalConfirmAction) return null;

    const currentProposal =
      selectedDateProposals.find((proposal) => proposal.id === proposalConfirmAction.proposal.id) ??
      proposalConfirmAction.proposal;

    return currentProposal === proposalConfirmAction.proposal
      ? proposalConfirmAction
      : { ...proposalConfirmAction, proposal: currentProposal };
  }, [proposalConfirmAction, selectedDateProposals]);
  const proposalConfirmTargetCurrent = proposalConfirmAction
    ? selectedDateProposals.some((proposal) => proposal.id === proposalConfirmAction.proposal.id)
    : false;
  const proposalConfirmActionExecutable = currentProposalConfirmAction
    ? proposalConfirmTargetCurrent && canExecuteProposalConfirmAction(currentProposalConfirmAction)
    : false;
  const proposalPreviewRequests = useMemo(
    () => buildProposalBillingPreviewRequests(selectedDateProposals),
    [selectedDateProposals],
  );
  const { data: proposalBillingPreviewMap } = useQuery({
    queryKey: ['proposal-billing-preview-map', orgId, proposalPreviewRequests],
    queryFn: async () => {
      const res = await fetch('/api/visit-schedule-proposals/billing-preview-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          items: proposalPreviewRequests.map((item) => ({
            key: item.proposalId,
            case_id: item.caseId,
            proposed_date: item.proposedDate,
            pharmacist_id: item.pharmacistId,
            site_id: item.siteId,
            visit_type: item.visitType,
          })),
        }),
      });
      if (!res.ok) throw new Error('提案の算定プレビュー取得に失敗しました');
      const payload = (await res.json()) as {
        data: Record<string, VisitScheduleBillingPreview>;
      };
      return new Map(Object.entries(payload.data));
    },
    enabled: !!orgId && proposalPreviewRequests.length > 0,
  });
  const schedulingTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            SCHEDULING_TASK_TYPES.has(task.task_type) &&
            task.task_type !== 'visit_contact_followup',
        )
        .slice(0, 6),
    [tasks],
  );

  const weekProposalStats = useMemo(
    () => buildWeekProposalStats(proposals, schedules),
    [proposals, schedules],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    syncOnlineStatus();
    window.addEventListener('online', syncOnlineStatus);
    window.addEventListener('offline', syncOnlineStatus);

    return () => {
      window.removeEventListener('online', syncOnlineStatus);
      window.removeEventListener('offline', syncOnlineStatus);
    };
  }, [syncOnlineStatus]);

  useEffect(() => {
    if (!orgId || typeof window === 'undefined') return;

    const teardown = setupAutoSync({
      orgId,
      endpoints: {
        visit_record: '/api/visit-records',
      },
    });
    const initialTimer = window.setTimeout(() => {
      void refreshSyncState();
    }, 0);
    const timer = window.setInterval(() => {
      void refreshSyncState();
    }, 5000);

    return () => {
      teardown();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [orgId, refreshSyncState]);

  const {
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
  } = useMemo(
    () =>
      buildScheduleDayViewModel({
        schedules,
        selectedDate,
        facilityFilter,
        pharmacistNameById,
        selectedRoutePharmacistId,
      }),
    [facilityFilter, pharmacistNameById, schedules, selectedDate, selectedRoutePharmacistId],
  );
  const effectivePlannerCandidateCount = getScheduleDayEffectivePlannerCandidateCount({
    plannerForm,
    billingPreview: billingPreviewLoading ? null : billingPreviewData,
    isManual: plannerCandidateCountManual,
  });
  const hasInvalidPlannerVehicleSelection = Boolean(
    plannerForm.vehicle_resource_id && !selectedPlannerVehicle,
  );
  const plannerGenerationBlockedByPreviewOrVehicle =
    billingPreviewLoading || hasInvalidPlannerVehicleSelection;
  const plannerVehicleSelectValue = selectedPlannerVehicle
    ? plannerForm.vehicle_resource_id
    : AUTO_VEHICLE_RESOURCE_VALUE;
  const schedulePreviewRequests = useMemo(
    () => buildScheduleBillingPreviewRequests(selectedDateSchedules),
    [selectedDateSchedules],
  );
  const { data: scheduleBillingPreviewMap } = useQuery({
    queryKey: ['schedule-billing-preview-map', orgId, schedulePreviewRequests],
    queryFn: async () => {
      const res = await fetch('/api/visit-schedule-proposals/billing-preview-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          items: schedulePreviewRequests.map((item) => ({
            key: item.scheduleId,
            case_id: item.caseId,
            proposed_date: item.proposedDate,
            pharmacist_id: item.pharmacistId,
            site_id: item.siteId,
            visit_type: item.visitType,
          })),
        }),
      });
      if (!res.ok) throw new Error('確定予定の算定プレビュー取得に失敗しました');
      const payload = (await res.json()) as {
        data: Record<string, VisitScheduleBillingPreview>;
      };
      return new Map(Object.entries(payload.data));
    },
    enabled: !!orgId && schedulePreviewRequests.length > 0,
  });
  const isScheduleBoardLoading =
    isBootstrappingOrg ||
    ((casesLoading ||
      pharmacistsLoading ||
      proposalsLoading ||
      schedulesLoading ||
      tasksLoading ||
      callbackTasksLoading) &&
      !casesData &&
      !pharmacistsData &&
      !proposalsData &&
      !schedulesData &&
      !tasksData &&
      !callbackTasksData);
  function getFacilityRouteDraft(group: FacilityTrackerGroup) {
    return {
      ...(facilityRouteDefaults[group.key] ?? {}),
      ...(facilityRouteOverrides[group.key] ?? {}),
    };
  }

  function setFacilityPatientOrder(groupKey: string, orderedScheduleIds: string[]) {
    setFacilityRouteOverrides((prev) => ({
      ...prev,
      [groupKey]: Object.fromEntries(
        orderedScheduleIds.map((scheduleId, index) => [scheduleId, String(index + 1)]),
      ),
    }));
  }

  function announceFacilityPatientPosition(
    group: FacilityTrackerGroup,
    scheduleId: string,
    orderedScheduleIds: string[],
  ) {
    const patient = group.patients.find((candidate) => candidate.scheduleId === scheduleId);
    const nextIndex = orderedScheduleIds.indexOf(scheduleId);
    if (!patient || nextIndex === -1) return;
    setFacilityRouteAnnouncement(
      `${group.label} ${patient.patientName}を${nextIndex + 1} / ${orderedScheduleIds.length}番目に移動しました`,
    );
  }

  function getOrderedFacilityPatients(group: FacilityTrackerGroup) {
    const patientsByScheduleId = new Map(
      group.patients.map((patient) => [patient.scheduleId, patient]),
    );
    return buildOrderedFacilityScheduleIds(group, getFacilityRouteDraft(group))
      .map((scheduleId) => patientsByScheduleId.get(scheduleId))
      .filter((patient): patient is FacilityTrackerGroup['patients'][number] => Boolean(patient));
  }

  function reorderFacilityPatients(
    group: FacilityTrackerGroup,
    draggedScheduleId: string,
    targetScheduleId: string,
  ) {
    const routeDraft = getFacilityRouteDraft(group);
    const orderedScheduleIds = buildOrderedFacilityScheduleIds(group, routeDraft);
    const draggedIndex = orderedScheduleIds.indexOf(draggedScheduleId);
    const targetIndex = orderedScheduleIds.indexOf(targetScheduleId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return;
    }

    const nextOrdered = [...orderedScheduleIds];
    const [moved] = nextOrdered.splice(draggedIndex, 1);
    nextOrdered.splice(targetIndex, 0, moved);

    setFacilityPatientOrder(group.key, nextOrdered);
    announceFacilityPatientPosition(group, draggedScheduleId, nextOrdered);
  }

  function moveFacilityPatient(
    group: FacilityTrackerGroup,
    scheduleId: string,
    direction: 'up' | 'down',
  ) {
    const orderedScheduleIds = buildOrderedFacilityScheduleIds(group, getFacilityRouteDraft(group));
    const nextOrdered = moveRouteItem(orderedScheduleIds, scheduleId, direction);
    if (nextOrdered === orderedScheduleIds) return;
    setFacilityPatientOrder(group.key, nextOrdered);
    announceFacilityPatientPosition(group, scheduleId, nextOrdered);
  }

  function facilityCarryConfirmBlocked(group: FacilityTrackerGroup | null) {
    return getUnsafeFacilityCarryPatients(group).length > 0;
  }

  const selectedDateSchedulePatientIdByScheduleId = useMemo(
    () =>
      new Map(
        selectedDateSchedules.map((schedule) => [schedule.id, schedule.case_.patient.id] as const),
      ),
    [selectedDateSchedules],
  );
  const visibleCachedVisitBriefs = useMemo(() => {
    if (cachedVisitBriefLoadedDate !== selectedDate) return [];
    return cachedVisitBriefs.filter(
      (item) => selectedDateSchedulePatientIdByScheduleId.get(item.scheduleId) === item.patientId,
    );
  }, [
    cachedVisitBriefLoadedDate,
    cachedVisitBriefs,
    selectedDate,
    selectedDateSchedulePatientIdByScheduleId,
  ]);
  const visibleCachedVisitBriefUpdatedAt =
    cachedVisitBriefLoadedDate === selectedDate ? cachedVisitBriefUpdatedAt : null;
  const cachedVisitBriefByScheduleId = useMemo(
    () => new Map(visibleCachedVisitBriefs.map((item) => [item.scheduleId, item])),
    [visibleCachedVisitBriefs],
  );
  const offlineStatus = useMemo(
    () =>
      buildScheduleDayOfflineStatus({
        isOffline,
        pendingSyncCount,
        syncConflictCount: syncConflicts.length,
        cachedVisitBriefCount: visibleCachedVisitBriefs.length,
        selectedDateScheduleCount: selectedDateSchedules.length,
        cachedVisitBriefUpdatedAt: visibleCachedVisitBriefUpdatedAt,
        visitBriefCacheStatus: cachedVisitBriefStatus,
        cacheTtlHours: OFFLINE_CACHE_TTL_HOURS,
      }),
    [
      cachedVisitBriefStatus,
      isOffline,
      pendingSyncCount,
      selectedDateSchedules.length,
      syncConflicts.length,
      visibleCachedVisitBriefUpdatedAt,
      visibleCachedVisitBriefs.length,
    ],
  );

  function createVisitRecordHref(schedule: VisitSchedule) {
    const groupKey = getFacilityTrackerGrouping(schedule)?.key;
    if (!groupKey) return `/visits/${schedule.id}/record`;

    const group = facilityTracker.find((candidate) => candidate.key === groupKey);
    if (!group || group.patients.length < 2) return `/visits/${schedule.id}/record`;

    const context: FacilityVisitContext = {
      label: group.label,
      siteName: group.siteName,
      patients: group.patients,
    };

    return createFacilityVisitRecordHref(schedule.id, context);
  }

  function handleVisitStart(schedule: VisitSchedule) {
    if (getDepartureCarryWarning(schedule)) {
      setDepartureWarningAcknowledged(false);
      setDepartureWarningTarget(schedule);
      return;
    }

    router.push(createVisitRecordHref(schedule));
  }

  function handleVisitComplete(schedule: VisitSchedule) {
    router.push(createVisitRecordHref(schedule));
  }

  const { data: routePlanData, isFetching: routePlanLoading } = useQuery({
    queryKey: [
      'visit-route-plan',
      orgId,
      selectedDate,
      resolvedRoutePharmacistId,
      routePreviewTravelMode,
      currentOrderedRouteScheduleIds.join(','),
    ],
    queryFn: async () => {
      const res = await fetch('/api/visit-routes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          schedule_ids: currentOrderedRouteScheduleIds,
          travel_mode: routePreviewTravelMode,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'ルート最適化の取得に失敗しました');
      }
      return (res.json() as Promise<{ data: VisitRoutePlan }>).then(
        (payload) => payload.data ?? null,
      );
    },
    enabled: !!orgId && !!resolvedRoutePharmacistId && currentOrderedRouteScheduleIds.length > 0,
  });
  const routePlanByScheduleId = useMemo(
    () => new Map((routePlanData?.stopSummaries ?? []).map((item) => [item.scheduleId, item])),
    [routePlanData],
  );
  const routeOrderDraft = useRouteOrderDraft({
    sourceKey: `${selectedDate}:${resolvedRoutePharmacistId}:${routePreviewTravelMode}:${routePlanData?.orderedScheduleIds.join(',') ?? ''}:${currentOrderedRouteScheduleIds.join(',')}`,
    optimizedIds: routePlanData?.orderedScheduleIds ?? currentOrderedRouteScheduleIds,
    currentIds: currentOrderedRouteScheduleIds,
  });
  const routeMapPoints = useMemo(
    () =>
      buildScheduleDayRouteMapPoints({
        routeMapSchedules,
        draftScheduleIds: routeOrderDraft.draftIds,
        manualDirty: routeOrderDraft.manualDirty,
        selectedDate,
        routeDepartureTime,
        routePlanByScheduleId,
      }),
    [
      routeMapSchedules,
      routeOrderDraft.draftIds,
      routeOrderDraft.manualDirty,
      routeDepartureTime,
      routePlanByScheduleId,
      selectedDate,
    ],
  );
  const routeMapSite = useMemo(
    () => buildScheduleDayRouteMapSite(routeMapSchedules),
    [routeMapSchedules],
  );
  const routeOptimizationDirty = routeOrderDraft.differsFromCurrent;
  const routeOrderConfirmSchedules = useMemo(() => {
    const scheduleById = new Map(routeMapSchedules.map((schedule) => [schedule.id, schedule]));
    return routeOrderDraft.draftIds
      .map((scheduleId, index) => {
        const schedule = scheduleById.get(scheduleId);
        if (!schedule) return null;
        return {
          scheduleId,
          patientName: schedule.case_.patient.name,
          time: timeLabel(schedule.time_window_start, schedule.time_window_end),
          currentOrder: schedule.route_order,
          nextOrder: index + 1,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [routeMapSchedules, routeOrderDraft.draftIds]);
  const {
    window: ganttWindow,
    slots: ganttSlots,
    columns: ganttColumns,
    tableColumns: ganttTableColumns,
  } = useMemo(
    () =>
      buildScheduleDayGanttViewModel({
        visibleSchedules,
        pharmacistNameById,
      }),
    [pharmacistNameById, visibleSchedules],
  );

  function ganttBlockClass(
    schedule: VisitSchedule & {
      blockStartMinutes: number;
      blockEndMinutes: number;
    },
  ) {
    if (schedule.priority === 'emergency') {
      return 'border-rose-300 bg-rose-50 text-rose-900 shadow-rose-100';
    }
    if (schedule.schedule_status === 'completed') {
      return 'border-emerald-300 bg-emerald-50 text-emerald-900 shadow-emerald-100';
    }
    if (schedule.schedule_status === 'in_progress') {
      return 'border-sky-300 bg-sky-50 text-sky-900 shadow-sky-100';
    }
    if (schedule.schedule_status === 'departed') {
      return 'border-indigo-300 bg-indigo-50 text-indigo-900 shadow-indigo-100';
    }
    if (schedule.preparation?.prepared_at) {
      return 'border-cyan-300 bg-cyan-50 text-cyan-900 shadow-cyan-100';
    }
    return 'border-amber-300 bg-amber-50 text-amber-950 shadow-amber-100';
  }

  function ganttScheduleAriaLabel(
    schedule: VisitSchedule & {
      blockStartMinutes: number;
      blockEndMinutes: number;
    },
    pharmacistName: string,
    overlapCount: number,
    overlapKind: 'same_start' | 'overlap' | null,
  ) {
    const overlapLabel =
      overlapCount > 1
        ? `${overlapKind === 'same_start' ? '同時刻' : '重なり'} ${overlapCount}件`
        : null;

    return [
      `薬剤師 ${pharmacistName}`,
      `患者 ${schedule.case_.patient.name}`,
      `時間 ${timeLabel(schedule.time_window_start, schedule.time_window_end)}`,
      `状態 ${SCHEDULE_STATUS_LABELS[schedule.schedule_status]}`,
      schedule.preparation?.prepared_at ? '準備完了' : '準備未了',
      overlapLabel,
      `ルート順 ${schedule.route_order ?? '未設定'}`,
    ]
      .filter(Boolean)
      .join('、');
  }

  function proposalActionLabel(proposal: Proposal, actionLabel: string) {
    return `${proposal.case_.patient.name} ${format(parseISO(proposal.proposed_date), 'M/d', {
      locale: ja,
    })} ${timeLabel(proposal.time_window_start, proposal.time_window_end)} の${actionLabel}`;
  }

  function proposalActionContextLabel(proposal: Proposal) {
    return `${proposal.case_.patient.name} ${format(parseISO(proposal.proposed_date), 'M/d', {
      locale: ja,
    })} ${timeLabel(proposal.time_window_start, proposal.time_window_end)}`;
  }

  function proposalConfirmTitle(action: ProposalConfirmAction) {
    const contextLabel = proposalActionContextLabel(action.proposal);
    return action.action === 'approve'
      ? `${contextLabel} の候補を承認して架電へ進めますか`
      : `${contextLabel} の日時を確定しますか`;
  }

  function proposalConfirmDescription(action: ProposalConfirmAction) {
    return action.action === 'approve'
      ? '承認後は患者連絡待ちへ進みます。患者確認はまだ完了しません。'
      : '患者確認済みの候補から訪問予定を作成します。担当・日時・社用車を確認してから確定してください。';
  }

  function scheduleActionContextLabel(schedule: VisitSchedule) {
    return `${schedule.case_.patient.name} ${format(parseISO(schedule.scheduled_date), 'M/d', {
      locale: ja,
    })} ${timeLabel(schedule.time_window_start, schedule.time_window_end)}`;
  }

  function scheduleActionLabel(schedule: VisitSchedule, actionLabel: string) {
    return `${scheduleActionContextLabel(schedule)} の${actionLabel}`;
  }

  useEffect(() => {
    let active = true;
    void readScheduleDayCachedVisitBriefs({
      selectedDate,
      repository: visitBriefCacheRepository,
    })
      .then((result) => {
        if (!active) return;
        setCachedVisitBriefs(result.cards);
        setCachedVisitBriefUpdatedAt(result.updatedAt);
        setCachedVisitBriefLoadedDate(result.loadedDate);
        setCachedVisitBriefStatus('ready');
      })
      .catch((error) => {
        if (active) {
          console.warn('[visit-brief-cache] Failed to load schedule brief cache', error);
          setCachedVisitBriefs([]);
          setCachedVisitBriefUpdatedAt(null);
          setCachedVisitBriefLoadedDate(selectedDate);
          setCachedVisitBriefStatus('load_failed');
        }
      });

    return () => {
      active = false;
    };
  }, [selectedDate, visitBriefCacheRepository]);

  useEffect(() => {
    if (!orgId || selectedDateSchedules.length === 0) return;
    if (cachedVisitBriefLoadedDate !== selectedDate) return;

    const schedulesNeedingBriefs = selectedDateSchedules.filter(
      (schedule) => !cachedVisitBriefByScheduleId.has(schedule.id),
    );
    if (schedulesNeedingBriefs.length === 0) return;

    let cancelled = false;
    void (async () => {
      const filtered = await fetchMissingScheduleDayVisitBriefCards({
        orgId,
        selectedDate,
        schedules: schedulesNeedingBriefs,
        cachedVisitBriefByScheduleId,
      });
      if (cancelled) return;
      if (filtered.length === 0) {
        setCachedVisitBriefStatus('refresh_failed');
        return;
      }
      const updatedAt = await saveScheduleDayVisitBriefCards({
        selectedDate,
        cards: filtered,
        repository: visitBriefCacheRepository,
      });
      if (cancelled) return;
      setCachedVisitBriefs((previous) => {
        return mergeScheduleDayCachedVisitBriefCards({
          previous,
          selectedDate,
          incoming: filtered,
        });
      });
      setCachedVisitBriefUpdatedAt(updatedAt);
      setCachedVisitBriefStatus('ready');
    })().catch((error) => {
      if (!cancelled) {
        console.warn('[visit-brief-cache] Failed to refresh schedule brief cache', error);
        setCachedVisitBriefStatus('refresh_failed');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    cachedVisitBriefByScheduleId,
    cachedVisitBriefLoadedDate,
    orgId,
    selectedDate,
    selectedDateSchedules,
    visitBriefCacheRepository,
  ]);

  function openRescheduleDialog(schedule: VisitSchedule) {
    setRescheduleTarget(schedule);
    setRescheduleForm({
      reason: '',
      reason_code: 'other',
      communication_channel: 'phone',
      communication_result: 'pending',
      start_date: format(addDays(parseISO(schedule.scheduled_date), 1), 'yyyy-MM-dd'),
      priority: schedule.priority,
    });
  }

  function openFacilityVisitDayDialog(group: FacilityTrackerGroup) {
    setFacilityVisitDayTarget({
      key: group.key,
      label: group.label,
      scheduleIds: group.scheduleIds,
      patientNames: group.patientNames,
    });
    setFacilityVisitDayForm({
      preferred_weekdays: [],
      preferred_time_from: '',
      preferred_time_to: '',
      facility_time_from: '',
      facility_time_to: '',
      visit_buffer_minutes: '',
      notes: '',
    });
  }

  function openContactLogDialog(proposal: Proposal) {
    const dialogState = openScheduleDayContactLogDialog(proposal);
    setContactLogTarget(dialogState.target);
    setContactLogForm(dialogState.form);
  }

  function closeContactLogDialog() {
    const dialogState = closeScheduleDayContactLogDialog();
    setContactLogTarget(dialogState.target);
    setContactLogForm(dialogState.form);
  }

  function openPreparationDialog(schedule: VisitSchedule) {
    const initialPreparation = schedule.preparation ?? null;
    const scheduleId = schedule.id;
    const requestSeq = preparationRequestSeqRef.current + 1;
    preparationRequestSeqRef.current = requestSeq;
    preparationFormDirtyRef.current = false;
    setPreparationTarget(schedule);
    setPreparationDetails({
      preparation: initialPreparation,
      pack: null,
      loadError: null,
      identityError: null,
    });
    setPreparationForm(buildScheduleDayPreparationForm(initialPreparation));

    if (!orgId) return;

    setPreparationLoading(true);
    void fetchScheduleDayPreparationDetails({
      orgId,
      scheduleId,
    })
      .then((payload) => {
        if (preparationRequestSeqRef.current !== requestSeq) return;
        const identityError = getPreparationPackIdentityError(schedule, payload.pack);
        if (identityError) {
          toast.error(identityError);
        }
        const acceptedPreparation = identityError ? initialPreparation : payload.preparation;
        setPreparationDetails({
          preparation: acceptedPreparation,
          pack: identityError ? null : payload.pack,
          loadError: null,
          identityError,
        });
        if (!preparationFormDirtyRef.current) {
          setPreparationForm(buildScheduleDayPreparationForm(acceptedPreparation));
        }
      })
      .catch((error) => {
        if (preparationRequestSeqRef.current !== requestSeq) return;
        setPreparationDetails((current) => ({
          preparation: current?.preparation ?? initialPreparation,
          pack: null,
          loadError: PREPARATION_PACK_MISSING_MESSAGE,
          identityError: null,
        }));
        toast.error(error instanceof Error ? error.message : '訪問準備情報の取得に失敗しました');
      })
      .finally(() => {
        if (preparationRequestSeqRef.current !== requestSeq) return;
        setPreparationLoading(false);
      });
  }

  function closePreparationDialog() {
    preparationRequestSeqRef.current += 1;
    preparationFormDirtyRef.current = false;
    setPreparationLoading(false);
    setPreparationDetails(null);
    setPreparationTarget(null);
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      return generateScheduleDayProposals({
        orgId,
        resolvedCaseId: resolvedPlannerCaseId,
        plannerForm,
        routeTravelMode: plannerRouteTravelMode,
        effectiveCandidateCount: effectivePlannerCandidateCount,
      });
    },
    onSuccess: async (data) => {
      await handleScheduleDayProposalGenerationSuccess({
        data,
        orgId,
        plannerStartDate: plannerForm.start_date,
        notifySuccess: toast.success,
        notifyWarning: toast.warning,
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
        setSelectedDate,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補生成に失敗しました');
    },
  });

  const proposalActionMutation = useMutation({
    mutationFn: async (request: ScheduleDayProposalActionRequest) => {
      return updateScheduleDayProposalAction({
        orgId,
        request,
      });
    },
    onSuccess: async (_data, variables) => {
      setProposalConfirmAction(null);
      await handleScheduleDayProposalActionSuccess({
        orgId,
        payload: variables.payload,
        notifySuccess: toast.success,
        closeContactLogDialog,
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補更新に失敗しました');
    },
  });

  const rescheduleApprovalMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await fetch(`/api/visit-schedules/${scheduleId}/reschedule/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'リスケ承認に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      setRescheduleApprovalTarget(null);
      toast.success('リスケ要求を承認しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'リスケ承認に失敗しました');
    },
  });

  const callbackTaskMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: Extract<ScheduleTaskStatus, 'in_progress' | 'completed'>;
    }) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '再架電タスクの更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.status === 'completed'
          ? '再架電タスクを完了しました'
          : '再架電タスクを対応中にしました',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['tasks', 'visit-contact-followup', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '再架電タスクの更新に失敗しました');
    },
  });

  const preparationMutation = useMutation({
    mutationFn: async ({ scheduleId, markReady }: { scheduleId: string; markReady: boolean }) => {
      return saveScheduleDayPreparation({
        orgId,
        request: {
          scheduleId,
          form: preparationForm,
          markReady,
        },
      });
    },
    onSuccess: async (_data, variables) => {
      await handleScheduleDayPreparationSuccess({
        orgId,
        markReady: variables.markReady,
        notifySuccess: toast.success,
        closeDialog: closePreparationDialog,
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問準備の保存に失敗しました');
    },
  });

  const facilityBatchMutation = useMutation({
    mutationFn: async ({
      groupKey,
      carryItemsConfirmed,
    }: {
      groupKey: string;
      carryItemsConfirmed: boolean;
    }) => {
      return saveScheduleDayFacilityBatch({
        orgId,
        groupKey,
        facilityTracker,
        facilityRouteDefaults,
        facilityRouteOverrides,
        carryItemsConfirmed,
      });
    },
    onSuccess: async (_data, variables) => {
      await handleScheduleDayFacilityBatchSuccess({
        orgId,
        carryItemsConfirmed: variables.carryItemsConfirmed,
        notifySuccess: toast.success,
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
      if (variables.carryItemsConfirmed) {
        setFacilityCarryConfirmTarget(null);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '同時訪問グループの保存に失敗しました');
    },
  });

  const facilityVisitDayMutation = useMutation({
    mutationFn: async () => {
      return saveScheduleDayFacilityVisitDay({
        orgId,
        target: facilityVisitDayTarget,
        form: facilityVisitDayForm,
      });
    },
    onSuccess: async () => {
      await handleScheduleDayFacilityVisitDaySuccess({
        orgId,
        notifySuccess: toast.success,
        closeDialog: () => setFacilityVisitDayTarget(null),
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '訪問先グループの定期訪問日の保存に失敗しました',
      );
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      return generateScheduleDayRescheduleProposals({
        orgId,
        target: rescheduleTarget,
        form: rescheduleForm,
      });
    },
    onSuccess: async () => {
      await handleScheduleDayRescheduleSuccess({
        orgId,
        notifySuccess: toast.success,
        closeDialog: () => setRescheduleTarget(null),
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'リスケ候補の生成に失敗しました');
    },
  });

  const manualSyncMutation = useMutation({
    mutationFn: async () => {
      return processSyncQueue({
        orgId,
        endpoints: {
          visit_record: '/api/visit-records',
        },
      });
    },
    onSuccess: async (result) => {
      await refreshSyncState();
      toast.success(`同期完了 ${result.synced} 件 / 失敗 ${result.failed} 件`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '同期に失敗しました');
    },
  });

  const applyOptimizedRouteMutation = useMutation({
    mutationFn: async () => {
      await applyScheduleDayRouteOrderDraft({
        orgId,
        hasRoutePlan: Boolean(routePlanData),
        draftScheduleIds: routeOrderDraft.draftIds,
        confirmationContext: {
          source: 'schedule_day_route_preview',
          date: selectedDate,
          pharmacist_id: resolvedRoutePharmacistId,
          travel_mode: routePreviewTravelMode,
          target_count: routeOrderConfirmSchedules.length,
          route_order_diff_count: routeOrderDraft.diffCount,
        },
      });
    },
    onSuccess: async () => {
      setRouteOrderConfirmOpen(false);
      await handleScheduleDayRouteOrderApplySuccess({
        orgId,
        notifySuccess: toast.success,
        invalidateQueries: queryClient.invalidateQueries.bind(queryClient),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '最適順序の反映に失敗しました');
    },
  });

  const overwriteConflictMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const result = await overwriteVisitRecordConflict(
        {
          orgId,
          endpoints: {
            visit_record: '/api/visit-records',
          },
        },
        itemId,
      );
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: async () => {
      await refreshSyncState();
      await queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] });
      toast.success('サーバー版へ上書き保存しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '上書き保存に失敗しました');
    },
  });

  const discardConflictMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await discardSyncQueueItem(itemId);
    },
    onSuccess: async () => {
      await refreshSyncState();
      toast.success('ローカル下書きを破棄しました');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '競合下書きの破棄に失敗しました');
    },
  });

  const preparationPack = preparationDetails?.pack ?? null;
  const preparationReadiness = buildScheduleDayPreparationReadiness({
    form: preparationForm,
    pack: preparationPack,
    loadError: preparationDetails?.loadError ?? null,
    identityError: preparationDetails?.identityError ?? null,
    loading: preparationLoading,
    hasTarget: Boolean(preparationTarget),
    saving: preparationMutation.isPending,
  });
  const preparationClinicalViewModel = preparationPack
    ? buildScheduleDayPreparationClinicalViewModel(preparationPack)
    : null;
  const preparationSaveDisabled =
    preparationMutation.isPending || Boolean(preparationDetails?.identityError);
  const preparationReadyDescriptionIds = [
    'preparation-readiness-summary',
    preparationReadiness.contextBlockerCategories.length > 0
      ? 'preparation-readiness-categories'
      : null,
    preparationTarget ? 'preparation-action-target-summary' : null,
  ]
    .filter((id): id is string => id !== null)
    .join(' ');

  if (isScheduleBoardLoading) {
    return <ScheduleBoardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageSection
        headingId="schedule-day-operations-heading"
        title="今日の運用サマリー"
        description="週次進捗、選択日の状態、日付切替を先に確認してから候補生成と日次ボードへ進みます"
        contentClassName="space-y-4"
      >
        <ScheduleBoardMetrics stats={weekProposalStats} />

        <RouteBoardSummary
          weekStart={weekStart}
          weekEnd={weekEnd}
          selectedDay={selectedDay}
          pharmacistName={selectedCase?.primary_pharmacist_name ?? null}
        />

        <WeeklyScheduleControls
          visibleDays={visibleDays}
          selectedDate={selectedDate}
          selectedDay={selectedDay}
          proposals={proposals}
          schedules={schedules}
          billedDateSet={billedDateSet}
          nextBillableDate={billingCadence?.next_billable_date ?? null}
          suggestedDateSet={suggestedDateSet}
          onSelectDate={selectScheduleDate}
        />
      </PageSection>

      <PageSection
        className="md:hidden"
        headingId="mobile-visit-list-heading"
        title="本日の訪問リスト"
        description="右スワイプで開始、訪問中は左スワイプで記録画面へ進みます"
        contentClassName="space-y-3"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline">{mobileVisitSchedules.length}件</Badge>
            <div
              role="group"
              aria-label="本日の訪問表示"
              className="inline-flex rounded-lg border border-border bg-background p-1"
            >
              <button
                type="button"
                aria-pressed={mobileVisitSurface === 'list'}
                className={[
                  'min-h-[44px] min-w-[44px] rounded-md px-3 py-1 text-xs transition sm:min-h-0 sm:min-w-0 sm:px-2.5',
                  mobileVisitSurface === 'list'
                    ? 'bg-slate-900 text-white'
                    : 'text-muted-foreground',
                ].join(' ')}
                onClick={() => setMobileVisitSurface('list')}
              >
                リスト
              </button>
              <button
                type="button"
                aria-pressed={mobileVisitSurface === 'map'}
                className={[
                  'min-h-[44px] min-w-[44px] rounded-md px-3 py-1 text-xs transition sm:min-h-0 sm:min-w-0 sm:px-2.5',
                  mobileVisitSurface === 'map'
                    ? 'bg-slate-900 text-white'
                    : 'text-muted-foreground',
                ].join(' ')}
                onClick={() => setMobileVisitSurface('map')}
              >
                地図
              </button>
            </div>
          </div>
        }
      >
        {mobileVisitSchedules.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {format(selectedDay, 'M月d日(E)', { locale: ja })} の訪問予定はありません
            </CardContent>
          </Card>
        ) : mobileVisitSurface === 'map' ? (
          <ScheduleDayRoutePreview
            controlId="day-mobile-route"
            routePharmacistControlId="mobile-route-pharmacist"
            routeSelectionLabel={routeSelectionLabel}
            routeTravelMode={routePreviewTravelMode}
            onRouteTravelModeChange={setRoutePreviewTravelMode}
            routePlan={routePlanData}
            routeMapPoints={routeMapPoints}
            routeMapSite={routeMapSite}
            routeOrderDraft={routeOrderDraft}
            routePharmacistOptions={routePharmacistOptions}
            resolvedRoutePharmacistId={resolvedRoutePharmacistId}
            onRoutePharmacistChange={setSelectedRoutePharmacistId}
            routePlanLoading={routePlanLoading}
            routeOptimizationDirty={routeOptimizationDirty}
            applyPending={applyOptimizedRouteMutation.isPending}
            onApplyOptimizedRoute={() => setRouteOrderConfirmOpen(true)}
            actionLabel="最適順を route_order に反映"
          />
        ) : (
          <>
            <FacilityPatientSwipeRail
              groups={mobileFacilityGroups}
              activeGroupKey={activeFacilityFilter}
              onSelectGroup={setFacilityFilter}
            />
            {mobileVisitSchedules.map((schedule) => {
              const cachedBrief = cachedVisitBriefByScheduleId.get(schedule.id);
              const brief =
                cachedBrief?.patientId === schedule.case_.patient.id ? cachedBrief : undefined;
              const visitBriefStatus = brief
                ? 'available'
                : cachedVisitBriefStatus === 'ready'
                  ? 'missing'
                  : 'unavailable';
              return (
                <VisitCardMobile
                  key={schedule.id}
                  id={schedule.id}
                  patientName={schedule.case_.patient.name}
                  patientHref={`/patients/${schedule.case_.patient.id}`}
                  address={addressOfPatient(schedule)}
                  lat={schedule.case_.patient.residences[0]?.lat ?? undefined}
                  lng={schedule.case_.patient.residences[0]?.lng ?? undefined}
                  routeOrder={schedule.route_order}
                  scheduledTimeStart={timeLabel(schedule.time_window_start, null)}
                  scheduledTimeEnd={
                    schedule.time_window_end
                      ? format(parseISO(schedule.time_window_end), 'HH:mm')
                      : undefined
                  }
                  actionContextLabel={scheduleActionContextLabel(schedule)}
                  status={schedule.schedule_status}
                  carryItemsStatus={schedule.carry_items_status}
                  mustCheckToday={brief?.mustCheckToday ?? []}
                  visitBriefStatus={visitBriefStatus}
                  onStartVisit={() => handleVisitStart(schedule)}
                  onCompleteVisit={() => handleVisitComplete(schedule)}
                />
              );
            })}
          </>
        )}
      </PageSection>

      <ScheduleDayOfflinePanel
        offlineStatus={offlineStatus}
        manualSyncPending={manualSyncMutation.isPending}
        onManualSync={() => manualSyncMutation.mutate()}
        syncConflicts={syncConflicts}
        overwriteConflictPending={overwriteConflictMutation.isPending}
        discardConflictPending={discardConflictMutation.isPending}
        onOverwriteConflict={(itemId) => overwriteConflictMutation.mutate(itemId)}
        onDiscardConflict={(itemId) => discardConflictMutation.mutate(itemId)}
        cachedVisitBriefs={visibleCachedVisitBriefs}
      />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <PageSection
            id="planner"
            title="訪問候補を生成"
            description="システムが候補を提案し、承認後に患者へ架電します"
            contentClassName="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="planner-case">対象ケース</Label>
              <Select
                value={resolvedPlannerCaseId}
                onValueChange={(value) => {
                  setPlannerCandidateCountManual(false);
                  setPlannerForm((current) => applyScheduleDayPlannerCaseSelection(current, value));
                  setPlannerRouteTravelMode('DRIVE');
                }}
              >
                <SelectTrigger id="planner-case" className="w-full">
                  <SelectValue placeholder={casesLoading ? '読み込み中...' : 'ケースを選択'} />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((careCase) => (
                    <SelectItem key={careCase.id} value={careCase.id}>
                      {careCase.patient.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCase && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{selectedCase.patient.name}</p>
                  <p>{selectedCase.patient.residences[0]?.address ?? '住所未登録'}</p>
                  <p className="mt-1">
                    担当薬剤師: {selectedCase.primary_pharmacist_name ?? '未設定'}
                  </p>
                </div>
              )}
              {billingCadence && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-xs text-emerald-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">算定 cadence</p>
                      <p className="mt-1 text-emerald-900/80">{billingCadence.reason}</p>
                    </div>
                    {billingCadence.next_billable_date && (
                      <ActionRail align="start">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={billingPreviewLoading}
                          onClick={() =>
                            setPlannerForm((current) =>
                              applyScheduleDayPlannerStartDate(
                                current,
                                billingCadence.next_billable_date,
                              ),
                            )
                          }
                        >
                          次回算定可能日に設定
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={billingPreviewLoading}
                          onClick={() => {
                            setPlannerCandidateCountManual(false);
                            setPlannerForm((current) =>
                              applyScheduleDayPlannerBillingRecommendations({
                                current: applyScheduleDayPlannerStartDate(
                                  current,
                                  billingCadence.next_billable_date,
                                ),
                                billingPreview: billingPreviewData,
                              }),
                            );
                          }}
                        >
                          推奨値を適用
                        </Button>
                      </ActionRail>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p>
                      月内算定: {billingCadence.current_month_count} / {billingCadence.monthly_cap}
                    </p>
                    <p>残回数: {billingCadence.remaining_month_count}</p>
                    <p>
                      週内算定: {billingCadence.current_week_count}
                      {billingCadence.weekly_cap != null ? ` / ${billingCadence.weekly_cap}` : ''}
                    </p>
                    <p>次回算定可能日: {billingCadence.next_billable_date ?? '提案不可'}</p>
                    <p>適用改定: {billingPreviewData?.effective_revision_label ?? '未判定'}</p>
                    <p>薬局設定: {billingPreviewData?.site_config_status ?? '未判定'}</p>
                    {billingPreviewLoading ? <p>算定確認中</p> : null}
                    <p>
                      推奨設定:{' '}
                      {billingPreviewData?.recommended_visit_type ?? plannerForm.visit_type} /{' '}
                      {
                        PRIORITY_LABELS[
                          billingPreviewData?.recommended_priority ?? plannerForm.priority
                        ]
                      }
                    </p>
                    <p>
                      推奨枠数:{' '}
                      {billingPreviewData?.suggested_schedule_slot_count ??
                        Number(effectivePlannerCandidateCount)}
                      件
                    </p>
                  </div>
                  {billingCadence.scheduled_dates_current_month.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {billingCadence.scheduled_dates_current_month.map((dateKey) => (
                        <span
                          key={dateKey}
                          className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-emerald-900"
                        >
                          算定済 {dateKey.slice(5)}
                        </span>
                      ))}
                    </div>
                  )}
                  {billingAlerts.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {billingAlerts.map((alert) => (
                        <p
                          key={`${alert.type}-${alert.message}`}
                          className={
                            alert.severity === 'error'
                              ? 'text-red-700'
                              : alert.severity === 'warning'
                                ? 'text-amber-800'
                                : 'text-emerald-900'
                          }
                        >
                          {alert.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {billingPreviewWarnings.length > 0 && (
                    <div className="mt-2 space-y-1 text-amber-900">
                      {billingPreviewWarnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1.5">
                <Label htmlFor="planner-visit-type">訪問種別</Label>
                <Select
                  value={plannerForm.visit_type}
                  onValueChange={(value) =>
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerVisitType(current, value as VisitType | null),
                    )
                  }
                >
                  <SelectTrigger id="planner-visit-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="planner-priority">優先度</Label>
                <Select
                  value={plannerForm.priority}
                  onValueChange={(value) =>
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerPriority(current, value as VisitPriority | null),
                    )
                  }
                >
                  <SelectTrigger id="planner-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1.5">
                <Label htmlFor="planner-start-date">訪問起点日</Label>
                <Input
                  id="planner-start-date"
                  type="date"
                  value={plannerForm.start_date}
                  onChange={(event) =>
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerStartDate(current, event.target.value),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="planner-candidate-count">候補数</Label>
                <Select
                  value={effectivePlannerCandidateCount}
                  onValueChange={(value) => {
                    setPlannerCandidateCountManual(true);
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerCandidateCount(current, value),
                    );
                  }}
                >
                  <SelectTrigger id="planner-candidate-count" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2件</SelectItem>
                    <SelectItem value="3">3件</SelectItem>
                    <SelectItem value="4">4件</SelectItem>
                    <SelectItem value="5">5件</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
                <Label htmlFor="planner-vehicle-resource">社用車</Label>
                <Select
                  value={plannerVehicleSelectValue}
                  disabled={!vehicleResourcesEnabled || vehicleResourcesLoading}
                  onValueChange={(value) => {
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerVehicleResourceSelection(
                        current,
                        value,
                        AUTO_VEHICLE_RESOURCE_VALUE,
                      ),
                    );
                    setPlannerRouteTravelMode((currentRouteTravelMode) =>
                      resolveScheduleDayPlannerVehicleRouteTravelMode({
                        selectedValue: value,
                        autoValue: AUTO_VEHICLE_RESOURCE_VALUE,
                        vehicleResources: plannerVehicleResources,
                        currentRouteTravelMode,
                      }),
                    );
                  }}
                >
                  <SelectTrigger id="planner-vehicle-resource" className="w-full">
                    <Car className="mr-2 size-4 text-muted-foreground" />
                    <SelectValue placeholder="自動割当" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_VEHICLE_RESOURCE_VALUE}>自動割当</SelectItem>
                    {plannerVehicleResources.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.site?.name
                          ? `${vehicle.label} / ${vehicle.site.name}`
                          : vehicle.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedPlannerVehicle
                    ? formatVehicleResourceLabel(selectedPlannerVehicle)
                    : !selectedPlannerSiteId
                      ? '担当薬剤師の拠点設定後に社用車を選択できます'
                      : vehicleResourcesLoading
                        ? '社用車候補を読み込み中'
                        : '未指定の場合は患者住所とルート条件から自動割当します'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1.5">
                <Label htmlFor="planner-time-from">希望開始時刻</Label>
                <Input
                  id="planner-time-from"
                  type="time"
                  value={plannerForm.preferred_time_from}
                  onChange={(event) =>
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerPreferredTimeFrom(current, event.target.value),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="planner-time-to">希望終了時刻</Label>
                <Input
                  id="planner-time-to"
                  type="time"
                  value={plannerForm.preferred_time_to}
                  onChange={(event) =>
                    setPlannerForm((current) =>
                      applyScheduleDayPlannerPreferredTimeTo(current, event.target.value),
                    )
                  }
                />
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => generateMutation.mutate()}
              disabled={
                !resolvedPlannerCaseId ||
                generateMutation.isPending ||
                plannerGenerationBlockedByPreviewOrVehicle
              }
            >
              {generateMutation.isPending
                ? '候補生成中...'
                : billingPreviewLoading
                  ? '算定確認中...'
                  : '訪問候補を生成'}
            </Button>

            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              ルート候補は患者住所と既存訪問の順番から算出します。担当薬剤師に勤務枠が
              ない場合のみ、別薬剤師へ自動エスカレーションします。
            </div>
          </PageSection>

          <ScheduleDayOperationalTasksPanel
            callbackTasks={callbackTasks}
            callbackTasksLoading={callbackTasksLoading}
            schedulingTasks={schedulingTasks}
            tasksLoading={tasksLoading}
            proposalById={proposalById}
            scheduleById={scheduleById}
            pharmacistNameById={pharmacistNameById}
            callbackTaskPending={callbackTaskMutation.isPending}
            rescheduleApprovalPending={rescheduleApprovalMutation.isPending}
            onRecordCallbackTask={(task, proposal) => {
              setSelectedDate(toDateKey(proposal.proposed_date));
              openContactLogDialog(proposal);
              if (task.status === 'pending') {
                callbackTaskMutation.mutate({
                  id: task.id,
                  status: 'in_progress',
                });
              }
            }}
            onUpdateCallbackTaskStatus={(taskId, status) =>
              callbackTaskMutation.mutate({
                id: taskId,
                status,
              })
            }
            onOpenPreparation={openPreparationDialog}
            onApproveOverride={(schedule) =>
              setRescheduleApprovalTarget(
                buildScheduleDayRescheduleApprovalTargetFromSchedule(schedule, '運用タスク'),
              )
            }
          />

          <RelatedManagementLinks selectedCase={selectedCase} />
        </div>

        <PageSection
          title="日次スケジュールボード"
          description={`${format(selectedDay, 'M月d日(E)', { locale: ja })} の候補、確定予定、施設グループ、ルート順を確認します`}
          className="min-w-0"
          contentClassName="min-w-0 space-y-4"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">候補 {selectedDateProposals.length}件</Badge>
              <Badge variant="outline">確定 {selectedDateSchedules.length}件</Badge>
            </div>
          }
        >
          <Tabs defaultValue={initialTab}>
            <TabsList variant="line" className="mb-4">
              <TabsTrigger value="proposals">
                候補一覧
                <Badge variant="outline" className="ml-1.5">
                  {selectedDateProposals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="confirmed">
                当日確定予定
                <Badge variant="outline" className="ml-1.5">
                  {selectedDateSchedules.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="proposals" className="min-w-0 space-y-4">
              {proposalsLoading ? (
                <Card>
                  <CardContent
                    role="status"
                    aria-live="polite"
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    訪問候補を読み込んでいます...
                  </CardContent>
                </Card>
              ) : selectedDateProposals.length === 0 ? (
                <Card>
                  <CardContent
                    role="status"
                    aria-live="polite"
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    {format(selectedDay, 'M月d日(E)', { locale: ja })} の候補はありません
                  </CardContent>
                </Card>
              ) : (
                selectedDateProposals.map((proposal) => {
                  const proposalPreview = proposalBillingPreviewMap?.get(proposal.id);
                  const proposalCadence = proposalPreview?.cadence ?? null;
                  const proposalWarningMessages =
                    proposalPreview?.alerts
                      ?.filter((alert) => alert.severity !== 'info')
                      .map((alert) => alert.message) ?? [];
                  const pharmacistName =
                    proposal.proposed_pharmacist?.name ??
                    pharmacistNameById.get(proposal.proposed_pharmacist_id) ??
                    '薬剤師未登録';
                  const canApprove = ['proposed', 'reschedule_pending'].includes(
                    proposal.proposal_status,
                  );
                  const canCall = proposal.proposal_status === 'patient_contact_pending';
                  const canConfirm = canCall && proposal.patient_contact_status === 'confirmed';
                  const impactCount = readImpactCount(
                    proposal.reschedule_source_schedule?.override_request?.impact_summary,
                  );
                  const impactedPatientNames = readImpactedPatientNames(
                    proposal.reschedule_source_schedule?.override_request?.impact_summary,
                  );

                  return (
                    <Card key={proposal.id} className="overflow-hidden">
                      <CardContent className="space-y-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-semibold text-foreground">
                                {proposal.case_.patient.name}
                              </p>
                              <Badge
                                variant="outline"
                                className={statusBadgeClass(proposal.proposal_status)}
                              >
                                {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={priorityBadgeClass(proposal.priority)}
                              >
                                {PRIORITY_LABELS[proposal.priority]}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={
                                  proposal.assignment_mode === 'fallback'
                                    ? 'border-orange-200 bg-orange-50 text-orange-700'
                                    : 'border-sky-200 bg-sky-50 text-sky-700'
                                }
                              >
                                {proposal.assignment_mode === 'fallback'
                                  ? '代替薬剤師'
                                  : '担当薬剤師'}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={proposalLockText(proposal).className}
                              >
                                {proposalLockText(proposal).label}
                              </Badge>
                              {impactCount != null && impactCount > 0 && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-200 bg-amber-50 text-amber-700"
                                >
                                  影響 {impactCount} 件
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                              <span>{VISIT_TYPE_LABELS[proposal.visit_type]}</span>
                              <span>
                                {timeLabel(proposal.time_window_start, proposal.time_window_end)}
                              </span>
                              <span>
                                架電状態: {CONTACT_STATUS_LABELS[proposal.patient_contact_status]}
                              </span>
                            </div>
                          </div>
                          <div className="text-right text-sm">
                            <p className="font-medium text-foreground">{pharmacistName}</p>
                            <p className="text-muted-foreground">
                              {proposal.site?.name ?? '拠点未設定'}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 rounded-2xl bg-muted/30 p-4 lg:grid-cols-2">
                          <div className="space-y-1 text-sm">
                            <p className="text-muted-foreground">患者住所</p>
                            <p className="text-foreground">{addressOfPatient(proposal)}</p>
                          </div>
                          <div className="grid gap-1 text-sm sm:grid-cols-2">
                            <div>
                              <p className="text-muted-foreground">服薬最終日</p>
                              <p className="text-foreground">
                                {proposal.medication_end_date
                                  ? format(parseISO(proposal.medication_end_date), 'yyyy/MM/dd', {
                                      locale: ja,
                                    })
                                  : '未計算'}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">訪問期限</p>
                              <p className="text-foreground">
                                {proposal.visit_deadline_date
                                  ? format(parseISO(proposal.visit_deadline_date), 'yyyy/MM/dd', {
                                      locale: ja,
                                    })
                                  : '未設定'}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">ルート順</p>
                              <p className="text-foreground">{proposal.route_order ?? '未設定'}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">移動スコア</p>
                              <p className="text-foreground">
                                {proposal.route_distance_score?.toFixed(1) ?? '0.0'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <ProposalHumanDecisionFlow proposal={proposal} compact />

                        <div className="space-y-2 text-sm">
                          <p className="font-medium text-foreground">提案理由</p>
                          {(() => {
                            const origin = extractConferenceProposalOrigin(
                              proposal.proposal_reason,
                            );
                            return origin ? (
                              <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-950">
                                <p className="font-medium">{origin.label}</p>
                                <p className="mt-1">{origin.description}</p>
                              </div>
                            ) : null;
                          })()}
                          <div className="flex flex-wrap gap-2">
                            {splitTrace(proposal.proposal_reason).map((part) => (
                              <span
                                key={part}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                              >
                                {part}
                              </span>
                            ))}
                          </div>
                          {proposal.escalation_reason && (
                            <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-800">
                              {proposal.escalation_reason}
                            </p>
                          )}
                          {proposalCadence && (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
                              <p className="font-medium">算定 cadence</p>
                              <p className="mt-1">
                                次回算定可能日: {proposalCadence.next_billable_date ?? '提案不可'} /
                                残回数 {proposalCadence.remaining_month_count}
                              </p>
                              {proposalWarningMessages.length > 0 && (
                                <p className="mt-1 text-amber-800">
                                  {proposalWarningMessages.slice(0, 2).join(' / ')}
                                </p>
                              )}
                            </div>
                          )}
                          {impactedPatientNames.length > 0 && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                              影響予定: {impactedPatientNames.join('、')}
                            </p>
                          )}
                        </div>

                        {proposal.contact_logs.length > 0 && (
                          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                            <p className="text-sm font-medium text-foreground">架電ログ</p>
                            <div className="space-y-2 text-sm">
                              {proposal.contact_logs.map((log) => (
                                <div
                                  key={log.id}
                                  className="rounded-lg border border-border/60 bg-background px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium text-foreground">
                                      {CONTACT_STATUS_LABELS[log.outcome]}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {format(parseISO(log.called_at), 'yyyy/MM/dd HH:mm', {
                                        locale: ja,
                                      })}
                                    </span>
                                  </div>
                                  {(log.contact_name || log.contact_phone) && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {log.contact_name ?? '連絡先未記録'}
                                      {log.contact_phone ? ` / ${log.contact_phone}` : ''}
                                    </p>
                                  )}
                                  {log.note && (
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                      {log.note}
                                    </p>
                                  )}
                                  {log.callback_due_at && (
                                    <p className="mt-1 text-xs text-amber-700">
                                      折返し予定:{' '}
                                      {format(parseISO(log.callback_due_at), 'yyyy/MM/dd HH:mm', {
                                        locale: ja,
                                      })}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 border-t pt-4">
                          {proposal.proposal_status === 'reschedule_pending' &&
                            proposal.reschedule_source_schedule_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={proposalActionLabel(proposal, '変更承認を確認')}
                                onClick={() => {
                                  const target =
                                    buildScheduleDayRescheduleApprovalTargetFromProposal(proposal);
                                  if (target) setRescheduleApprovalTarget(target);
                                }}
                                disabled={rescheduleApprovalMutation.isPending}
                              >
                                変更承認
                              </Button>
                            )}
                          {canApprove && (
                            <Button
                              size="sm"
                              aria-label={proposalActionLabel(proposal, '承認して架電へ進める')}
                              onClick={() =>
                                setProposalConfirmAction({ proposal, action: 'approve' })
                              }
                              disabled={
                                proposalActionMutation.isPending ||
                                rescheduleApprovalMutation.isPending
                              }
                            >
                              承認して架電へ
                            </Button>
                          )}
                          {canCall && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={proposalActionLabel(proposal, '架電結果を記録')}
                                onClick={() => openContactLogDialog(proposal)}
                                disabled={proposalActionMutation.isPending}
                              >
                                架電結果を記録
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={proposalActionLabel(proposal, '辞退として記録')}
                                onClick={() =>
                                  proposalActionMutation.mutate({
                                    id: proposal.id,
                                    payload: {
                                      action: 'contact_attempt',
                                      outcome: 'declined',
                                      contact_method: 'phone',
                                    },
                                  })
                                }
                                disabled={proposalActionMutation.isPending}
                              >
                                辞退
                              </Button>
                              <Button
                                size="sm"
                                aria-label={proposalActionLabel(proposal, '日時を確定')}
                                onClick={() =>
                                  setProposalConfirmAction({ proposal, action: 'confirm' })
                                }
                                disabled={!canConfirm || proposalActionMutation.isPending}
                              >
                                日時確定
                              </Button>
                            </>
                          )}
                          {proposal.proposal_status === 'confirmed' &&
                            proposal.finalized_schedule && (
                              <Link
                                href={`/visits/${proposal.finalized_schedule.id}/record`}
                                aria-label={proposalActionLabel(proposal, '確定予定を開く')}
                                className="inline-flex h-8 items-center rounded-lg border px-3 text-sm text-foreground hover:bg-muted/30"
                              >
                                確定予定を開く
                              </Link>
                            )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="confirmed" className="min-w-0 space-y-4">
              {facilityTracker.length > 0 && (
                <PageSection
                  title="同時訪問グループトラッカー"
                  headingLevel={3}
                  description="同日・同一施設または個人宅の訪問を束ねて、未準備と未完了を訪問先単位で確認します"
                  contentClassName="space-y-3"
                  actions={<Building2 className="size-4 text-sky-600" aria-hidden="true" />}
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={activeFacilityFilter === null ? 'default' : 'outline'}
                      onClick={() => setFacilityFilter(null)}
                      aria-pressed={activeFacilityFilter === null}
                    >
                      全件表示
                    </Button>
                    {facilityTracker.map((group) => (
                      <Button
                        key={group.key}
                        size="sm"
                        variant={activeFacilityFilter === group.key ? 'default' : 'outline'}
                        onClick={() => setFacilityFilter(group.key)}
                        aria-pressed={activeFacilityFilter === group.key}
                      >
                        {group.label}
                      </Button>
                    ))}
                  </div>
                  <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {facilityRouteAnnouncement}
                  </p>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {facilityTracker.map((group) => (
                      <div
                        key={group.key}
                        className={[
                          'rounded-xl border px-4 py-3 text-sm transition',
                          activeFacilityFilter === group.key
                            ? 'border-sky-300 bg-sky-50'
                            : 'border-border bg-background',
                        ].join(' ')}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{group.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {group.siteName ?? '拠点未設定'} / 対象 {group.patientNames.length} 名
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              ルート順{' '}
                              {group.routeOrders.length > 0
                                ? group.routeOrders.join(', ')
                                : '未設定'}
                            </Badge>
                            {group.batchId ? <Badge variant="secondary">保存済み</Badge> : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">準備完了 {group.preparedCount} 名</Badge>
                          <Badge variant="outline">持参物未確認 {group.carryPendingCount} 名</Badge>
                          <Badge
                            variant="outline"
                            className={
                              group.incompleteCount > 0
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }
                          >
                            未完了 {group.incompleteCount} 名
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          上下ボタン、ドラッグ、番号入力で訪問順序を調整できます。
                        </p>
                        <div
                          className="mt-3 space-y-2"
                          role="list"
                          aria-label={`${group.label}の訪問順序`}
                        >
                          {getOrderedFacilityPatients(group).map(
                            (patient, index, orderedPatients) => {
                              const positionDescriptionId = `facility-route-position-${group.key}-${patient.scheduleId}`;
                              const positionText = `現在 ${index + 1} / ${orderedPatients.length}番目`;
                              return (
                                <div
                                  key={patient.scheduleId}
                                  role="listitem"
                                  draggable
                                  onDragStart={() =>
                                    setDraggingFacilityPatient({
                                      groupKey: group.key,
                                      scheduleId: patient.scheduleId,
                                    })
                                  }
                                  onDragEnd={() => setDraggingFacilityPatient(null)}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    if (
                                      draggingFacilityPatient?.groupKey !== group.key ||
                                      !draggingFacilityPatient?.scheduleId
                                    ) {
                                      return;
                                    }
                                    reorderFacilityPatients(
                                      group,
                                      draggingFacilityPatient.scheduleId,
                                      patient.scheduleId,
                                    );
                                    setDraggingFacilityPatient(null);
                                  }}
                                  className={[
                                    'flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2',
                                    draggingFacilityPatient?.scheduleId === patient.scheduleId
                                      ? 'border-sky-300 bg-sky-50'
                                      : '',
                                  ].join(' ')}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-foreground">
                                      {patient.patientName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {patient.unitName
                                        ? `部屋 ${patient.unitName}`
                                        : '部屋番号未設定'}
                                    </p>
                                    <p
                                      id={positionDescriptionId}
                                      className="text-xs font-medium text-sky-700"
                                    >
                                      {positionText}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="outline"
                                        className="min-h-11 min-w-11 sm:size-11"
                                        aria-label={`${group.label} ${patient.patientName}を1つ上へ移動`}
                                        aria-describedby={positionDescriptionId}
                                        onClick={() =>
                                          moveFacilityPatient(group, patient.scheduleId, 'up')
                                        }
                                        disabled={index === 0}
                                      >
                                        <ArrowUp className="size-4" aria-hidden="true" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="outline"
                                        className="min-h-11 min-w-11 sm:size-11"
                                        aria-label={`${group.label} ${patient.patientName}を1つ下へ移動`}
                                        aria-describedby={positionDescriptionId}
                                        onClick={() =>
                                          moveFacilityPatient(group, patient.scheduleId, 'down')
                                        }
                                        disabled={index === orderedPatients.length - 1}
                                      >
                                        <ArrowDown className="size-4" aria-hidden="true" />
                                      </Button>
                                    </div>
                                    <Label
                                      htmlFor={`facility-route-${group.key}-${patient.scheduleId}`}
                                      className="text-xs text-muted-foreground"
                                    >
                                      順序
                                    </Label>
                                    <Input
                                      id={`facility-route-${group.key}-${patient.scheduleId}`}
                                      aria-label={`${group.label} ${patient.patientName} の訪問順序`}
                                      type="number"
                                      min={1}
                                      value={
                                        facilityRouteOverrides[group.key]?.[patient.scheduleId] ??
                                        facilityRouteDefaults[group.key]?.[patient.scheduleId] ??
                                        String(patient.routeOrder ?? index + 1)
                                      }
                                      onChange={(event) =>
                                        setFacilityRouteOverrides((prev) => ({
                                          ...prev,
                                          [group.key]: {
                                            ...(prev[group.key] ?? {}),
                                            [patient.scheduleId]: event.target.value,
                                          },
                                        }))
                                      }
                                      className="h-11 min-h-11 w-20 sm:h-11 sm:min-h-11"
                                    />
                                  </div>
                                </div>
                              );
                            },
                          )}
                        </div>
                        <ActionRail align="start" className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${group.label}の定期訪問日を設定`}
                            onClick={() => openFacilityVisitDayDialog(group)}
                          >
                            定期訪問日を設定
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${group.label} ${group.patientNames.length}名の同時訪問順序を保存`}
                            onClick={() =>
                              facilityBatchMutation.mutate({
                                groupKey: group.key,
                                carryItemsConfirmed: false,
                              })
                            }
                            disabled={facilityBatchMutation.isPending}
                          >
                            同時訪問を保存 ({group.patientNames.length}名)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${group.label} ${group.patientNames.length}名の持参確認を一括反映`}
                            onClick={() => setFacilityCarryConfirmTarget(group)}
                            disabled={facilityBatchMutation.isPending}
                          >
                            持参確認を一括反映 ({group.patientNames.length}名)
                          </Button>
                        </ActionRail>
                      </div>
                    ))}
                  </div>
                </PageSection>
              )}
              {visibleSchedules.length > 0 && ganttColumns.length > 0 && (
                <ScheduleDayRoutePreview
                  controlId="day-desktop-route"
                  routePharmacistControlId="desktop-route-pharmacist"
                  className="hidden md:block"
                  routeSelectionLabel={routeSelectionLabel}
                  routeTravelMode={routePreviewTravelMode}
                  onRouteTravelModeChange={setRoutePreviewTravelMode}
                  routePlan={routePlanData}
                  routeMapPoints={routeMapPoints}
                  routeMapSite={routeMapSite}
                  routeOrderDraft={routeOrderDraft}
                  routePharmacistOptions={routePharmacistOptions}
                  resolvedRoutePharmacistId={resolvedRoutePharmacistId}
                  onRoutePharmacistChange={setSelectedRoutePharmacistId}
                  routePlanLoading={routePlanLoading}
                  routeOptimizationDirty={routeOptimizationDirty}
                  applyPending={applyOptimizedRouteMutation.isPending}
                  onApplyOptimizedRoute={() => setRouteOrderConfirmOpen(true)}
                  actionLabel="最適順を反映"
                  showRouteMapScheduleCount
                  routeMapScheduleCount={routeMapSchedules.length}
                />
              )}
              {visibleSchedules.length > 0 && ganttColumns.length > 0 && (
                <PageSection
                  headingId="schedule-day-gantt-heading"
                  title="タブレット日次ガント"
                  headingLevel={3}
                  description="縦軸=時間、横軸=薬剤師。予定密度を俯瞰し、下の確定予定カードで開始・準備・変更を実行します"
                  className="hidden min-w-0 md:block"
                  contentClassName="space-y-4"
                >
                  <p id="schedule-day-gantt-scroll-help" className="sr-only">
                    横スクロールで隠れている薬剤師列を確認できます。ガント内の予定は要約表示です。
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">
                      時間帯 {formatMinutesLabel(ganttWindow.startMinutes)} -{' '}
                      {formatMinutesLabel(ganttWindow.endMinutes)}
                    </Badge>
                    <Badge variant="outline">薬剤師 {ganttColumns.length} 名</Badge>
                    <Badge variant="outline">確定訪問 {visibleSchedules.length} 件</Badge>
                    <Badge variant="outline">横向き推奨</Badge>
                  </div>
                  <div
                    role="region"
                    tabIndex={0}
                    aria-labelledby="schedule-day-gantt-heading"
                    aria-describedby="schedule-day-gantt-scroll-help"
                    className="max-w-full overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <table className="min-w-[960px] table-fixed border-separate border-spacing-3">
                      <caption className="sr-only">
                        日次ガント表。行は時間帯、列は薬剤師、セルは患者訪問予定を示します。
                      </caption>
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="w-18 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-left text-xs font-medium text-muted-foreground"
                          >
                            時間
                          </th>
                          {ganttTableColumns.map((column) => (
                            <th
                              key={column.pharmacistId}
                              scope="col"
                              className="w-56 min-w-56 rounded-xl border border-border bg-muted/20 px-3 py-3 text-left"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {column.pharmacistName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {column.siteName ?? '拠点未設定'}
                                  </p>
                                </div>
                                <Badge variant="outline">{column.schedules.length}件</Badge>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ganttSlots.map((slot, slotIndex) => (
                          <tr key={slot} className="align-top">
                            <th
                              scope="row"
                              className="h-11 rounded-xl border border-border bg-muted/10 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground"
                            >
                              {formatMinutesLabel(slot)}
                            </th>
                            {ganttTableColumns.map((column) => {
                              const scheduleCell = column.scheduleStarts.get(slotIndex);
                              if (scheduleCell) {
                                return (
                                  <td
                                    key={`${column.pharmacistId}-${slot}`}
                                    rowSpan={scheduleCell.span}
                                    className="w-56 min-w-56 align-top"
                                  >
                                    <div className="space-y-2">
                                      {scheduleCell.schedules.length > 1 ? (
                                        <Badge variant="outline" className="bg-background/90">
                                          {scheduleCell.overlapKind === 'same_start'
                                            ? '同時刻'
                                            : '重なり'}{' '}
                                          {scheduleCell.schedules.length}件
                                        </Badge>
                                      ) : null}
                                      {scheduleCell.schedules.map((schedule) => (
                                        <div
                                          key={schedule.id}
                                          role="group"
                                          aria-label={ganttScheduleAriaLabel(
                                            schedule,
                                            column.pharmacistName,
                                            scheduleCell.schedules.length,
                                            scheduleCell.overlapKind,
                                          )}
                                          className={[
                                            'flex min-h-[44px] flex-col rounded-2xl border px-3 py-2 shadow-sm',
                                            ganttBlockClass(schedule),
                                          ].join(' ')}
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-medium">
                                                {schedule.case_.patient.name}
                                              </p>
                                              <p className="text-[11px] opacity-80">
                                                {timeLabel(
                                                  schedule.time_window_start,
                                                  schedule.time_window_end,
                                                )}
                                              </p>
                                            </div>
                                            <Badge
                                              variant="outline"
                                              className="shrink-0 bg-white/70"
                                            >
                                              #{schedule.route_order ?? '-'}
                                            </Badge>
                                          </div>
                                          <div className="mt-2 flex flex-wrap gap-1">
                                            <Badge variant="outline" className="bg-white/70">
                                              {SCHEDULE_STATUS_LABELS[schedule.schedule_status]}
                                            </Badge>
                                            <Badge variant="outline" className="bg-white/70">
                                              {schedule.preparation?.prepared_at
                                                ? '準備完了'
                                                : '準備未了'}
                                            </Badge>
                                          </div>
                                          <p className="mt-2 line-clamp-2 text-[11px] opacity-80">
                                            {addressOfPatient(schedule)}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                );
                              }

                              if (column.coveredSlots.has(slotIndex)) {
                                return null;
                              }

                              return (
                                <td
                                  key={`${column.pharmacistId}-${slot}`}
                                  aria-hidden="true"
                                  className="h-11 w-56 min-w-56 rounded-xl border border-dashed border-border/70 bg-background"
                                />
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </PageSection>
              )}
              {schedulesLoading ? (
                <Card>
                  <CardContent
                    role="status"
                    aria-live="polite"
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    確定予定を読み込んでいます...
                  </CardContent>
                </Card>
              ) : visibleSchedules.length === 0 ? (
                <Card>
                  <CardContent
                    role="status"
                    aria-live="polite"
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    {activeFacilityFilter
                      ? '絞り込み条件に一致する訪問はありません'
                      : `${format(selectedDay, 'M月d日(E)', { locale: ja })} の確定予定はありません`}
                  </CardContent>
                </Card>
              ) : (
                visibleSchedules.map((schedule) => {
                  const schedulePreview = scheduleBillingPreviewMap?.get(schedule.id);
                  const scheduleCadence = schedulePreview?.cadence ?? null;
                  const scheduleWarningMessages =
                    schedulePreview?.alerts
                      ?.filter((alert) => alert.severity !== 'info')
                      .map((alert) => alert.message) ?? [];

                  return (
                    <Card
                      key={schedule.id}
                      id={`schedule-${schedule.id}`}
                      className={cn(
                        'overflow-hidden scroll-mt-28',
                        highlightedScheduleId === schedule.id ? 'ring-2 ring-primary/30' : null,
                      )}
                    >
                      <CardContent className="space-y-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-semibold text-foreground">
                                {schedule.case_.patient.name}
                              </p>
                              <Badge
                                variant="outline"
                                className={statusBadgeClass(schedule.schedule_status)}
                              >
                                {SCHEDULE_STATUS_LABELS[schedule.schedule_status]}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={priorityBadgeClass(schedule.priority)}
                              >
                                {PRIORITY_LABELS[schedule.priority]}
                              </Badge>
                              {schedule.confirmed_at && (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                                >
                                  電話確定済み
                                </Badge>
                              )}
                              <Badge
                                variant="outline"
                                className={scheduleLockText(schedule).className}
                              >
                                {scheduleLockText(schedule).label}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={
                                  schedule.preparation?.prepared_at
                                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                                }
                              >
                                {schedule.preparation?.prepared_at
                                  ? `準備完了 ${countCompletedPreparationItems(schedule.preparation)}/5`
                                  : `準備 ${countCompletedPreparationItems(schedule.preparation)}/5`}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                              <span>{VISIT_TYPE_LABELS[schedule.visit_type]}</span>
                              <span>
                                {timeLabel(schedule.time_window_start, schedule.time_window_end)}
                              </span>
                              <span>ルート順 {schedule.route_order ?? '未設定'}</span>
                              <span>当日担当 {schedule.workload_hint.daily_visit_count}件</span>
                            </div>
                          </div>
                          <div className="text-right text-sm">
                            <p className="font-medium text-foreground">
                              {pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録'}
                            </p>
                            <p className="text-muted-foreground">
                              {schedule.site?.name ?? '拠点未設定'}
                            </p>
                          </div>
                        </div>

                        {['completed', 'cancelled', 'rescheduled'].includes(
                          schedule.schedule_status,
                        ) ? null : (
                          <ActionRail align="start" className="border-b pb-4">
                            {['ready', 'departed'].includes(schedule.schedule_status) && (
                              <Button
                                size="sm"
                                className="gap-1.5"
                                variant={
                                  getDepartureCarryWarning(schedule) ? 'destructive' : 'default'
                                }
                                aria-label={scheduleActionLabel(
                                  schedule,
                                  visitStartActionText(schedule),
                                )}
                                onClick={() => handleVisitStart(schedule)}
                              >
                                <PlayCircle className="size-4" aria-hidden="true" />
                                {visitStartActionText(schedule)}
                              </Button>
                            )}
                            {schedule.schedule_status === 'in_progress' && (
                              <Link href={`/visits/${schedule.id}/record`}>
                                <Button
                                  size="sm"
                                  variant="default"
                                  aria-label={scheduleActionLabel(schedule, '訪問完了記録を開く')}
                                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                                >
                                  <CheckCircle2 className="size-4" aria-hidden="true" />
                                  訪問完了
                                </Button>
                              </Link>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={scheduleActionLabel(schedule, '訪問準備を開く')}
                              onClick={() => openPreparationDialog(schedule)}
                            >
                              訪問準備
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={scheduleActionLabel(schedule, 'リスケ候補を作る')}
                              onClick={() => openRescheduleDialog(schedule)}
                            >
                              リスケ候補を作る
                            </Button>
                          </ActionRail>
                        )}

                        <div className="grid gap-3 rounded-2xl bg-muted/30 p-4 lg:grid-cols-2">
                          <div className="space-y-1 text-sm">
                            <p className="text-muted-foreground">患者住所</p>
                            <p className="text-foreground">{addressOfPatient(schedule)}</p>
                          </div>
                          <div className="space-y-1 text-sm">
                            <p className="text-muted-foreground">運用ルール</p>
                            <p className="text-foreground">
                              確定後は原則変更せず、緊急割込や担当者不在時のみリスケ候補を作成します。
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {scheduleLockText(schedule).detail}
                            </p>
                          </div>
                        </div>

                        {(schedule.facility_hint || schedule.handoff_hint) && (
                          <div className="grid gap-3 lg:grid-cols-2">
                            {schedule.facility_hint && (
                              <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                                <p className="font-medium">施設モード</p>
                                <p className="mt-1 leading-6">
                                  {schedule.facility_hint.label} で同日{' '}
                                  {schedule.facility_hint.patient_count} 名を担当
                                </p>
                                <p className="mt-1 text-xs text-sky-800/80">
                                  {schedule.facility_hint.patient_names.join('、')}
                                </p>
                              </div>
                            )}
                            {schedule.handoff_hint && (
                              <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
                                <p className="font-medium">引継ぎ・例外メモ</p>
                                <p className="mt-1 leading-6">{schedule.handoff_hint.summary}</p>
                                {schedule.workload_hint.urgent_visit_count > 0 && (
                                  <p className="mt-1 text-xs text-purple-800/80">
                                    当日至急案件 {schedule.workload_hint.urgent_visit_count} 件
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {schedule.override_request?.status === 'pending' && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">確定済み訪問の変更承認待ち</p>
                                <p className="mt-1 leading-6">{schedule.override_request.reason}</p>
                                {schedule.override_request.impact_summary &&
                                  typeof schedule.override_request.impact_summary
                                    .impacted_schedule_count === 'number' && (
                                    <p className="mt-1 text-xs text-amber-800/80">
                                      影響予定:{' '}
                                      {
                                        schedule.override_request.impact_summary
                                          .impacted_schedule_count as number
                                      }
                                      件
                                    </p>
                                  )}
                                {schedule.override_request.impact_summary &&
                                  typeof schedule.override_request.impact_summary
                                    .proposed_replacements === 'number' && (
                                    <p className="mt-1 text-xs text-amber-800/80">
                                      再提案候補:{' '}
                                      {
                                        schedule.override_request.impact_summary
                                          .proposed_replacements as number
                                      }
                                      件
                                    </p>
                                  )}
                                {readImpactedPatientNames(schedule.override_request.impact_summary)
                                  .length > 0 && (
                                  <p className="mt-1 text-xs text-amber-800/80">
                                    影響患者:{' '}
                                    {readImpactedPatientNames(
                                      schedule.override_request.impact_summary,
                                    ).join('、')}
                                  </p>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={scheduleActionLabel(schedule, '変更承認を確認')}
                                onClick={() =>
                                  setRescheduleApprovalTarget(
                                    buildScheduleDayRescheduleApprovalTargetFromSchedule(
                                      schedule,
                                      '確定予定',
                                    ),
                                  )
                                }
                                disabled={rescheduleApprovalMutation.isPending}
                              >
                                変更承認
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-foreground">訪問準備</p>
                            <span className="text-xs text-muted-foreground">
                              {countCompletedPreparationItems(schedule.preparation)}/
                              {PREPARATION_ITEMS.length} 完了
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {PREPARATION_ITEMS.map(([field, label]) => (
                              <div
                                key={field}
                                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                              >
                                <div
                                  className={[
                                    'size-2 rounded-full',
                                    schedule.preparation?.[field]
                                      ? 'bg-emerald-500'
                                      : 'bg-slate-300',
                                  ].join(' ')}
                                >
                                  <span className="sr-only">
                                    {schedule.preparation?.[field] ? '完了' : '未完了'}
                                  </span>
                                </div>
                                <span className="text-xs text-foreground">{label}</span>
                              </div>
                            ))}
                          </div>
                          {schedule.preparation?.prepared_at && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              最終更新{' '}
                              {format(
                                parseISO(schedule.preparation.prepared_at),
                                'yyyy/MM/dd HH:mm',
                                {
                                  locale: ja,
                                },
                              )}
                            </p>
                          )}
                        </div>

                        {scheduleCadence && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
                            <p className="font-medium">算定 cadence</p>
                            <p className="mt-1">
                              次回算定可能日: {scheduleCadence.next_billable_date ?? '提案不可'} /
                              残回数 {scheduleCadence.remaining_month_count}
                            </p>
                            {scheduleWarningMessages.length > 0 && (
                              <p className="mt-1 text-amber-800">
                                {scheduleWarningMessages.slice(0, 2).join(' / ')}
                              </p>
                            )}
                          </div>
                        )}

                        {schedule.applied_override && (
                          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                            <p className="font-medium">例外変更履歴</p>
                            <p className="mt-1 leading-6">
                              {format(
                                parseISO(schedule.applied_override.source_schedule.scheduled_date),
                                'yyyy/MM/dd',
                                { locale: ja },
                              )}{' '}
                              {timeLabel(
                                schedule.applied_override.source_schedule.time_window_start,
                                schedule.applied_override.source_schedule.time_window_end,
                              )}{' '}
                              から再調整。理由: {schedule.applied_override.reason}
                            </p>
                            <p className="mt-1 text-xs text-orange-800/80">
                              変更前担当:{' '}
                              {pharmacistNameById.get(
                                schedule.applied_override.source_schedule.pharmacist_id,
                              ) ?? '薬剤師未登録'}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </PageSection>
      </div>

      <ScheduleDayRescheduleApprovalDialog
        target={rescheduleApprovalTarget}
        approving={rescheduleApprovalMutation.isPending}
        onCancel={() => setRescheduleApprovalTarget(null)}
        onConfirm={(scheduleId) => rescheduleApprovalMutation.mutate(scheduleId)}
      />

      <AlertDialog
        open={proposalConfirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !proposalActionMutation.isPending) {
            setProposalConfirmAction(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {currentProposalConfirmAction
                ? proposalConfirmTitle(currentProposalConfirmAction)
                : '訪問候補の操作を確認します'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {currentProposalConfirmAction
                ? proposalConfirmDescription(currentProposalConfirmAction)
                : '対象候補を確認してから実行してください。'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {currentProposalConfirmAction ? (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">操作</dt>
                  <dd className="font-medium">
                    {proposalConfirmActionLabel(currentProposalConfirmAction.action)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">実行後</dt>
                  <dd className="font-medium">
                    {proposalConfirmResultLabel(currentProposalConfirmAction.action)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">患者</dt>
                  <dd className="font-medium">
                    {currentProposalConfirmAction.proposal.case_.patient.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">候補日時</dt>
                  <dd className="font-medium">
                    {format(
                      parseISO(currentProposalConfirmAction.proposal.proposed_date),
                      'yyyy/MM/dd(E)',
                      {
                        locale: ja,
                      },
                    )}{' '}
                    {timeLabel(
                      currentProposalConfirmAction.proposal.time_window_start,
                      currentProposalConfirmAction.proposal.time_window_end,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">担当</dt>
                  <dd className="font-medium">
                    {currentProposalConfirmAction.proposal.proposed_pharmacist?.name ??
                      pharmacistNameById.get(
                        currentProposalConfirmAction.proposal.proposed_pharmacist_id,
                      ) ??
                      '薬剤師未登録'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">社用車</dt>
                  <dd className="font-medium">
                    {formatVehicleResourceLabel(
                      currentProposalConfirmAction.proposal.vehicle_resource,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">候補状態</dt>
                  <dd className="font-medium">
                    {PROPOSAL_STATUS_LABELS[currentProposalConfirmAction.proposal.proposal_status]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">患者連絡</dt>
                  <dd className="font-medium">
                    {
                      CONTACT_STATUS_LABELS[
                        currentProposalConfirmAction.proposal.patient_contact_status
                      ]
                    }
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">識別子</dt>
                  <dd className="font-medium">
                    {proposalSafeIdentifierLabel(currentProposalConfirmAction.proposal)}
                  </dd>
                </div>
              </dl>
              {!proposalConfirmActionExecutable && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  候補状態が変わりました。最新の候補状態を確認してから操作してください。
                </p>
              )}
              <p className="text-xs leading-5 text-muted-foreground">
                住所、電話番号、薬剤名、処方の細部はこの確認画面には表示しません。対象患者、候補日時、担当、社用車、識別子が一致している場合のみ実行してください。
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={proposalActionMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!currentProposalConfirmAction || !proposalConfirmActionExecutable) return;
                proposalActionMutation.mutate({
                  id: currentProposalConfirmAction.proposal.id,
                  payload: { action: currentProposalConfirmAction.action },
                });
              }}
              disabled={
                !currentProposalConfirmAction ||
                !proposalConfirmActionExecutable ||
                proposalActionMutation.isPending
              }
            >
              {proposalActionMutation.isPending
                ? '処理中...'
                : currentProposalConfirmAction
                  ? proposalConfirmActionLabel(currentProposalConfirmAction.action)
                  : '実行'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={routeOrderConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !applyOptimizedRouteMutation.isPending) {
            setRouteOrderConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>日次ルートの route_order を反映しますか</AlertDialogTitle>
            <AlertDialogDescription>
              対象日、薬剤師、移動手段、患者順序を確認してから反映してください。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">対象日</dt>
                <dd className="font-medium">
                  {format(selectedDay, 'yyyy/MM/dd(E)', { locale: ja })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">対象薬剤師</dt>
                <dd className="font-medium">{routeSelectionLabel ?? '薬剤師未選択'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">移動手段</dt>
                <dd className="font-medium">
                  {VISIT_ROUTE_TRAVEL_MODE_LABELS[routePreviewTravelMode]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">対象 / 差分</dt>
                <dd className="font-medium">
                  {routeOrderConfirmSchedules.length}件 / {routeOrderDraft.diffCount}件
                </dd>
              </div>
            </dl>

            <ul
              aria-label="日次ルート順反映の対象患者"
              className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2"
            >
              {routeOrderConfirmSchedules.map((schedule) => (
                <li key={schedule.scheduleId} className="rounded-md bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {schedule.nextOrder}. {schedule.patientName}
                    </span>
                    <Badge variant="outline">{schedule.time}</Badge>
                    <Badge variant="outline">
                      現在 {schedule.currentOrder ?? '未設定'} → {schedule.nextOrder}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-muted-foreground">
              住所、電話番号、薬剤名、処方詳細はこの確認画面には表示しません。対象日・薬剤師・患者順序が一致している場合のみ反映してください。
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyOptimizedRouteMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applyOptimizedRouteMutation.mutate()}
              disabled={
                applyOptimizedRouteMutation.isPending ||
                routeOrderConfirmSchedules.length === 0 ||
                !routeOptimizationDirty
              }
            >
              {applyOptimizedRouteMutation.isPending
                ? 'route_order 反映中...'
                : `${routeOrderConfirmSchedules.length}件の route_order を反映`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={facilityCarryConfirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && !facilityBatchMutation.isPending) {
            setFacilityCarryConfirmTarget(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {facilityCarryConfirmTarget
                ? `${facilityCarryConfirmTarget.label} ${facilityCarryConfirmTarget.patientNames.length}名の持参確認を一括反映しますか`
                : '持参確認を一括反映しますか'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {facilityCarryConfirmBlocked(facilityCarryConfirmTarget)
                ? '不足、一部不足、未判定の持参物があるため一括反映できません。対象患者を個別に確認してください。'
                : '対象全員の持参薬・施設預かり・不足時対応を確認済みにします。患者違い、部屋違い、未確定の持参物がある場合はキャンセルして個別に確認してください。'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {facilityCarryConfirmTarget ? (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">対象日</dt>
                  <dd className="font-medium">
                    {format(selectedDay, 'M月d日(E)', { locale: ja })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">対象施設</dt>
                  <dd className="font-medium">{facilityCarryConfirmTarget.label}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">対象人数</dt>
                  <dd className="font-medium">
                    {facilityCarryConfirmTarget.patientNames.length}名
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">持参未確認</dt>
                  <dd className="font-medium">{facilityCarryConfirmTarget.carryPendingCount}件</dd>
                </div>
              </dl>
              <ul
                aria-label={`${facilityCarryConfirmTarget.label}の一括持参確認対象`}
                className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2"
              >
                {getOrderedFacilityPatients(facilityCarryConfirmTarget).map((patient, index) => (
                  <li key={patient.scheduleId} className="rounded-md bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {index + 1}. {patient.patientName}
                      </span>
                      {patient.unitName ? (
                        <span className="text-muted-foreground">{patient.unitName}</span>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={
                          patient.carryItemsStatus === 'ready'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                        }
                      >
                        {formatFacilityCarryItemsStatus(patient.carryItemsStatus)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      持参確認: {patient.carryItemsConfirmed ? '確認済み' : '未確認'}
                    </p>
                  </li>
                ))}
              </ul>
              {facilityCarryConfirmBlocked(facilityCarryConfirmTarget) ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">一括反映できない患者が含まれています</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {getUnsafeFacilityCarryPatients(facilityCarryConfirmTarget).map((patient) => (
                      <li key={patient.scheduleId}>
                        {patient.patientName} /{' '}
                        {formatFacilityCarryItemsStatus(patient.carryItemsStatus)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs leading-5 text-muted-foreground">
                住所、薬剤名、処方詳細はこの確認画面には表示しません。対象患者と順序だけを確認し、持参物の現物確認が済んでいる場合のみ反映してください。
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={facilityBatchMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!facilityCarryConfirmTarget) return;
                if (!canBulkConfirmFacilityCarryItems(facilityCarryConfirmTarget)) return;
                facilityBatchMutation.mutate({
                  groupKey: facilityCarryConfirmTarget.key,
                  carryItemsConfirmed: true,
                });
              }}
              disabled={
                !canBulkConfirmFacilityCarryItems(facilityCarryConfirmTarget) ||
                facilityBatchMutation.isPending
              }
            >
              {facilityBatchMutation.isPending
                ? '持参確認を反映中...'
                : facilityCarryConfirmBlocked(facilityCarryConfirmTarget)
                  ? '個別確認が必要'
                  : `${facilityCarryConfirmTarget?.patientNames.length ?? 0}名の持参確認を反映`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => !open && setRescheduleTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>リスケジュール候補を生成</DialogTitle>
            <DialogDescription>
              緊急訪問や担当者不在などの割込時に、新しい候補を生成します。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              {rescheduleTarget && (
                <>
                  <p className="font-medium text-foreground">
                    {rescheduleTarget.case_.patient.name}
                  </p>
                  <p className="text-muted-foreground">
                    {format(parseISO(rescheduleTarget.scheduled_date), 'yyyy/MM/dd', {
                      locale: ja,
                    })}{' '}
                    {timeLabel(
                      rescheduleTarget.time_window_start,
                      rescheduleTarget.time_window_end,
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reschedule-reason">リスケ理由</Label>
              <Textarea
                id="reschedule-reason"
                value={rescheduleForm.reason}
                onChange={(event) =>
                  setRescheduleForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="例: 緊急訪問が割り込んだため、担当薬剤師の当日訪問を再配置"
                rows={4}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-reason-code">理由コード</Label>
                <Select
                  value={rescheduleForm.reason_code}
                  onValueChange={(value) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      reason_code:
                        (value as typeof current.reason_code | null) ?? current.reason_code,
                    }))
                  }
                >
                  <SelectTrigger id="reschedule-reason-code" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="emergency_insert">緊急訪問の割込み</SelectItem>
                    <SelectItem value="pharmacist_unavailable">担当薬剤師不在</SelectItem>
                    <SelectItem value="patient_request">患者都合</SelectItem>
                    <SelectItem value="facility_request">施設都合</SelectItem>
                    <SelectItem value="weather">天候・交通事情</SelectItem>
                    <SelectItem value="other">その他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-channel">連絡チャネル</Label>
                <Select
                  value={rescheduleForm.communication_channel}
                  onValueChange={(value) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      communication_channel:
                        (value as typeof current.communication_channel | null) ??
                        current.communication_channel,
                    }))
                  }
                >
                  <SelectTrigger id="reschedule-channel" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">電話</SelectItem>
                    <SelectItem value="fax">FAX</SelectItem>
                    <SelectItem value="email">メール</SelectItem>
                    <SelectItem value="collaboration">連携ポータル</SelectItem>
                    <SelectItem value="in_person">口頭</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reschedule-result">連絡結果</Label>
              <Select
                value={rescheduleForm.communication_result}
                onValueChange={(value) =>
                  setRescheduleForm((current) => ({
                    ...current,
                    communication_result:
                      (value as typeof current.communication_result | null) ??
                      current.communication_result,
                  }))
                }
              >
                <SelectTrigger id="reschedule-result" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">これから連絡する</SelectItem>
                  <SelectItem value="sent">連絡依頼を送信済み</SelectItem>
                  <SelectItem value="verbal_notified">口頭で周知済み</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                家族・施設・看護・ケアマネの登録先がある場合は、自動で連携依頼キューに起票します。
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-start-date">再提案開始日</Label>
                <Input
                  id="reschedule-start-date"
                  type="date"
                  value={rescheduleForm.start_date}
                  onChange={(event) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      start_date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-priority">優先度</Label>
                <Select
                  value={rescheduleForm.priority}
                  onValueChange={(value) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      priority: (value as VisitPriority | null) ?? current.priority,
                    }))
                  }
                >
                  <SelectTrigger id="reschedule-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRescheduleTarget(null)}
              disabled={rescheduleMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => rescheduleMutation.mutate()}
              disabled={!rescheduleForm.reason || rescheduleMutation.isPending}
            >
              {rescheduleMutation.isPending ? '生成中...' : 'リスケ候補を生成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contactLogTarget !== null}
        onOpenChange={(open) => !open && closeContactLogDialog()}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>架電結果を記録</DialogTitle>
            <DialogDescription>
              患者への電話結果を残します。日時確定の前に「確認済み」を記録してください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {contactLogTarget && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{contactLogTarget.case_.patient.name}</p>
                <p className="text-muted-foreground">
                  {format(parseISO(contactLogTarget.proposed_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(contactLogTarget.time_window_start, contactLogTarget.time_window_end)}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-method">連絡方法</Label>
              <Select
                value={contactLogForm.contact_method}
                onValueChange={(value) =>
                  setContactLogForm((current) => ({
                    ...current,
                    contact_method: value as typeof current.contact_method,
                  }))
                }
              >
                <SelectTrigger id="contact-log-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">電話</SelectItem>
                  <SelectItem value="fax">FAX</SelectItem>
                  <SelectItem value="email">メール</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-outcome">架電結果</Label>
              <Select
                value={contactLogForm.outcome}
                onValueChange={(value) =>
                  value
                    ? setContactLogForm((current) => ({
                        ...current,
                        outcome: value as typeof current.outcome,
                      }))
                    : undefined
                }
              >
                <SelectTrigger id="contact-log-outcome" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attempted">架電済み</SelectItem>
                  <SelectItem value="confirmed">患者確認済み</SelectItem>
                  <SelectItem value="unreachable">不通</SelectItem>
                  <SelectItem value="declined">辞退</SelectItem>
                  <SelectItem value="change_requested">変更希望</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-log-name">対応者名</Label>
                <Input
                  id="contact-log-name"
                  value={contactLogForm.contact_name}
                  onChange={(event) =>
                    setContactLogForm((current) => ({
                      ...current,
                      contact_name: event.target.value,
                    }))
                  }
                  placeholder="例: 本人 / ご家族"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-log-phone">電話番号</Label>
                <Input
                  id="contact-log-phone"
                  value={contactLogForm.contact_phone}
                  onChange={(event) =>
                    setContactLogForm((current) => ({
                      ...current,
                      contact_phone: event.target.value,
                    }))
                  }
                  placeholder="例: 090-0000-0000"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-callback">折返し予定</Label>
              <Input
                id="contact-log-callback"
                type="datetime-local"
                value={contactLogForm.callback_due_at}
                onChange={(event) =>
                  setContactLogForm((current) => ({
                    ...current,
                    callback_due_at: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-note">通話メモ</Label>
              <Textarea
                id="contact-log-note"
                rows={4}
                value={contactLogForm.note}
                onChange={(event) =>
                  setContactLogForm((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="例: 家族同席で了承。来月以降は午前帯希望。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeContactLogDialog}
              disabled={proposalActionMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => {
                if (!contactLogTarget) return;
                proposalActionMutation.mutate(
                  buildScheduleDayContactAttemptRequest({
                    proposalId: contactLogTarget.id,
                    form: contactLogForm,
                  }),
                );
              }}
              disabled={proposalActionMutation.isPending}
            >
              {proposalActionMutation.isPending ? '保存中...' : '架電結果を保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={facilityVisitDayTarget !== null}
        onOpenChange={(open) => !open && setFacilityVisitDayTarget(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>訪問先グループの定期訪問日を設定</DialogTitle>
            <DialogDescription>
              同一施設または個人宅の夫婦・同居人の訪問曜日と受入時間帯をまとめて保存し、RRULE
              生成時の共通条件として使います。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              {facilityVisitDayTarget && (
                <>
                  <p className="font-medium text-foreground">{facilityVisitDayTarget.label}</p>
                  <p className="text-muted-foreground">
                    対象患者: {facilityVisitDayTarget.patientNames.join('、')}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>定期訪問曜日</Label>
              <div className="flex flex-wrap gap-2">
                {FACILITY_VISIT_DAY_WEEKDAY_OPTIONS.map((weekday) => {
                  const checked = facilityVisitDayForm.preferred_weekdays.includes(weekday.value);
                  return (
                    <label
                      key={weekday.value}
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setFacilityVisitDayForm((current) => ({
                            ...current,
                            preferred_weekdays: next
                              ? [...current.preferred_weekdays, weekday.value].sort(
                                  (left, right) => left - right,
                                )
                              : current.preferred_weekdays.filter(
                                  (value) => value !== weekday.value,
                                ),
                          }))
                        }
                      />
                      <span>{weekday.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="facility-preferred-time-from">訪問希望時間帯</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="facility-preferred-time-from"
                    type="time"
                    value={facilityVisitDayForm.preferred_time_from}
                    onChange={(event) =>
                      setFacilityVisitDayForm((current) => ({
                        ...current,
                        preferred_time_from: event.target.value,
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">〜</span>
                  <Input
                    type="time"
                    value={facilityVisitDayForm.preferred_time_to}
                    onChange={(event) =>
                      setFacilityVisitDayForm((current) => ({
                        ...current,
                        preferred_time_to: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-accept-time-from">施設受入時間帯</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="facility-accept-time-from"
                    type="time"
                    value={facilityVisitDayForm.facility_time_from}
                    onChange={(event) =>
                      setFacilityVisitDayForm((current) => ({
                        ...current,
                        facility_time_from: event.target.value,
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">〜</span>
                  <Input
                    type="time"
                    value={facilityVisitDayForm.facility_time_to}
                    onChange={(event) =>
                      setFacilityVisitDayForm((current) => ({
                        ...current,
                        facility_time_to: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="facility-buffer-minutes">訪問間バッファ(分)</Label>
                <Input
                  id="facility-buffer-minutes"
                  type="number"
                  min={0}
                  max={240}
                  value={facilityVisitDayForm.visit_buffer_minutes}
                  onChange={(event) =>
                    setFacilityVisitDayForm((current) => ({
                      ...current,
                      visit_buffer_minutes: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-visit-notes">補足メモ</Label>
                <Textarea
                  id="facility-visit-notes"
                  rows={3}
                  value={facilityVisitDayForm.notes}
                  onChange={(event) =>
                    setFacilityVisitDayForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="例: 毎月第1・第3週の午前、配薬と残薬確認をまとめて実施"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFacilityVisitDayTarget(null)}
              disabled={facilityVisitDayMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => facilityVisitDayMutation.mutate()}
              disabled={
                facilityVisitDayForm.preferred_weekdays.length === 0 ||
                facilityVisitDayMutation.isPending
              }
            >
              {facilityVisitDayMutation.isPending ? '保存中...' : '定期訪問日を保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preparationTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          closePreparationDialog();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {preparationTarget
                ? `${preparationTarget.case_.patient.name}の訪問準備チェック`
                : '訪問準備チェック'}
            </DialogTitle>
            <DialogDescription>
              {preparationTarget
                ? `${format(parseISO(preparationTarget.scheduled_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })} ${timeLabel(
                    preparationTarget.time_window_start,
                    preparationTarget.time_window_end,
                  )} の訪問です。ready に進む前に、処方差分、持参物、前回課題、ルート、オフライン同期を確認します。`
                : 'ready に進む前に、処方差分、持参物、前回課題、ルート、オフライン同期を確認します。'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {preparationTarget && (
              <section
                aria-labelledby="preparation-target-heading"
                className="rounded-lg border bg-muted/30 px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h3
                      id="preparation-target-heading"
                      className="text-sm font-medium text-foreground"
                    >
                      対象訪問
                    </h3>
                    <p className="font-medium text-foreground">
                      {preparationTarget.case_.patient.name}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {preparationLoading
                      ? '最新確認中'
                      : preparationDetails?.preparation?.prepared_at
                        ? '保存済み'
                        : '未保存'}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {format(parseISO(preparationTarget.scheduled_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    preparationTarget.time_window_start,
                    preparationTarget.time_window_end,
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preparationLoading
                    ? '最新の訪問準備を読み込み中...'
                    : preparationDetails?.preparation?.prepared_at
                      ? `最終更新 ${format(
                          parseISO(preparationDetails.preparation.prepared_at),
                          'yyyy/MM/dd HH:mm',
                          {
                            locale: ja,
                          },
                        )}`
                      : '未保存'}
                </p>
              </section>
            )}
            {getDepartureCarryWarning(preparationTarget) && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900"
              >
                <p className="font-medium">{getDepartureCarryWarning(preparationTarget)?.title}</p>
                <p className="mt-1 leading-6">
                  {getDepartureCarryWarning(preparationTarget)?.description}
                </p>
              </div>
            )}
            <section
              aria-labelledby="preparation-readiness-heading"
              className={cn(
                'rounded-lg border px-3 py-3 text-sm',
                preparationReadiness.packStatusError || preparationReadiness.contextBlockerCount > 0
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : preparationReadiness.incompleteChecklistLabels.length > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 id="preparation-readiness-heading" className="font-medium">
                    ready 判定
                  </h3>
                  <p
                    id="preparation-readiness-summary"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="mt-1 text-xs leading-5"
                  >
                    {preparationReadiness.summaryText}
                  </p>
                </div>
                <Badge variant={preparationReadiness.markReadyDisabled ? 'outline' : 'secondary'}>
                  {preparationReadiness.markReadyDisabled ? 'ready 停止中' : 'ready 可能'}
                </Badge>
              </div>
              {preparationReadiness.packStatusError && !preparationLoading ? (
                <p role="alert" className="mt-2 text-xs leading-5">
                  最新情報を再取得してからreadyへ進めてください。
                </p>
              ) : preparationReadiness.contextBlockerCategories.length > 0 ? (
                <ul
                  id="preparation-readiness-categories"
                  aria-label="ready 停止カテゴリ"
                  className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5"
                >
                  {preparationReadiness.contextBlockerCategories.map((category) => (
                    <li key={category}>{category}</li>
                  ))}
                </ul>
              ) : null}
            </section>
            {preparationDetails?.pack && (
              <section
                aria-labelledby="preparation-pack-heading"
                className="space-y-3 rounded-xl border bg-muted/20 p-4"
              >
                <div className="space-y-1 text-sm">
                  <h3 id="preparation-pack-heading" className="font-medium text-foreground">
                    訪問前提・確認材料
                  </h3>
                  <p className="text-xs leading-5 text-muted-foreground">
                    患者住所、導入準備、算定、処方差分、前回課題を訪問前に確認します。
                  </p>
                </div>

                <section
                  aria-labelledby="preparation-pack-immediate-heading"
                  className="space-y-3 rounded-lg border border-border/70 bg-background px-3 py-3"
                >
                  <div className="space-y-1">
                    <h4
                      id="preparation-pack-immediate-heading"
                      className="text-sm font-medium text-foreground"
                    >
                      訪問前の即時確認
                    </h4>
                    <p className="text-xs leading-5 text-muted-foreground">
                      訪問先、当日負荷、導入準備、ready を止める項目を先に確認します。
                    </p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-foreground">訪問先</p>
                      <p className="text-muted-foreground">
                        {preparationDetails.pack.patient.address ?? '住所未登録'}
                      </p>
                      {preparationDetails.pack.site && (
                        <p className="text-xs text-muted-foreground">
                          拠点: {preparationDetails.pack.site.name}
                        </p>
                      )}
                      {preparationDetails.pack.handoff.summary && (
                        <p className="text-xs leading-6 text-muted-foreground">
                          {preparationDetails.pack.handoff.summary}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-foreground">当日状況</p>
                      <p className="text-muted-foreground">
                        同日担当 {preparationDetails.pack.workload.same_day_visit_count} 件
                      </p>
                      <p className="text-xs text-muted-foreground">
                        施設集約 {preparationDetails.pack.facility_mode.same_day_patient_count} 名
                      </p>
                      <p className="text-xs leading-6 text-muted-foreground">
                        {preparationDetails.pack.facility_mode.same_day_patient_names.join('、')}
                      </p>
                    </div>
                  </div>

                  {preparationReadiness.unresolvedReadinessBlockers.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p className="font-medium">訪問前提の未完了</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4 leading-5">
                        {preparationReadiness.unresolvedReadinessBlockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {preparationDetails.pack.onboarding_readiness ? (
                    <OnboardingWarningBadges
                      readiness={preparationDetails.pack.onboarding_readiness}
                    />
                  ) : (
                    <div
                      role="alert"
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                    >
                      導入準備の状態を確認できません。
                    </div>
                  )}
                </section>

                <section
                  aria-labelledby="preparation-pack-clinical-heading"
                  className="space-y-3 rounded-lg border border-border/70 bg-background px-3 py-3"
                >
                  <div className="space-y-1">
                    <h4
                      id="preparation-pack-clinical-heading"
                      className="text-sm font-medium text-foreground"
                    >
                      臨床・算定確認
                    </h4>
                    <p className="text-xs leading-5 text-muted-foreground">
                      訪問中に記録する薬学的管理、会議引き継ぎ、前回課題、算定と処方差分を確認します。
                    </p>
                  </div>

                  {(() => {
                    const requiredOpenItems = preparationClinicalViewModel?.requiredOpenItems ?? [];

                    return (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-xs text-emerald-950">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">訪問薬剤管理の記録ポイント</p>
                            <p className="mt-1 leading-5 text-emerald-900/80">
                              {preparationClinicalViewModel?.visitTypeLabel ?? '訪問'}
                              で残す薬学的管理、連携、加算要件の証跡です。
                            </p>
                          </div>
                          <Badge variant="outline" className="border-emerald-300 bg-white">
                            訪問中に記録 {requiredOpenItems.length}件
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {requiredOpenItems.length === 0 ? (
                            <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                              記録ポイント確認済み
                            </span>
                          ) : (
                            requiredOpenItems.slice(0, 8).map((item) => (
                              <span
                                key={item.key}
                                className={cn(
                                  'rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium',
                                  item.severity === 'urgent'
                                    ? 'border-rose-200 text-rose-800'
                                    : item.severity === 'high'
                                      ? 'border-amber-200 text-amber-800'
                                      : 'border-emerald-200 text-emerald-800',
                                )}
                              >
                                {item.label}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {preparationDetails.pack.conference_context.length > 0 && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 text-xs text-sky-950">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">会議からの引き継ぎ</p>
                          <p className="mt-1 leading-5 text-sky-900/80">
                            退院前カンファ・担当者会議で決まった内容を訪問前に確認します。
                          </p>
                        </div>
                        <Badge variant="outline" className="border-sky-300 bg-white">
                          {preparationDetails.pack.conference_context.length}件
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {preparationDetails.pack.conference_context.slice(0, 2).map((note) => (
                          <div
                            key={note.id}
                            className="rounded-lg border border-sky-200 bg-white px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-sky-200 px-2 py-0.5 text-[11px] font-medium text-sky-900">
                                {conferenceContextLabel(note.note_type)}
                              </span>
                              <span className="font-medium text-foreground">{note.title}</span>
                            </div>
                            {note.highlights.length > 0 ? (
                              <ul className="mt-2 space-y-1 leading-5 text-sky-950">
                                {note.highlights.slice(0, 3).map((highlight, index) => (
                                  <li key={`${note.id}-${index}`}>・{highlight}</li>
                                ))}
                              </ul>
                            ) : null}
                            {note.action_items.length > 0 ? (
                              <p className="mt-2 leading-5 text-sky-900/80">
                                合意事項: {note.action_items.slice(0, 2).join(' / ')}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preparationDetails.pack.previous_visit && (
                    <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs">
                      <p className="font-medium text-foreground">前回訪問</p>
                      <p className="mt-1 text-muted-foreground">
                        {format(
                          parseISO(preparationDetails.pack.previous_visit.visit_date),
                          'yyyy/MM/dd',
                          { locale: ja },
                        )}{' '}
                        / {preparationDetails.pack.previous_visit.outcome_status}
                      </p>
                      {preparationDetails.pack.previous_visit.soap_plan && (
                        <p className="mt-1 leading-6 text-muted-foreground">
                          {preparationDetails.pack.previous_visit.soap_plan}
                        </p>
                      )}
                    </div>
                  )}

                  {preparationDetails.pack.billing_blockers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">算定ブロッカー</p>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {preparationDetails.pack.billing_blockers.map((blocker) => (
                          <div
                            key={`${blocker.evidence_id}:${blocker.key}`}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900"
                          >
                            <p className="font-medium">{blocker.reason}</p>
                            <p className="mt-1 text-rose-800/80">
                              {blocker.action_label} / {blocker.action_href}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {preparationDetails.pack.prescription_changes && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 text-xs text-sky-950">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">処方差分サマリー</p>
                        <span className="text-[11px] text-sky-800/80">
                          {preparationDetails.pack.prescription_changes.previous_prescribed_date
                            ? `${format(
                                parseISO(
                                  preparationDetails.pack.prescription_changes
                                    .previous_prescribed_date,
                                ),
                                'yyyy/MM/dd',
                                { locale: ja },
                              )} → ${format(
                                parseISO(
                                  preparationDetails.pack.prescription_changes
                                    .current_prescribed_date,
                                ),
                                'yyyy/MM/dd',
                                { locale: ja },
                              )}`
                            : `最新 ${format(
                                parseISO(
                                  preparationDetails.pack.prescription_changes
                                    .current_prescribed_date,
                                ),
                                'yyyy/MM/dd',
                                { locale: ja },
                              )}`}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                          追加 {preparationDetails.pack.prescription_changes.added.length}
                        </span>
                        <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                          変更 {preparationDetails.pack.prescription_changes.changed.length}
                        </span>
                        <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5">
                          中止 {preparationDetails.pack.prescription_changes.removed.length}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-3">
                        <div>
                          <p className="font-medium text-sky-900">追加</p>
                          {preparationDetails.pack.prescription_changes.added.length === 0 ? (
                            <p className="mt-1 text-sky-800/80">なし</p>
                          ) : (
                            <ul className="mt-1 space-y-1 text-sky-900">
                              {preparationDetails.pack.prescription_changes.added
                                .slice(0, 4)
                                .map((drug) => (
                                  <li key={`added-${drug}`}>+ {drug}</li>
                                ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sky-900">変更</p>
                          {preparationDetails.pack.prescription_changes.changed.length === 0 ? (
                            <p className="mt-1 text-sky-800/80">なし</p>
                          ) : (
                            <ul className="mt-1 space-y-1 text-sky-900">
                              {preparationDetails.pack.prescription_changes.changed
                                .slice(0, 4)
                                .map((item) => (
                                  <li key={`changed-${item.drug_name}`}>
                                    {item.drug_name}
                                    <span className="block text-[11px] text-sky-800/80">
                                      {item.reasons.join(' / ')}
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sky-900">中止</p>
                          {preparationDetails.pack.prescription_changes.removed.length === 0 ? (
                            <p className="mt-1 text-sky-800/80">なし</p>
                          ) : (
                            <ul className="mt-1 space-y-1 text-sky-900">
                              {preparationDetails.pack.prescription_changes.removed
                                .slice(0, 4)
                                .map((drug) => (
                                  <li key={`removed-${drug}`}>- {drug}</li>
                                ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <VisitBriefCard
                    brief={preparationDetails.pack.visit_brief}
                    title="訪問要点サマリー"
                    description="処方内容、調剤方法、連携更新を短くまとめています。"
                    compact
                  />

                  <HomeCareFeatureHighlights
                    features={preparationDetails.pack.home_care_feature_highlights}
                    title="訪問時の優先ハイライト"
                    description="訪問支援項目のうち、この訪問で先に見るべきものだけを抽出しています。"
                    emptyText="この訪問で優先表示するハイライトはありません。"
                  />
                </section>

                {(preparationDetails.pack.open_tasks.length > 0 ||
                  preparationDetails.pack.recent_contact_logs.length > 0 ||
                  preparationDetails.pack.care_team.length > 0) && (
                  <section
                    aria-labelledby="preparation-pack-coordination-heading"
                    className="space-y-3 rounded-lg border border-border/70 bg-background px-3 py-3"
                  >
                    <div className="space-y-1">
                      <h4
                        id="preparation-pack-coordination-heading"
                        className="text-sm font-medium text-foreground"
                      >
                        連携・周辺情報
                      </h4>
                      <p className="text-xs leading-5 text-muted-foreground">
                        訪問前に残っているタスク、直近架電、連携先だけをまとめます。
                      </p>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">未処理タスク</p>
                        {preparationDetails.pack.open_tasks.length === 0 ? (
                          <p className="text-xs text-muted-foreground">なし</p>
                        ) : (
                          preparationDetails.pack.open_tasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                            >
                              <p className="font-medium text-foreground">{task.title}</p>
                              {task.due_at && (
                                <p className="mt-1 text-muted-foreground">
                                  期限 {format(parseISO(task.due_at), 'M/d HH:mm', { locale: ja })}
                                </p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">直近架電</p>
                        {preparationDetails.pack.recent_contact_logs.length === 0 ? (
                          <p className="text-xs text-muted-foreground">なし</p>
                        ) : (
                          preparationDetails.pack.recent_contact_logs.map((log) => (
                            <div
                              key={log.id}
                              className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                            >
                              <p className="font-medium text-foreground">
                                {CONTACT_STATUS_LABELS[log.outcome]}
                              </p>
                              <p className="mt-1 leading-6 text-muted-foreground">
                                {log.note ?? 'メモなし'}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">連携先</p>
                        {preparationDetails.pack.care_team.length === 0 ? (
                          <p className="text-xs text-muted-foreground">登録なし</p>
                        ) : (
                          preparationDetails.pack.care_team.slice(0, 4).map((member) => (
                            <div
                              key={member.id}
                              className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                            >
                              <p className="font-medium text-foreground">
                                {member.role} / {member.name}
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                {member.organization_name ?? '所属未登録'}
                                {member.phone ? ` / ${member.phone}` : ''}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </section>
            )}
            <section
              aria-labelledby="preparation-departure-heading"
              className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 lg:grid-cols-[1.1fr_0.9fr]"
            >
              <div className="space-y-1 lg:col-span-2">
                <h3
                  id="preparation-departure-heading"
                  className="text-sm font-medium text-foreground"
                >
                  出発直前確認
                </h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  チェックリストと訪問先ルートを確認してから ready に進めます。
                </p>
              </div>
              <section aria-labelledby="preparation-checklist-heading" className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 id="preparation-checklist-heading" className="text-sm font-medium">
                      出発前チェックリスト
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      未完了が残る間は ready に進めません。
                    </p>
                  </div>
                  <Badge
                    variant={
                      preparationReadiness.incompleteChecklistLabels.length === 0
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {preparationReadiness.completedChecklistCount}/{PREPARATION_ITEMS.length} 完了
                  </Badge>
                </div>
                <p
                  role="status"
                  aria-live="polite"
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs leading-5',
                    preparationReadiness.incompleteChecklistLabels.length === 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900',
                  )}
                >
                  {preparationReadiness.incompleteChecklistLabels.length === 0
                    ? 'チェックリストはすべて完了しています。'
                    : `未完了: ${preparationReadiness.incompleteChecklistLabels.join(' / ')}`}
                </p>
                <div className="grid gap-3">
                  {PREPARATION_ITEMS.map(([field, label]) => {
                    const labelId = `preparation-check-${field}-label`;
                    const descriptionId = `preparation-check-${field}-description`;
                    return (
                      <label
                        key={field}
                        className="flex min-h-11 items-start gap-3 rounded-lg border border-border/70 px-3 py-3 text-sm"
                      >
                        <Checkbox
                          aria-labelledby={labelId}
                          aria-describedby={descriptionId}
                          checked={preparationForm[field as keyof typeof preparationForm]}
                          onCheckedChange={(checked) => {
                            preparationFormDirtyRef.current = true;
                            setPreparationForm((current) => ({
                              ...current,
                              [field]: Boolean(checked),
                            }));
                          }}
                        />
                        <span className="grid gap-0.5">
                          <span id={labelId} className="font-medium">
                            {label}
                          </span>
                          <span
                            id={descriptionId}
                            className="text-xs leading-5 text-muted-foreground"
                          >
                            {PREPARATION_ITEM_DESCRIPTIONS[field]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              {preparationDetails?.pack?.patient.address ? (
                <section
                  aria-labelledby="preparation-map-heading"
                  className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3"
                >
                  <div className="space-y-1">
                    <h4
                      id="preparation-map-heading"
                      className="text-sm font-medium text-foreground"
                    >
                      訪問先マップ
                    </h4>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {preparationDetails.pack.patient.address}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border bg-background">
                    <iframe
                      title="訪問先地図"
                      src={buildMapEmbedUrl(preparationDetails.pack.patient.address)}
                      className="h-56 w-full"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                  <a
                    href={buildDirectionsUrl(preparationDetails.pack.patient.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted/30"
                  >
                    <Navigation className="size-4" aria-hidden="true" />
                    ナビで開く
                  </a>
                </section>
              ) : null}
            </section>
          </div>
          {preparationTarget && (
            <div
              id="preparation-action-target-summary"
              className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground"
            >
              <span className="font-medium text-foreground">最終操作対象:</span>{' '}
              {preparationTarget.case_.patient.name}{' '}
              {format(parseISO(preparationTarget.scheduled_date), 'M/d', {
                locale: ja,
              })}{' '}
              {timeLabel(preparationTarget.time_window_start, preparationTarget.time_window_end)}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closePreparationDialog}
              disabled={preparationMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              variant="outline"
              aria-label={
                preparationTarget
                  ? scheduleActionLabel(preparationTarget, '訪問準備を保存')
                  : undefined
              }
              aria-describedby={preparationTarget ? 'preparation-action-target-summary' : undefined}
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: false,
                })
              }
              disabled={preparationSaveDisabled}
            >
              保存
            </Button>
            <Button
              aria-label={
                preparationTarget
                  ? scheduleActionLabel(preparationTarget, '訪問準備をreadyに進める')
                  : undefined
              }
              aria-describedby={preparationReadyDescriptionIds}
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: true,
                })
              }
              disabled={preparationReadiness.markReadyDisabled}
            >
              ready に進める
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={departureWarningTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDepartureWarningAcknowledged(false);
          setDepartureWarningTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{getDepartureCarryWarning(departureWarningTarget)?.title}</DialogTitle>
            <DialogDescription>
              {getDepartureCarryWarning(departureWarningTarget)?.description}
            </DialogDescription>
          </DialogHeader>
          {departureWarningTarget && (
            <>
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">
                  {departureWarningTarget.case_.patient.name}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {format(parseISO(departureWarningTarget.scheduled_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    departureWarningTarget.time_window_start,
                    departureWarningTarget.time_window_end,
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  持参物ステータス: {departureWarningTarget.carry_items_status}
                </p>
              </div>
              {!canOverrideDepartureCarryWarning(departureWarningTarget) && (
                <p
                  id="departure-warning-resolution"
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  持参物を確定するか代替手配を記録してから、訪問を開始してください。
                </p>
              )}
              {canOverrideDepartureCarryWarning(departureWarningTarget) && (
                <label className="flex min-h-11 items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                  <Checkbox
                    checked={departureWarningAcknowledged}
                    onCheckedChange={(checked) => setDepartureWarningAcknowledged(Boolean(checked))}
                    aria-labelledby="departure-warning-acknowledgement-label"
                  />
                  <span id="departure-warning-acknowledgement-label">
                    未確定の持参物を確認し、代替手配または現地対応方針を確認しました。
                  </span>
                </label>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDepartureWarningAcknowledged(false);
                setDepartureWarningTarget(null);
              }}
            >
              戻る
            </Button>
            {canOverrideDepartureCarryWarning(departureWarningTarget) ? (
              <Button
                variant="destructive"
                onClick={() => {
                  if (!departureWarningTarget) return;
                  router.push(createVisitRecordHref(departureWarningTarget));
                  setDepartureWarningAcknowledged(false);
                  setDepartureWarningTarget(null);
                }}
                disabled={!departureWarningAcknowledged}
              >
                警告を確認して訪問開始
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled
                aria-describedby="departure-warning-resolution"
              >
                持参物を確定してから開始
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
