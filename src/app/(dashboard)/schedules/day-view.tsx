'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  PhoneCall,
  PlayCircle,
  RefreshCw,
  Route,
  Shuffle,
  Navigation,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { HomeCareFeatureHighlights } from '@/components/home-care/home-care-feature-board';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  formatOfflineCacheUpdatedAt,
  isOfflineCacheFresh,
  OFFLINE_CACHE_TTL_HOURS,
} from '@/lib/offline/cache-policy';
import { decryptOfflinePayload, encryptOfflinePayload } from '@/lib/offline/crypto';
import { offlineDb } from '@/lib/stores/offline-db';
import { useOfflineStore } from '@/lib/stores/offline-store';
import {
  discardSyncQueueItem,
  overwriteVisitRecordConflict,
  processSyncQueue,
  setupAutoSync,
} from '@/lib/stores/sync-engine';
import { cn } from '@/lib/utils';
import { VisitCardMobile } from '@/components/features/visits/visit-card-mobile';
import { VisitRoutePreviewPanel } from '@/components/features/visits/visit-route-preview-panel';
import { ScheduleMetricCard } from './schedule-metric-card';
import { applyVisitScheduleRouteUpdates } from './visit-route-client';
import { useRouteOrderDraft } from './route-order-draft';
import {
  buildOrderedFacilityScheduleIds,
  formatEtaLabel,
  formatMinutesLabel,
  minutesFromTimestamp,
  roundDownToSlot,
  roundUpToSlot,
} from './calendar-view.helpers';
import { fetchVisitSchedulesWindow } from './visit-schedule-fetch.helpers';
import {
  addressOfPatient,
  CONTACT_STATUS_LABELS,
  countCompletedPreparationItems,
  formatTaskDueLabel,
  PREPARATION_ITEMS,
  PRIORITY_LABELS,
  priorityBadgeClass,
  readImpactCount,
  readImpactedPatientNames,
  PROPOSAL_STATUS_LABELS,
  SCHEDULE_STATUS_LABELS,
  SCHEDULING_TASK_TYPES,
  statusBadgeClass,
  TASK_TYPE_LABELS,
  taskPriorityClass,
  timeLabel,
  toDateKey,
  type CaseOption,
  type Pharmacist,
  type Proposal,
  type ScheduleTask,
  type ScheduleTaskStatus,
  type VisitPreparation,
  type VisitPreparationPack,
  type VisitPriority,
  type VisitSchedule,
  type VisitType,
  type BillingCadencePreview,
  type BillingRequirementAlert,
  VISIT_TYPE_LABELS,
} from './day-view.shared';
import {
  OnboardingWarningBadges,
  ScheduleBoardSkeleton,
} from './schedule-day-view.chrome';
import {
  buildFacilityRouteDefaults,
  buildFacilityTracker,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  type FacilityTrackerGroup,
  getDepartureCarryWarning,
  proposalLockText,
  scheduleLockText,
  splitTrace,
} from './schedule-day-view.helpers';

type CachedVisitBriefCard = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  scheduledDate: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  priority: VisitPriority;
  facilityLabel: string | null;
  siteName: string | null;
  headline: string;
  mustCheckToday: string[];
  sourceRefs: string[];
  generatedAt: string;
  provider: 'rule' | 'openai';
  isFallback: boolean;
};

type RouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

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

const FACILITY_VISIT_DAY_WEEKDAY_OPTIONS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
];

const GANTT_SLOT_MINUTES = 30;
const GANTT_DEFAULT_START_MINUTES = 8 * 60;
const GANTT_DEFAULT_END_MINUTES = 18 * 60;
type ScheduleDayViewProps = {
  initialSelectedDate?: string;
  initialTab?: 'proposals' | 'confirmed';
  highlightedScheduleId?: string;
};

export function ScheduleDayView({
  initialSelectedDate,
  initialTab = 'proposals',
  highlightedScheduleId,
}: ScheduleDayViewProps = {}) {
  const router = useRouter();
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const queryClient = useQueryClient();
  const [plannerCandidateCountManual, setPlannerCandidateCountManual] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() =>
    initialSelectedDate ?? format(new Date(), 'yyyy-MM-dd')
  );
  const [plannerForm, setPlannerForm] = useState({
    case_id: '',
    visit_type: 'regular' as VisitType,
    priority: 'normal' as VisitPriority,
    start_date: format(new Date(), 'yyyy-MM-dd'),
    preferred_time_from: '09:00',
    preferred_time_to: '12:00',
    candidate_count: '3',
  });
  const [rescheduleTarget, setRescheduleTarget] = useState<VisitSchedule | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    reason: '',
    reason_code: 'other' as
      | 'emergency_insert'
      | 'pharmacist_unavailable'
      | 'patient_request'
      | 'facility_request'
      | 'weather'
      | 'other',
    communication_channel: 'phone' as
      | 'phone'
      | 'fax'
      | 'email'
      | 'collaboration'
      | 'in_person',
    communication_result: 'pending' as 'pending' | 'sent' | 'verbal_notified',
    start_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    priority: 'normal' as VisitPriority,
  });
  const [contactLogTarget, setContactLogTarget] = useState<Proposal | null>(null);
  const [contactLogForm, setContactLogForm] = useState({
    outcome:
      'attempted' as 'attempted' | 'unreachable' | 'declined' | 'change_requested' | 'confirmed',
    contact_method: 'phone' as 'phone' | 'fax' | 'email',
    contact_name: '',
    contact_phone: '',
    note: '',
    callback_due_at: '',
  });
  const [preparationTarget, setPreparationTarget] = useState<VisitSchedule | null>(null);
  const [departureWarningTarget, setDepartureWarningTarget] = useState<VisitSchedule | null>(null);
  const [preparationDetails, setPreparationDetails] = useState<{
    preparation: VisitPreparation | null;
    pack: VisitPreparationPack | null;
  } | null>(null);
  const [preparationLoading, setPreparationLoading] = useState(false);
  const [preparationForm, setPreparationForm] = useState({
    medication_changes_reviewed: false,
    carry_items_confirmed: false,
    previous_issues_reviewed: false,
    route_confirmed: false,
    offline_synced: false,
  });
  const [facilityFilter, setFacilityFilter] = useState<string | null>(null);
  const [facilityRouteOverrides, setFacilityRouteOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const [draggingFacilityPatient, setDraggingFacilityPatient] = useState<{
    groupKey: string;
    scheduleId: string;
  } | null>(null);
  const [facilityVisitDayTarget, setFacilityVisitDayTarget] = useState<{
    key: string;
    label: string;
    scheduleIds: string[];
    patientNames: string[];
  } | null>(null);
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
  const [cachedVisitBriefUpdatedAt, setCachedVisitBriefUpdatedAt] = useState<string | null>(null);
  const [mobileVisitSurface, setMobileVisitSurface] = useState<'list' | 'map'>('list');
  const [selectedRoutePharmacistId, setSelectedRoutePharmacistId] = useState('');
  const [routeTravelMode, setRouteTravelMode] = useState<RouteTravelMode>('DRIVE');
  const preparationRequestIdRef = useRef<string | null>(null);
  const isOffline = useOfflineStore((state) => state.isOffline);
  const pendingSyncCount = useOfflineStore((state) => state.pendingSyncCount);
  const syncConflicts = useOfflineStore((state) => state.syncConflicts);
  const syncOnlineStatus = useOfflineStore((state) => state.syncOnlineStatus);
  const refreshSyncState = useOfflineStore((state) => state.refreshSyncState);

  function handleVisitStart(schedule: VisitSchedule) {
    if (getDepartureCarryWarning(schedule)) {
      setDepartureWarningTarget(schedule);
      return;
    }

    router.push(`/visits/${schedule.id}/record`);
  }

  function handleVisitComplete(schedule: VisitSchedule) {
    router.push(`/visits/${schedule.id}/record`);
  }

  const selectedDay = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const weekStart = useMemo(
    () => startOfWeek(selectedDay, { weekStartsOn: 1 }),
    [selectedDay]
  );
  const weekEnd = useMemo(
    () => endOfWeek(selectedDay, { weekStartsOn: 1 }),
    [selectedDay]
  );
  const visibleDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekEnd, weekStart]
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

  const cases = useMemo(
    () =>
      (casesData?.data ?? []).filter(
        (careCase) => !['discharged', 'terminated'].includes(careCase.status)
      ),
    [casesData]
  );
  const pharmacists = useMemo(() => pharmacistsData?.data ?? [], [pharmacistsData]);
  const proposals = useMemo(() => proposalsData?.data ?? [], [proposalsData]);
  const schedules = useMemo(() => schedulesData?.data ?? [], [schedulesData]);
  const tasks = useMemo(() => tasksData?.data ?? [], [tasksData]);
  const callbackTasks = useMemo(
    () =>
      (callbackTasksData?.data ?? []).filter((task) =>
        ['pending', 'in_progress'].includes(task.status)
      ),
    [callbackTasksData]
  );
  const resolvedPlannerCaseId = plannerForm.case_id || cases[0]?.id || '';
  const selectedCase =
    cases.find((careCase) => careCase.id === resolvedPlannerCaseId) ?? null;
  const selectedPlannerPharmacistId = selectedCase?.primary_pharmacist_id ?? '';
  const pharmacistNameById = useMemo(
    () => new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.name])),
    [pharmacists]
  );
  const proposalById = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal])),
    [proposals]
  );
  const scheduleById = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules]
  );
  const { data: billingPreviewData } = useQuery({
    queryKey: [
      'visit-schedule-billing-preview',
      orgId,
      resolvedPlannerCaseId,
      plannerForm.start_date,
      plannerForm.visit_type,
      selectedPlannerPharmacistId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        case_id: resolvedPlannerCaseId,
        proposed_date: plannerForm.start_date,
      });
      if (plannerForm.visit_type) params.set('visit_type', plannerForm.visit_type);
      if (selectedPlannerPharmacistId) params.set('pharmacist_id', selectedPlannerPharmacistId);
      const res = await fetch(`/api/visit-schedule-proposals/billing-preview?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('算定プレビューの取得に失敗しました');
      return res.json() as Promise<{
        alerts: BillingRequirementAlert[];
        cadence: BillingCadencePreview;
        recommended_visit_type: VisitType;
        recommended_priority: VisitPriority;
        recommended_candidate_count: number;
      }>;
    },
    enabled: !!orgId && !!resolvedPlannerCaseId && !!plannerForm.start_date,
  });
  const billingCadence = billingPreviewData?.cadence ?? null;
  const billingAlerts = billingPreviewData?.alerts ?? [];
  const billedDateSet = useMemo(
    () => new Set(billingCadence?.scheduled_dates_current_month ?? []),
    [billingCadence],
  );
  const suggestedDateSet = useMemo(
    () => new Set(billingCadence?.suggested_dates ?? []),
    [billingCadence],
  );
  const selectedDateProposals = proposals
    .filter((proposal) => toDateKey(proposal.proposed_date) === selectedDate)
    .sort((left, right) => {
      if (left.route_order == null && right.route_order == null) return 0;
      if (left.route_order == null) return 1;
      if (right.route_order == null) return -1;
      return left.route_order - right.route_order;
    });
  const proposalPreviewRequests = useMemo(
    () =>
      selectedDateProposals.map((proposal) => ({
        proposalId: proposal.id,
        caseId: proposal.case_id,
        proposedDate: proposal.proposed_date.slice(0, 10),
        pharmacistId: proposal.proposed_pharmacist_id,
        visitType: proposal.visit_type,
      })),
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
            visit_type: item.visitType,
          })),
        }),
      });
      if (!res.ok) throw new Error('提案の算定プレビュー取得に失敗しました');
      const payload = (await res.json()) as {
        data: Record<
          string,
          {
            alerts: BillingRequirementAlert[];
            cadence: BillingCadencePreview;
            recommended_visit_type: VisitType;
            recommended_priority: VisitPriority;
            recommended_candidate_count: number;
          }
        >;
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
            task.task_type !== 'visit_contact_followup'
        )
        .slice(0, 6),
    [tasks]
  );

  const weekProposalStats = useMemo(() => {
    return {
      approvalPending: proposals.filter((proposal) =>
        ['proposed', 'reschedule_pending'].includes(proposal.proposal_status)
      ).length,
      contactPending: proposals.filter(
        (proposal) => proposal.proposal_status === 'patient_contact_pending'
      ).length,
      confirmedSchedules: schedules.filter((schedule) => schedule.confirmed_at).length,
      lockedSchedules: schedules.filter((schedule) => Boolean(schedule.confirmed_at)).length,
      pendingOverrides: schedules.filter(
        (schedule) => schedule.override_request?.status === 'pending'
      ).length,
      emergencyImpacts:
        proposals.filter((proposal) => proposal.priority === 'emergency').length +
        schedules.filter((schedule) => schedule.priority === 'emergency').length,
      fallbackAssignments:
        proposals.filter((proposal) => proposal.assignment_mode === 'fallback').length +
        schedules.filter((schedule) => schedule.assignment_mode === 'fallback').length,
    };
  }, [proposals, schedules]);

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

  const selectedDateSchedules = schedules
    .filter((schedule) => toDateKey(schedule.scheduled_date) === selectedDate)
    .sort((left, right) => {
      const leftTime = left.time_window_start ?? '';
      const rightTime = right.time_window_start ?? '';
      return leftTime.localeCompare(rightTime);
    });
  const effectivePlannerCandidateCount =
    !plannerCandidateCountManual && billingPreviewData?.recommended_candidate_count
      ? String(billingPreviewData.recommended_candidate_count)
      : plannerForm.candidate_count;
  const schedulePreviewRequests = useMemo(
    () =>
      selectedDateSchedules.map((schedule) => ({
        scheduleId: schedule.id,
        caseId: schedule.case_id,
        proposedDate: schedule.scheduled_date.slice(0, 10),
        pharmacistId: schedule.pharmacist_id,
        visitType: schedule.visit_type,
      })),
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
            visit_type: item.visitType,
          })),
        }),
      });
      if (!res.ok) throw new Error('確定予定の算定プレビュー取得に失敗しました');
      const payload = (await res.json()) as {
        data: Record<
          string,
          {
            alerts: BillingRequirementAlert[];
            cadence: BillingCadencePreview;
            recommended_visit_type: VisitType;
            recommended_priority: VisitPriority;
            recommended_candidate_count: number;
          }
        >;
      };
      return new Map(Object.entries(payload.data));
    },
    enabled: !!orgId && schedulePreviewRequests.length > 0,
  });
  const facilityTracker = useMemo(
    () => buildFacilityTracker(selectedDateSchedules),
    [selectedDateSchedules]
  );
  const facilityRouteDefaults = useMemo(
    () => buildFacilityRouteDefaults(facilityTracker),
    [facilityTracker]
  );
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
  const activeFacilityFilter =
    facilityFilter && facilityTracker.some((group) => group.key === facilityFilter)
      ? facilityFilter
      : null;

  function reorderFacilityPatients(
    group: FacilityTrackerGroup,
    draggedScheduleId: string,
    targetScheduleId: string
  ) {
    const routeDraft = {
      ...(facilityRouteDefaults[group.key] ?? {}),
      ...(facilityRouteOverrides[group.key] ?? {}),
    };
    const orderedScheduleIds = buildOrderedFacilityScheduleIds(group, routeDraft);
    const draggedIndex = orderedScheduleIds.indexOf(draggedScheduleId);
    const targetIndex = orderedScheduleIds.indexOf(targetScheduleId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) {
      return;
    }

    const nextOrdered = [...orderedScheduleIds];
    const [moved] = nextOrdered.splice(draggedIndex, 1);
    nextOrdered.splice(targetIndex, 0, moved);

    setFacilityRouteOverrides((prev) => ({
      ...prev,
      [group.key]: Object.fromEntries(
        nextOrdered.map((scheduleId, index) => [scheduleId, String(index + 1)])
      ),
    }));
  }

  const visibleSchedules = useMemo(() => {
    if (!activeFacilityFilter) return selectedDateSchedules;
    return selectedDateSchedules.filter((schedule) => {
      const facilityLabel =
        schedule.facility_hint?.label ?? schedule.case_.patient.residences[0]?.address ?? null;
      const key = [
        schedule.site?.id ?? 'site:none',
        schedule.facility_batch_id ?? 'batch:none',
        facilityLabel ?? 'facility:none',
      ].join(':');
      return key === activeFacilityFilter;
    });
  }, [activeFacilityFilter, selectedDateSchedules]);
  const cachedVisitBriefByScheduleId = useMemo(
    () => new Map(cachedVisitBriefs.map((item) => [item.scheduleId, item])),
    [cachedVisitBriefs]
  );
  const mobileVisitSchedules = useMemo(
    () =>
      [...visibleSchedules].sort((left, right) => {
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
      }),
    [visibleSchedules]
  );
  const routePharmacistOptions = useMemo(
    () =>
      Array.from(
        new Map(
          visibleSchedules.map((schedule) => [
            schedule.pharmacist_id,
            {
              id: schedule.pharmacist_id,
              name:
                pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録',
              siteName: schedule.site?.name ?? null,
            },
          ]),
        ).values(),
      ),
    [pharmacistNameById, visibleSchedules],
  );
  const resolvedRoutePharmacistId =
    routePharmacistOptions.some((option) => option.id === selectedRoutePharmacistId)
      ? selectedRoutePharmacistId
      : routePharmacistOptions[0]?.id ?? '';
  const routeMapSchedules = useMemo(
    () =>
      visibleSchedules.filter(
        (schedule) => schedule.pharmacist_id === resolvedRoutePharmacistId,
      ),
    [resolvedRoutePharmacistId, visibleSchedules],
  );
  const currentOrderedRouteScheduleIds = useMemo(
    () =>
      [...routeMapSchedules]
        .sort((left, right) => {
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
        })
        .map((schedule) => schedule.id),
    [routeMapSchedules],
  );
  const routeDepartureTime =
    routeMapSchedules
      .map((schedule) => schedule.time_window_start)
      .find((value): value is string => Boolean(value)) ?? null;
  const { data: routePlanData, isFetching: routePlanLoading } = useQuery({
    queryKey: [
      'visit-route-plan',
      orgId,
      selectedDate,
      resolvedRoutePharmacistId,
      routeTravelMode,
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
          travel_mode: routeTravelMode,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'ルート最適化の取得に失敗しました');
      }
      return (res.json() as Promise<{ data: VisitRoutePlan }>).then((payload) => payload.data ?? null);
    },
    enabled:
      !!orgId &&
      !!resolvedRoutePharmacistId &&
      currentOrderedRouteScheduleIds.length > 0,
  });
  const routePlanByScheduleId = useMemo(
    () =>
      new Map(
        (routePlanData?.stopSummaries ?? []).map((item) => [item.scheduleId, item]),
      ),
    [routePlanData],
  );
  const routeOrderDraft = useRouteOrderDraft({
    sourceKey: `${selectedDate}:${resolvedRoutePharmacistId}:${routeTravelMode}:${routePlanData?.orderedScheduleIds.join(',') ?? ''}:${currentOrderedRouteScheduleIds.join(',')}`,
    optimizedIds: routePlanData?.orderedScheduleIds ?? currentOrderedRouteScheduleIds,
    currentIds: currentOrderedRouteScheduleIds,
  });
  const routeMapPoints = useMemo(() => {
    const schedulesById = new Map(routeMapSchedules.map((schedule) => [schedule.id, schedule]));
    const orderedIds = routeOrderDraft.draftIds;

    return orderedIds
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
          etaLabel: routeOrderDraft.manualDirty
            ? null
            : formatEtaLabel(
                selectedDate,
                routeDepartureTime,
                routePlanByScheduleId.get(scheduleId)?.arrivalOffsetSeconds ?? null,
                schedule.time_window_start,
              ),
        };
      })
      .filter(
        (
          point,
        ): point is NonNullable<typeof point> => point !== null,
      );
  }, [
    routeMapSchedules,
    routeOrderDraft.draftIds,
    routeOrderDraft.manualDirty,
    routeDepartureTime,
    routePlanByScheduleId,
    selectedDate,
  ]);
  const routeMapSite = useMemo(() => {
    const site = routeMapSchedules[0]?.site;
    if (!site || site.lat == null || site.lng == null) return null;
    return {
      name: site.name,
      lat: site.lat,
      lng: site.lng,
    };
  }, [routeMapSchedules]);
  const routeSelectionLabel =
    routePharmacistOptions.find((option) => option.id === resolvedRoutePharmacistId)
      ? `${routePharmacistOptions.find((option) => option.id === resolvedRoutePharmacistId)?.name ?? resolvedRoutePharmacistId} / ${selectedDate}`
      : null;
  const routeOptimizationDirty =
    routeOrderDraft.differsFromCurrent;
  const ganttWindow = useMemo(() => {
    if (visibleSchedules.length === 0) {
      return {
        startMinutes: GANTT_DEFAULT_START_MINUTES,
        endMinutes: GANTT_DEFAULT_END_MINUTES,
      };
    }

    let earliest = GANTT_DEFAULT_END_MINUTES;
    let latest = GANTT_DEFAULT_START_MINUTES;

    for (const schedule of visibleSchedules) {
      const startMinutes = minutesFromTimestamp(
        schedule.time_window_start,
        GANTT_DEFAULT_START_MINUTES
      );
      const endMinutes = minutesFromTimestamp(
        schedule.time_window_end,
        startMinutes + 60
      );
      earliest = Math.min(earliest, startMinutes);
      latest = Math.max(latest, endMinutes);
    }

    return {
      startMinutes: Math.max(
        6 * 60,
        roundDownToSlot(earliest - GANTT_SLOT_MINUTES, GANTT_SLOT_MINUTES)
      ),
      endMinutes: Math.min(
        22 * 60,
        roundUpToSlot(latest + GANTT_SLOT_MINUTES, GANTT_SLOT_MINUTES)
      ),
    };
  }, [visibleSchedules]);
  const ganttSlots = useMemo(() => {
    const slots: number[] = [];
    for (
      let minutes = ganttWindow.startMinutes;
      minutes < ganttWindow.endMinutes;
      minutes += GANTT_SLOT_MINUTES
    ) {
      slots.push(minutes);
    }
    return slots;
  }, [ganttWindow.endMinutes, ganttWindow.startMinutes]);
  const ganttColumns = useMemo(() => {
    const columns = new Map<
      string,
      {
        pharmacistId: string;
        pharmacistName: string;
        siteName: string | null;
        schedules: Array<
          VisitSchedule & {
            blockStartMinutes: number;
            blockEndMinutes: number;
          }
        >;
      }
    >();

    for (const schedule of visibleSchedules) {
      const existing = columns.get(schedule.pharmacist_id) ?? {
        pharmacistId: schedule.pharmacist_id,
        pharmacistName:
          pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録',
        siteName: schedule.site?.name ?? null,
        schedules: [],
      };

      const blockStartMinutes = minutesFromTimestamp(
        schedule.time_window_start,
        ganttWindow.startMinutes
      );
      const blockEndMinutes = Math.max(
        blockStartMinutes + GANTT_SLOT_MINUTES,
        minutesFromTimestamp(
          schedule.time_window_end,
          blockStartMinutes + GANTT_SLOT_MINUTES * 2
        )
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
      .sort((left, right) =>
        left.pharmacistName.localeCompare(right.pharmacistName, 'ja')
      );
  }, [ganttWindow.startMinutes, pharmacistNameById, visibleSchedules]);
  const ganttTableColumns = useMemo(
    () =>
      ganttColumns.map((column) => {
        const scheduleStarts = new Map<
          number,
          {
            schedule: VisitSchedule & {
              blockStartMinutes: number;
              blockEndMinutes: number;
            };
            span: number;
          }
        >();
        const coveredSlots = new Set<number>();

        for (const schedule of column.schedules) {
          const startIndex = Math.max(
            0,
            Math.floor((schedule.blockStartMinutes - ganttWindow.startMinutes) / GANTT_SLOT_MINUTES)
          );
          const endIndex = Math.min(
            ganttSlots.length,
            Math.max(
              startIndex + 1,
              Math.ceil((schedule.blockEndMinutes - ganttWindow.startMinutes) / GANTT_SLOT_MINUTES)
            )
          );
          const span = Math.max(1, endIndex - startIndex);

          scheduleStarts.set(startIndex, { schedule, span });
          for (let index = startIndex + 1; index < startIndex + span; index += 1) {
            coveredSlots.add(index);
          }
        }

        return {
          ...column,
          scheduleStarts,
          coveredSlots,
        };
      }),
    [ganttColumns, ganttSlots.length, ganttWindow.startMinutes]
  );

  function ganttBlockClass(
    schedule: VisitSchedule & {
      blockStartMinutes: number;
      blockEndMinutes: number;
    }
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

  useEffect(() => {
    let active = true;
    void offlineDb.visitBriefCache
      .where('scheduledDate')
      .equals(selectedDate)
      .toArray()
      .then(async (rows) => {
        if (!active) return;
        const freshRows = rows.filter((row) => isOfflineCacheFresh(row.updatedAt));
        const staleRows = rows.filter((row) => !isOfflineCacheFresh(row.updatedAt));

        await Promise.all(staleRows.map((row) => row.id && offlineDb.visitBriefCache.delete(row.id)));

        const decoded = await Promise.all(
          freshRows.map(async (row) => {
            const payload = await decryptOfflinePayload(row.payload);
            if (!payload) return null;
            try {
              return {
                row,
                payload: JSON.parse(payload) as CachedVisitBriefCard,
              };
            } catch {
              return null;
            }
          })
        );

        const usableRows = decoded.filter(
          (
            item
          ): item is { row: import('@/lib/stores/offline-db').OfflineVisitBriefCache; payload: CachedVisitBriefCard } =>
            item !== null
        );
        setCachedVisitBriefs(
          usableRows
            .map((item) => item.payload)
            .sort((left, right) =>
              (left.timeWindowStart ?? '').localeCompare(right.timeWindowStart ?? '')
            )
        );
        const latestUpdatedAt = usableRows.reduce<Date | null>(
          (latest, item) =>
            !latest || item.row.updatedAt > latest ? item.row.updatedAt : latest,
          null
        );
        setCachedVisitBriefUpdatedAt(formatOfflineCacheUpdatedAt(latestUpdatedAt));
      });

    return () => {
      active = false;
    };
  }, [selectedDate]);

  useEffect(() => {
    if (!orgId || selectedDateSchedules.length === 0) return;

    let cancelled = false;
    void Promise.all(
      selectedDateSchedules.map(async (schedule) => {
        const res = await fetch(`/api/visit-preparations/${schedule.id}/brief`, {
          headers: { 'x-org-id': orgId },
        });
        if (!res.ok) return null;
        const payload = (await res.json()) as {
          data: {
            ai_summary: {
              headline: string;
              must_check_today: string[];
              source_refs: string[];
              generated_at: string;
              provider: 'rule' | 'openai';
              is_fallback: boolean;
            };
          };
        };
        const snapshot: CachedVisitBriefCard = {
          scheduleId: schedule.id,
          patientId: schedule.case_.patient.id,
          patientName: schedule.case_.patient.name,
          scheduledDate: selectedDate,
          timeWindowStart: schedule.time_window_start,
          timeWindowEnd: schedule.time_window_end,
          priority: schedule.priority,
          facilityLabel:
            schedule.facility_hint?.label ??
            schedule.case_.patient.residences[0]?.address ??
            null,
          siteName: schedule.site?.name ?? null,
          headline: payload.data.ai_summary.headline,
          mustCheckToday: payload.data.ai_summary.must_check_today,
          sourceRefs: payload.data.ai_summary.source_refs,
          generatedAt: payload.data.ai_summary.generated_at,
          provider: payload.data.ai_summary.provider,
          isFallback: payload.data.ai_summary.is_fallback,
        };

        await offlineDb.visitBriefCache
          .where('scheduleId')
          .equals(schedule.id)
          .delete();
        await offlineDb.visitBriefCache.add({
          scheduleId: schedule.id,
          patientId: schedule.case_.patient.id,
          scheduledDate: selectedDate,
          payload: await encryptOfflinePayload(JSON.stringify(snapshot)),
          updatedAt: new Date(),
        });

        return snapshot;
      })
    ).then((items) => {
      if (cancelled) return;
      const filtered = items.filter((item): item is CachedVisitBriefCard => Boolean(item));
      if (filtered.length > 0) {
        setCachedVisitBriefs(
          filtered.sort((left, right) =>
            (left.timeWindowStart ?? '').localeCompare(right.timeWindowStart ?? '')
          )
        );
        setCachedVisitBriefUpdatedAt(new Date().toISOString());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [orgId, selectedDate, selectedDateSchedules]);

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
    setContactLogTarget(proposal);
    const latestLog = proposal.contact_logs[0] ?? null;
    setContactLogForm({
      outcome:
        proposal.patient_contact_status === 'confirmed'
          ? 'confirmed'
          : proposal.patient_contact_status === 'declined'
            ? 'declined'
            : proposal.patient_contact_status === 'change_requested'
              ? 'change_requested'
            : proposal.patient_contact_status === 'unreachable'
              ? 'unreachable'
              : 'attempted',
      contact_method:
        latestLog?.contact_method === 'fax' || latestLog?.contact_method === 'email'
          ? latestLog.contact_method
          : 'phone',
      contact_name: latestLog?.contact_name ?? '',
      contact_phone: latestLog?.contact_phone ?? '',
      note: '',
      callback_due_at: latestLog?.callback_due_at
        ? format(parseISO(latestLog.callback_due_at), "yyyy-MM-dd'T'HH:mm")
        : '',
    });
  }

  function openPreparationDialog(schedule: VisitSchedule) {
    const initialPreparation = schedule.preparation ?? null;
    const scheduleId = schedule.id;
    preparationRequestIdRef.current = scheduleId;
    setPreparationTarget(schedule);
    setPreparationDetails({
      preparation: initialPreparation,
      pack: null,
    });
    setPreparationForm({
      medication_changes_reviewed: initialPreparation?.medication_changes_reviewed ?? false,
      carry_items_confirmed: initialPreparation?.carry_items_confirmed ?? false,
      previous_issues_reviewed: initialPreparation?.previous_issues_reviewed ?? false,
      route_confirmed: initialPreparation?.route_confirmed ?? false,
      offline_synced: initialPreparation?.offline_synced ?? false,
    });

    if (!orgId) return;

    setPreparationLoading(true);
    void fetch(`/api/visit-preparations/${scheduleId}`, {
      headers: { 'x-org-id': orgId },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('訪問準備情報の取得に失敗しました');
        return (res.json() as Promise<{
          data: {
            preparation: VisitPreparation | null;
            pack: VisitPreparationPack | null;
          };
        }>).then((payload) => payload.data);
      })
      .then((payload) => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        setPreparationDetails(payload);
        setPreparationForm({
          medication_changes_reviewed:
            payload.preparation?.medication_changes_reviewed ?? false,
          carry_items_confirmed:
            payload.preparation?.carry_items_confirmed ?? false,
          previous_issues_reviewed:
            payload.preparation?.previous_issues_reviewed ?? false,
          route_confirmed: payload.preparation?.route_confirmed ?? false,
          offline_synced: payload.preparation?.offline_synced ?? false,
        });
      })
      .catch((error) => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        toast.error(
          error instanceof Error ? error.message : '訪問準備情報の取得に失敗しました'
        );
      })
      .finally(() => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        setPreparationLoading(false);
      });
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          case_id: resolvedPlannerCaseId,
          visit_type: plannerForm.visit_type,
          priority: plannerForm.priority,
          travel_mode: routeTravelMode,
          start_date: plannerForm.start_date,
          preferred_time_from: plannerForm.preferred_time_from || undefined,
          preferred_time_to: plannerForm.preferred_time_to || undefined,
          candidate_count: Number(effectivePlannerCandidateCount),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '候補生成に失敗しました');
      }
      return res.json() as Promise<{ data: Proposal[]; alerts?: BillingRequirementAlert[] }>;
    },
    onSuccess: async (data) => {
      toast.success(`${data.data.length}件の訪問候補を生成しました`);
      if ((data.alerts?.length ?? 0) > 0) {
        const warningMessages = data.alerts
          ?.filter((alert) => alert.severity !== 'info')
          .map((alert) => alert.message) ?? [];
        if (warningMessages.length > 0) {
          toast.warning('算定アラート', {
            description: warningMessages.slice(0, 2).join(' / '),
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] });
      setSelectedDate(plannerForm.start_date);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補生成に失敗しました');
    },
  });

  const proposalActionMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload:
        | { action: 'approve' }
        | { action: 'confirm' }
        | { action: 'reject' }
        | {
            action: 'contact_attempt';
            outcome: 'attempted' | 'declined' | 'change_requested' | 'unreachable' | 'confirmed';
            contact_method: 'phone' | 'fax' | 'email';
            contact_name?: string;
            contact_phone?: string;
            note?: string;
            callback_due_at?: string;
          };
    }) => {
      const res = await fetch(`/api/visit-schedule-proposals/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '候補更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      const message =
        variables.payload.action === 'approve'
          ? '候補を承認して架電待ちへ移しました'
          : variables.payload.action === 'confirm'
            ? '電話確認が完了し、訪問予定を確定しました'
            : variables.payload.action === 'reject'
              ? '候補を却下しました'
              : variables.payload.outcome === 'change_requested'
                ? '変更希望として記録しました'
              : variables.payload.outcome === 'declined'
                ? '患者辞退として記録しました'
              : variables.payload.outcome === 'unreachable'
                ? '不通として記録しました'
                : variables.payload.outcome === 'confirmed'
                  ? '患者確認済みとして記録しました'
                  : '架電状況を更新しました';

      toast.success(message);
      if (variables.payload.action === 'contact_attempt') {
        setContactLogTarget(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['tasks', 'visit-contact-followup', orgId],
        }),
      ]);
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
          : '再架電タスクを対応中にしました'
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
    mutationFn: async ({
      scheduleId,
      markReady,
    }: {
      scheduleId: string;
      markReady: boolean;
    }) => {
      const preparationRes = await fetch(`/api/visit-preparations/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          checklist: preparationForm,
          ...preparationForm,
        }),
      });
      if (!preparationRes.ok) {
        const error = await preparationRes.json().catch(() => ({}));
        throw new Error(error.message ?? '訪問準備の保存に失敗しました');
      }

      if (markReady) {
        const readyRes = await fetch(`/api/visit-schedules/${scheduleId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            schedule_status: 'ready',
          }),
        });
        if (!readyRes.ok) {
          const error = await readyRes.json().catch(() => ({}));
          throw new Error(error.message ?? '訪問予定を ready に更新できませんでした');
        }
      }

      return preparationRes.json();
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.markReady
          ? '訪問準備を保存し、ready へ進めました'
          : '訪問準備を保存しました'
      );
      preparationRequestIdRef.current = null;
      setPreparationLoading(false);
      setPreparationDetails(null);
      setPreparationTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
      ]);
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
      const group = facilityTracker.find((candidate) => candidate.key === groupKey);
      if (!group) {
        throw new Error('施設グループが見つかりません');
      }

      const routeDraft = {
        ...(facilityRouteDefaults[group.key] ?? {}),
        ...(facilityRouteOverrides[group.key] ?? {}),
      };
      const orderedScheduleIds = buildOrderedFacilityScheduleIds(group, routeDraft);

      const res = await fetch('/api/facility-visit-batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          schedule_ids: group.scheduleIds,
          ordered_schedule_ids: orderedScheduleIds,
          carry_items_confirmed: carryItemsConfirmed,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '施設一括訪問の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.carryItemsConfirmed
          ? '施設バッチの順序と持参確認を保存しました'
          : '施設バッチの順序を保存しました'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '施設一括訪問の保存に失敗しました'
      );
    },
  });

  const facilityVisitDayMutation = useMutation({
    mutationFn: async () => {
      if (!facilityVisitDayTarget) {
        throw new Error('施設グループが選択されていません');
      }

      const res = await fetch('/api/facility-visit-batches/visit-days', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          facility_label: facilityVisitDayTarget.label,
          schedule_ids: facilityVisitDayTarget.scheduleIds,
          preferred_weekdays: facilityVisitDayForm.preferred_weekdays,
          preferred_time_from: facilityVisitDayForm.preferred_time_from || null,
          preferred_time_to: facilityVisitDayForm.preferred_time_to || null,
          facility_time_from: facilityVisitDayForm.facility_time_from || null,
          facility_time_to: facilityVisitDayForm.facility_time_to || null,
          visit_buffer_minutes: facilityVisitDayForm.visit_buffer_minutes
            ? Number(facilityVisitDayForm.visit_buffer_minutes)
            : null,
          notes: facilityVisitDayForm.notes || null,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '施設訪問日の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('施設単位の定期訪問日を保存しました');
      setFacilityVisitDayTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '施設訪問日の保存に失敗しました');
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!rescheduleTarget) throw new Error('リスケ対象が選択されていません');

      const res = await fetch(`/api/visit-schedules/${rescheduleTarget.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(rescheduleForm),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'リスケ候補の生成に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('リスケ候補を生成しました');
      setRescheduleTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
      ]);
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
      if (!routePlanData || routeOrderDraft.draftIds.length === 0) {
        throw new Error('反映できる最適ルートがありません');
      }

      await applyVisitScheduleRouteUpdates({
        orgId,
        updates: routeOrderDraft.draftIds.map((scheduleId, index) => ({
          scheduleId,
          route_order: index + 1,
        })),
      });
    },
    onSuccess: async () => {
      toast.success('Google Routes API の順序を route_order に反映しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-route-plan', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : '最適順序の反映に失敗しました',
      );
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
        itemId
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

  if (isScheduleBoardLoading) {
    return <ScheduleBoardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <ScheduleMetricCard
          title="承認待ち"
          value={weekProposalStats.approvalPending}
          description="担当者が候補を確認する必要があります"
          icon={CalendarClock}
        />
        <ScheduleMetricCard
          title="架電待ち"
          value={weekProposalStats.contactPending}
          description="患者連絡で日時を確定させる段階です"
          icon={PhoneCall}
        />
        <ScheduleMetricCard
          title="確定訪問"
          value={weekProposalStats.confirmedSchedules}
          description="電話確定済みで原則変更しない予定です"
          icon={CheckCircle2}
        />
        <ScheduleMetricCard
          title="代替割当"
          value={weekProposalStats.fallbackAssignments}
          description="担当薬剤師不在のため他薬剤師へエスカレーション"
          icon={Shuffle}
        />
        <ScheduleMetricCard
          title="変更承認待ち"
          value={weekProposalStats.pendingOverrides}
          description="確定後の変更は専用リスケで管理します"
          icon={RefreshCw}
        />
        <ScheduleMetricCard
          title="緊急影響"
          value={weekProposalStats.emergencyImpacts}
          description="緊急訪問や割込対応の影響を見える化"
          icon={AlertTriangle}
        />
        <ScheduleMetricCard
          title="確定ロック"
          value={weekProposalStats.lockedSchedules}
          description="電話確定済みで原則変更しません"
          icon={CheckCircle2}
        />
      </section>

      <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(245,248,255,1),rgba(248,250,252,1))] ring-1 ring-slate-200">
        <CardContent className="grid gap-5 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Weekly Route Board
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              候補生成から電話確定までを一画面で管理
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              服薬最終日より前の訪問候補を自動生成し、患者住所と既存訪問順から
              ルート効率を加味して提案します。確定後は専用のリスケジュール操作以外で
              変更しません。
            </p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">対象週</span>
              <span className="font-medium text-slate-900">
                {format(weekStart, 'M/d', { locale: ja })} - {format(weekEnd, 'M/d', { locale: ja })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">選択日</span>
              <span className="font-medium text-slate-900">
                {format(selectedDay, 'yyyy年M月d日(E)', { locale: ja })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">担当薬剤師</span>
              <span className="font-medium text-slate-900">
                {selectedCase?.primary_pharmacist_name ?? '未設定'}
              </span>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              電話で患者合意が取れた候補のみ確定できます。確定後の変更は
              リスケジュール操作で行います。
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-base">週間スケジュール</CardTitle>
            <CardDescription>
              候補件数と確定件数を見ながら日別に切り替えます
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setSelectedDate(format(addDays(selectedDay, -7), 'yyyy-MM-dd'))
                }
                aria-label="前週"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Input
                type="date"
                className="w-[160px]"
                value={selectedDate}
                aria-label="週間スケジュールの対象日"
                onChange={(event) => setSelectedDate(event.target.value)}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setSelectedDate(format(addDays(selectedDay, 7), 'yyyy-MM-dd'))
                }
                aria-label="翌週"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const proposalCount = proposals.filter(
                  (proposal) => toDateKey(proposal.proposed_date) === dateKey
                ).length;
                const scheduleCount = schedules.filter(
                  (schedule) => toDateKey(schedule.scheduled_date) === dateKey
                ).length;
                const isSelected = dateKey === selectedDate;
                const isBillableHistoryDate = billedDateSet.has(dateKey);
                const isNextBillableDate = billingCadence?.next_billable_date === dateKey;
                const isSuggestedBillableDate = suggestedDateSet.has(dateKey);

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => setSelectedDate(dateKey)}
                    className={[
                      'min-w-[92px] rounded-xl border px-3 py-2 text-left transition',
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-border bg-background hover:border-slate-400',
                    ].join(' ')}
                  >
                    <div className="text-xs">
                      {format(day, 'M/d(E)', { locale: ja })}
                    </div>
                    <div className="mt-1 text-[11px] opacity-80">
                      候補 {proposalCount} / 確定 {scheduleCount}
                    </div>
                    {(isBillableHistoryDate || isNextBillableDate) && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {isBillableHistoryDate && (
                          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-slate-700">
                            算定済
                          </span>
                        )}
                        {isNextBillableDate && (
                          <span className="rounded bg-emerald-200/80 px-1.5 py-0.5 text-emerald-900">
                            次回算定可
                          </span>
                        )}
                        {!isNextBillableDate && isSuggestedBillableDate && (
                          <span className="rounded bg-sky-200/80 px-1.5 py-0.5 text-sky-900">
                            候補日
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
      </Card>

      <section className="space-y-3 md:hidden" aria-labelledby="mobile-visit-list-heading">
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="mobile-visit-list-heading"
              className="text-base font-semibold text-foreground"
            >
              本日の訪問リスト
            </h2>
            <p className="text-xs text-muted-foreground">
              右スワイプで開始、訪問中は左スワイプで記録画面へ進みます
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{mobileVisitSchedules.length}件</Badge>
            <div className="inline-flex rounded-lg border border-border bg-background p-1">
              <button
                type="button"
                className={[
                  'rounded-md px-2.5 py-1 text-xs transition',
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
                className={[
                  'rounded-md px-2.5 py-1 text-xs transition',
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
        </div>

        {mobileVisitSchedules.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {format(selectedDay, 'M月d日(E)', { locale: ja })} の訪問予定はありません
            </CardContent>
          </Card>
        ) : mobileVisitSurface === 'map' ? (
          <VisitRoutePreviewPanel
            controlId="day-mobile-route"
            title="日次ルートマップ"
            description="薬局から訪問先までの経路を確認し、そのまま route_order へ反映できます。"
            selectionLabel={routeSelectionLabel}
            travelMode={routeTravelMode}
            onTravelModeChange={(value) => setRouteTravelMode(value as RouteTravelMode)}
            plan={routePlanData}
            points={routeMapPoints}
            site={routeMapSite}
            orderedIds={routeOrderDraft.draftIds}
            currentOrderedIds={routeOrderDraft.currentIds}
            onMoveItem={(scheduleId, direction) => routeOrderDraft.moveItem(scheduleId, direction)}
            headerControls={
              <>
                <div className="space-y-1">
                  <Label htmlFor="mobile-route-pharmacist" className="text-xs">
                    対象薬剤師
                  </Label>
                  <Select
                    value={resolvedRoutePharmacistId}
                    onValueChange={(value) => setSelectedRoutePharmacistId(value ?? '')}
                  >
                    <SelectTrigger id="mobile-route-pharmacist" className="w-[12rem]">
                      <SelectValue placeholder="薬剤師を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {routePharmacistOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                          {option.siteName ? ` / ${option.siteName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {routeOrderDraft.manualDirty ? (
                  <Button type="button" size="sm" variant="outline" onClick={routeOrderDraft.resetToOptimized}>
                    最適順へ戻す
                  </Button>
                ) : null}
              </>
            }
            loading={routePlanLoading}
            actionLabel="最適順を route_order に反映"
            actionDisabled={
              routePlanLoading ||
              applyOptimizedRouteMutation.isPending ||
              !routeOptimizationDirty
            }
            actionPending={applyOptimizedRouteMutation.isPending}
            onAction={() => applyOptimizedRouteMutation.mutate()}
            extraSummary={
              routeOrderDraft.diffCount > 0 ? (
                <Badge variant="outline">差分 {routeOrderDraft.diffCount} 件</Badge>
              ) : null
            }
          />
        ) : (
          mobileVisitSchedules.map((schedule) => {
            const brief = cachedVisitBriefByScheduleId.get(schedule.id);
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
                status={schedule.schedule_status}
                carryItemsStatus={schedule.carry_items_status}
                mustCheckToday={brief?.mustCheckToday ?? []}
                onStartVisit={() => handleVisitStart(schedule)}
                onCompleteVisit={() => handleVisitComplete(schedule)}
              />
            );
          })
        )}
      </section>

      {(isOffline || pendingSyncCount > 0 || cachedVisitBriefs.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudOff className="size-4 text-amber-600" aria-hidden="true" />
                モバイル訪問モード
              </CardTitle>
              <CardDescription>
                オフライン時は read-only キャッシュだけを使い、朝の事前同期状況もここで確認します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge
                  variant="outline"
                  className={
                    isOffline
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }
                >
                  {isOffline ? 'オフライン' : 'オンライン'}
                </Badge>
                <Badge variant="outline">同期待ち {pendingSyncCount} 件</Badge>
                <Badge variant="outline">競合 {syncConflicts.length} 件</Badge>
                <Badge variant="outline">読取専用 TTL {OFFLINE_CACHE_TTL_HOURS}h</Badge>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">朝の事前同期</p>
                <p className="mt-1">
                  当日訪問予定の軽量 brief を端末へ保持し、患者サマリー / 前回課題 / 持参チェック対象を read-only で参照できます。
                </p>
                <p className="mt-1">
                  最終同期:{' '}
                  {cachedVisitBriefUpdatedAt
                    ? format(parseISO(cachedVisitBriefUpdatedAt), 'M/d HH:mm', { locale: ja })
                    : '未実施'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => manualSyncMutation.mutate()}
                  disabled={manualSyncMutation.isPending || pendingSyncCount === 0}
                >
                  {manualSyncMutation.isPending ? '同期中...' : '今すぐ同期'}
                </Button>
                {syncConflicts.length > 0 && (
                  <span className="text-xs text-amber-700">
                    409 競合は下のカードで解決します
                  </span>
                )}
              </div>
              {syncConflicts.length > 0 ? (
                <div className="space-y-3">
                  {syncConflicts.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">訪問記録の競合</p>
                          <p className="mt-1 text-xs text-amber-800/90">
                            schedule {item.scope_id ?? '不明'} / {item.lastError ?? '競合あり'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => overwriteConflictMutation.mutate(item.id!)}
                            disabled={overwriteConflictMutation.isPending}
                          >
                            上書き
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => discardConflictMutation.mutate(item.id!)}
                            disabled={discardConflictMutation.isPending}
                          >
                            破棄
                          </Button>
                          {item.scope_id && (
                            <Link
                              href={`/visits/${item.scope_id}/record`}
                              className="inline-flex h-8 items-center rounded-lg border border-amber-300 px-3 text-sm hover:bg-white/60"
                            >
                              再編集
                            </Link>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
                          <p className="text-xs font-medium text-amber-900">ローカル下書き</p>
                          <p className="mt-1 text-xs text-amber-800/90">
                            結果 {String(item.conflict?.local.outcome_status ?? '未設定')}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-amber-800/90">
                            {String(item.conflict?.local.soap_plan ?? 'P未入力')}
                          </p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
                          <p className="text-xs font-medium text-amber-900">サーバー版</p>
                          <p className="mt-1 text-xs text-amber-800/90">
                            結果 {item.conflict?.server?.outcome_status ?? '未設定'}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-amber-800/90">
                            {item.conflict?.server?.soap_plan ?? 'P未入力'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  競合している下書きはありません。
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">軽量訪問ブリーフ</CardTitle>
              <CardDescription>
                重要情報だけを端末へ AES-GCM で暗号化して保存し、オフライン時は read-only で表示します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {cachedVisitBriefs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  この日の軽量 brief キャッシュはまだありません。
                </p>
              ) : (
                cachedVisitBriefs.map((item) => (
                  <div key={item.scheduleId} className="rounded-xl border border-border px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{item.patientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {timeLabel(item.timeWindowStart, item.timeWindowEnd)}
                          {item.siteName ? ` / ${item.siteName}` : ''}
                          {item.facilityLabel ? ` / ${item.facilityLabel}` : ''}
                        </p>
                      </div>
                      <Badge variant={item.provider === 'openai' ? 'default' : 'outline'}>
                        {item.provider === 'openai' && !item.isFallback ? 'AI' : 'rule'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{item.headline}</p>
                    {item.mustCheckToday.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {item.mustCheckToday.slice(0, 3).map((check) => (
                          <li key={check}>- {check}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      生成 {format(parseISO(item.generatedAt), 'M/d HH:mm', { locale: ja })} / 根拠{' '}
                      {item.sourceRefs.join(' / ')}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card id="planner">
            <CardHeader>
              <CardTitle className="text-base">訪問候補を生成</CardTitle>
              <CardDescription>
                システムが候補を提案し、承認後に患者へ架電します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="planner-case">対象ケース</Label>
                <Select
                  value={resolvedPlannerCaseId}
                  onValueChange={(value) =>
                    {
                      setPlannerCandidateCountManual(false);
                      setPlannerForm((current) => ({
                        ...current,
                        case_id: value ?? current.case_id,
                      }));
                    }
                  }
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
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPlannerForm((current) => ({
                                ...current,
                                start_date: billingCadence.next_billable_date ?? current.start_date,
                              }))
                            }
                          >
                            次回算定可能日に設定
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPlannerCandidateCountManual(false);
                              setPlannerForm((current) => ({
                                ...current,
                                start_date: billingCadence.next_billable_date ?? current.start_date,
                                visit_type:
                                  billingPreviewData?.recommended_visit_type ?? current.visit_type,
                                priority:
                                  billingPreviewData?.recommended_priority ?? current.priority,
                                candidate_count: String(
                                  billingPreviewData?.recommended_candidate_count ??
                                    Number(current.candidate_count),
                                ),
                              }));
                            }}
                          >
                            推奨値を適用
                          </Button>
                        </div>
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
                      <p>
                        次回算定可能日: {billingCadence.next_billable_date ?? '提案不可'}
                      </p>
                      <p>
                        推奨設定: {billingPreviewData?.recommended_visit_type ?? plannerForm.visit_type} /{' '}
                        {PRIORITY_LABELS[billingPreviewData?.recommended_priority ?? plannerForm.priority]}
                      </p>
                      <p>
                        推奨候補数: {billingPreviewData?.recommended_candidate_count ?? Number(effectivePlannerCandidateCount)}件
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
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="planner-visit-type">訪問種別</Label>
                  <Select
                    value={plannerForm.visit_type}
                    onValueChange={(value) =>
                      setPlannerForm((current) => ({
                        ...current,
                        visit_type: (value as VisitType | null) ?? current.visit_type,
                      }))
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
                      setPlannerForm((current) => ({
                        ...current,
                        priority: (value as VisitPriority | null) ?? current.priority,
                      }))
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
                      setPlannerForm((current) => ({
                        ...current,
                        start_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="planner-candidate-count">候補数</Label>
                  <Select
                    value={effectivePlannerCandidateCount}
                    onValueChange={(value) =>
                      {
                        setPlannerCandidateCountManual(true);
                        setPlannerForm((current) => ({
                          ...current,
                          candidate_count: value ?? current.candidate_count,
                        }));
                      }
                    }
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
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="planner-time-from">希望開始時刻</Label>
                  <Input
                    id="planner-time-from"
                    type="time"
                    value={plannerForm.preferred_time_from}
                    onChange={(event) =>
                      setPlannerForm((current) => ({
                        ...current,
                        preferred_time_from: event.target.value,
                      }))
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
                      setPlannerForm((current) => ({
                        ...current,
                        preferred_time_to: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={!resolvedPlannerCaseId || generateMutation.isPending}
              >
                {generateMutation.isPending ? '候補生成中...' : '訪問候補を生成'}
              </Button>

              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                ルート候補は患者住所と既存訪問の順番から算出します。担当薬剤師に勤務枠が
                ない場合のみ、別薬剤師へ自動エスカレーションします。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">運用タスク</CardTitle>
              <CardDescription>
                スケジュールに影響する未完了タスクを優先順で表示します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {callbackTasksLoading ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  再架電タスクを読み込んでいます...
                </div>
              ) : callbackTasks.length > 0 ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
                    架電結果の再記録や折返し対応が必要な候補です。
                  </div>
                  {callbackTasks.map((task) => {
                    const relatedProposal = task.related_entity_id
                      ? proposalById.get(task.related_entity_id) ?? null
                      : null;

                    return (
                      <div
                        key={task.id}
                        className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{task.title}</p>
                              <Badge variant="outline">
                                {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={taskPriorityClass(task.priority)}
                              >
                                {task.priority}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              期限 {formatTaskDueLabel(task)}
                              {task.assigned_to
                                ? ` / 担当 ${pharmacistNameById.get(task.assigned_to) ?? '未登録'}`
                                : ''}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              task.status === 'in_progress'
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }
                          >
                            {task.status === 'in_progress' ? '対応中' : '未着手'}
                          </Badge>
                        </div>

                        {(relatedProposal || task.description) && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {relatedProposal ? (
                              <p>
                                {relatedProposal.case_.patient.name} /{' '}
                                {format(parseISO(relatedProposal.proposed_date), 'M/d', {
                                  locale: ja,
                                })}{' '}
                                {timeLabel(
                                  relatedProposal.time_window_start,
                                  relatedProposal.time_window_end
                                )}
                              </p>
                            ) : (
                              <p>対象候補は現在の表示週外です。</p>
                            )}
                            {task.description && <p className="leading-5">{task.description}</p>}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          {relatedProposal && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedDate(toDateKey(relatedProposal.proposed_date));
                                openContactLogDialog(relatedProposal);
                                if (task.status === 'pending') {
                                  callbackTaskMutation.mutate({
                                    id: task.id,
                                    status: 'in_progress',
                                  });
                                }
                              }}
                              disabled={callbackTaskMutation.isPending}
                            >
                              架電結果を記録
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              callbackTaskMutation.mutate({
                                id: task.id,
                                status: 'in_progress',
                              })
                            }
                            disabled={
                              callbackTaskMutation.isPending || task.status === 'in_progress'
                            }
                          >
                            対応中にする
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              callbackTaskMutation.mutate({
                                id: task.id,
                                status: 'completed',
                              })
                            }
                            disabled={callbackTaskMutation.isPending}
                          >
                            完了
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {tasksLoading ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  運用タスクを読み込んでいます...
                </div>
              ) : schedulingTasks.length === 0 ? (
                callbackTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    スケジュール関連の未完了タスクはありません
                  </div>
                ) : null
              ) : (
                schedulingTasks.map((task) => {
                  const relatedSchedule =
                    task.related_entity_type === 'visit_schedule' && task.related_entity_id
                      ? scheduleById.get(task.related_entity_id) ?? null
                      : null;
                  const canApproveOverride =
                    task.task_type === 'visit_schedule_override_approval' &&
                    task.related_entity_id;
                  const canOpenPreparation =
                    task.task_type === 'visit_preparation' && relatedSchedule;

                  return (
                    <div
                      key={task.id}
                      className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{task.title}</p>
                            <Badge variant="outline">
                              {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={taskPriorityClass(task.priority)}
                            >
                              {task.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            期限 {formatTaskDueLabel(task)}
                            {task.assigned_to
                              ? ` / 担当 ${pharmacistNameById.get(task.assigned_to) ?? '未登録'}`
                              : ''}
                          </p>
                        </div>
                      </div>

                      {(relatedSchedule || task.description) && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {relatedSchedule && (
                            <p>
                              {relatedSchedule.case_.patient.name} /{' '}
                              {format(parseISO(relatedSchedule.scheduled_date), 'M/d', {
                                locale: ja,
                              })}{' '}
                              {timeLabel(
                                relatedSchedule.time_window_start,
                                relatedSchedule.time_window_end
                              )}
                            </p>
                          )}
                          {task.description && (
                            <p className="leading-5">{task.description}</p>
                          )}
                        </div>
                      )}

                      {(canApproveOverride || canOpenPreparation) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {canOpenPreparation && relatedSchedule && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPreparationDialog(relatedSchedule)}
                            >
                              準備チェック
                            </Button>
                          )}
                          {canApproveOverride && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const scheduleId = task.related_entity_id;
                                if (!scheduleId) return;
                                rescheduleApprovalMutation.mutate(scheduleId);
                              }}
                              disabled={rescheduleApprovalMutation.isPending}
                            >
                              変更承認
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">関連管理</CardTitle>
              <CardDescription>
                ケース担当・シフト・休日設定は管理画面で更新します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/admin/shifts"
                className="flex items-center justify-between rounded-xl border px-3 py-3 transition hover:bg-muted/30"
              >
                <div>
                  <p className="font-medium text-foreground">薬剤師・シフト管理</p>
                  <p className="text-xs text-muted-foreground">
                    薬剤師登録、休日登録、月間シフト編集
                  </p>
                </div>
                <Route className="size-4 text-muted-foreground" />
              </Link>
              <Link
                href={`/patients/${selectedCase?.patient.id ?? ''}`}
                className={[
                  'flex items-center justify-between rounded-xl border px-3 py-3 transition',
                  selectedCase ? 'hover:bg-muted/30' : 'pointer-events-none opacity-50',
                ].join(' ')}
              >
                <div>
                  <p className="font-medium text-foreground">担当薬剤師の割当</p>
                  <p className="text-xs text-muted-foreground">
                    患者ケースで主担当薬剤師を設定します
                  </p>
                </div>
                <Shuffle className="size-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue={initialTab}>
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="proposals">
              候補一覧
              <Badge variant="outline" className="ml-1.5">
                {selectedDateProposals.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="confirmed">
              確定予定
              <Badge variant="outline" className="ml-1.5">
                {selectedDateSchedules.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proposals" className="space-y-4">
            {proposalsLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  訪問候補を読み込んでいます...
                </CardContent>
              </Card>
            ) : selectedDateProposals.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
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
                  proposal.proposal_status
                );
                const canCall = proposal.proposal_status === 'patient_contact_pending';
                const canConfirm = canCall && proposal.patient_contact_status === 'confirmed';
                const impactCount = readImpactCount(
                  proposal.reschedule_source_schedule?.override_request?.impact_summary
                );
                const impactedPatientNames = readImpactedPatientNames(
                  proposal.reschedule_source_schedule?.override_request?.impact_summary
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
                            <span>{timeLabel(proposal.time_window_start, proposal.time_window_end)}</span>
                            <span>架電状態: {CONTACT_STATUS_LABELS[proposal.patient_contact_status]}</span>
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
                                ? format(parseISO(proposal.medication_end_date), 'yyyy/MM/dd', { locale: ja })
                                : '未計算'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">訪問期限</p>
                            <p className="text-foreground">
                              {proposal.visit_deadline_date
                                ? format(parseISO(proposal.visit_deadline_date), 'yyyy/MM/dd', { locale: ja })
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

                      <div className="space-y-2 text-sm">
                        <p className="font-medium text-foreground">提案理由</p>
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
                              次回算定可能日: {proposalCadence.next_billable_date ?? '提案不可'} / 残回数{' '}
                              {proposalCadence.remaining_month_count}
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
                              onClick={() =>
                                rescheduleApprovalMutation.mutate(
                                  proposal.reschedule_source_schedule_id as string
                                )
                              }
                              disabled={rescheduleApprovalMutation.isPending}
                            >
                              変更承認
                            </Button>
                          )}
                        {canApprove && (
                          <Button
                            size="sm"
                            onClick={() =>
                              proposalActionMutation.mutate({
                                id: proposal.id,
                                payload: { action: 'approve' },
                              })
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
                              onClick={() => openContactLogDialog(proposal)}
                              disabled={proposalActionMutation.isPending}
                            >
                              架電結果を記録
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
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
                              onClick={() =>
                                proposalActionMutation.mutate({
                                  id: proposal.id,
                                  payload: { action: 'confirm' },
                                })
                              }
                              disabled={!canConfirm || proposalActionMutation.isPending}
                            >
                              日時確定
                            </Button>
                          </>
                        )}
                        {proposal.proposal_status === 'confirmed' && proposal.finalized_schedule && (
                          <Link
                            href={`/visits/${proposal.finalized_schedule.id}/record`}
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

          <TabsContent value="confirmed" className="space-y-4">
            {facilityTracker.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="size-4 text-sky-600" aria-hidden="true" />
                    施設一括訪問トラッカー
                  </CardTitle>
                  <CardDescription>
                    同日・同施設の訪問を束ねて、未準備と未完了を施設単位で確認します
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={activeFacilityFilter === null ? 'default' : 'outline'}
                      onClick={() => setFacilityFilter(null)}
                    >
                      全件表示
                    </Button>
                    {facilityTracker.map((group) => (
                      <Button
                        key={group.key}
                        size="sm"
                        variant={activeFacilityFilter === group.key ? 'default' : 'outline'}
                        onClick={() => setFacilityFilter(group.key)}
                      >
                        {group.label}
                      </Button>
                    ))}
                  </div>
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
                              ルート順 {group.routeOrders.length > 0 ? group.routeOrders.join(', ') : '未設定'}
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
                          行をドラッグして順序を並べ替えるか、番号入力で微調整できます。
                        </p>
                        <div className="mt-3 space-y-2">
                          {group.patients.map((patient, index) => (
                            <div
                              key={patient.scheduleId}
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
                                  patient.scheduleId
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
                                <p className="font-medium text-foreground">{patient.patientName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {patient.unitName ? `部屋 ${patient.unitName}` : '部屋番号未設定'}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Label
                                  htmlFor={`facility-route-${group.key}-${patient.scheduleId}`}
                                  className="text-xs text-muted-foreground"
                                >
                                  順序
                                </Label>
                                <Input
                                  id={`facility-route-${group.key}-${patient.scheduleId}`}
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
                                  className="h-8 w-20"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openFacilityVisitDayDialog(group)}
                          >
                            定期訪問日を設定
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              facilityBatchMutation.mutate({
                                groupKey: group.key,
                                carryItemsConfirmed: false,
                              })
                            }
                            disabled={facilityBatchMutation.isPending}
                          >
                            施設バッチを保存
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              facilityBatchMutation.mutate({
                                groupKey: group.key,
                                carryItemsConfirmed: true,
                              })
                            }
                            disabled={facilityBatchMutation.isPending}
                          >
                            持参確認を一括反映
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {visibleSchedules.length > 0 && ganttColumns.length > 0 && (
              <VisitRoutePreviewPanel
                controlId="day-desktop-route"
                className="hidden md:block"
                title="日次ルートマップ"
                description="薬局から訪問先までの経路を確認し、そのまま route_order へ反映できます。"
                selectionLabel={routeSelectionLabel}
                travelMode={routeTravelMode}
                onTravelModeChange={(value) => setRouteTravelMode(value as RouteTravelMode)}
                plan={routePlanData}
                points={routeMapPoints}
                site={routeMapSite}
                orderedIds={routeOrderDraft.draftIds}
                currentOrderedIds={routeOrderDraft.currentIds}
                onMoveItem={(scheduleId, direction) => routeOrderDraft.moveItem(scheduleId, direction)}
                headerControls={
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="desktop-route-pharmacist" className="text-xs">
                        対象薬剤師
                      </Label>
                      <Select
                        value={resolvedRoutePharmacistId}
                        onValueChange={(value) => setSelectedRoutePharmacistId(value ?? '')}
                      >
                        <SelectTrigger id="desktop-route-pharmacist" className="w-[12rem]">
                          <SelectValue placeholder="薬剤師を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {routePharmacistOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                              {option.siteName ? ` / ${option.siteName}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {routeOrderDraft.manualDirty ? (
                      <Button type="button" size="sm" variant="outline" onClick={routeOrderDraft.resetToOptimized}>
                        最適順へ戻す
                      </Button>
                    ) : null}
                  </>
                }
                loading={routePlanLoading}
                actionLabel="最適順を反映"
                actionDisabled={
                  routePlanLoading ||
                  applyOptimizedRouteMutation.isPending ||
                  !routeOptimizationDirty
                }
                actionPending={applyOptimizedRouteMutation.isPending}
                onAction={() => applyOptimizedRouteMutation.mutate()}
                extraSummary={
                  <>
                    <Badge variant="outline">対象 {routeMapSchedules.length} 件</Badge>
                    {routeOrderDraft.diffCount > 0 ? (
                      <Badge variant="outline">差分 {routeOrderDraft.diffCount} 件</Badge>
                    ) : null}
                  </>
                }
              />
            )}
            {visibleSchedules.length > 0 && ganttColumns.length > 0 && (
              <Card className="hidden md:block">
                <CardHeader>
                  <CardTitle className="text-base">タブレット日次ガント</CardTitle>
                  <CardDescription>
                    縦軸=時間、横軸=薬剤師。横向きで当日の訪問密度と準備状況を俯瞰できます
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">時間帯 {formatMinutesLabel(ganttWindow.startMinutes)} - {formatMinutesLabel(ganttWindow.endMinutes)}</Badge>
                    <Badge variant="outline">薬剤師 {ganttColumns.length} 名</Badge>
                    <Badge variant="outline">確定訪問 {visibleSchedules.length} 件</Badge>
                    <Badge variant="outline">横向き推奨</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-[960px] table-fixed border-separate border-spacing-3">
                      <thead>
                        <tr>
                          <th className="w-18 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-3 text-left text-xs font-medium text-muted-foreground">
                            時間
                          </th>
                          {ganttTableColumns.map((column) => (
                            <th
                              key={column.pharmacistId}
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
                            <th className="h-11 rounded-xl border border-border bg-muted/10 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
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
                                    <div
                                      className={[
                                        'flex h-full min-h-[44px] flex-col rounded-2xl border px-3 py-2 shadow-sm',
                                        ganttBlockClass(scheduleCell.schedule),
                                      ].join(' ')}
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-medium">
                                            {scheduleCell.schedule.case_.patient.name}
                                          </p>
                                          <p className="text-[11px] opacity-80">
                                            {timeLabel(
                                              scheduleCell.schedule.time_window_start,
                                              scheduleCell.schedule.time_window_end
                                            )}
                                          </p>
                                        </div>
                                        <Badge variant="outline" className="shrink-0 bg-white/70">
                                          #{scheduleCell.schedule.route_order ?? '-'}
                                        </Badge>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-1">
                                        <Badge variant="outline" className="bg-white/70">
                                          {
                                            SCHEDULE_STATUS_LABELS[
                                              scheduleCell.schedule.schedule_status
                                            ]
                                          }
                                        </Badge>
                                        <Badge variant="outline" className="bg-white/70">
                                          {scheduleCell.schedule.preparation?.prepared_at
                                            ? '準備完了'
                                            : '準備未了'}
                                        </Badge>
                                      </div>
                                      <p className="mt-2 line-clamp-2 text-[11px] opacity-80">
                                        {addressOfPatient(scheduleCell.schedule)}
                                      </p>
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
                                  className="h-11 w-56 min-w-56 rounded-xl border border-dashed border-border/70 bg-background"
                                />
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
            {schedulesLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  確定予定を読み込んでいます...
                </CardContent>
              </Card>
            ) : visibleSchedules.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
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
                          <span>{timeLabel(schedule.time_window_start, schedule.time_window_end)}</span>
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
                              {schedule.facility_hint.label} で同日 {schedule.facility_hint.patient_count} 名を担当
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
                            <p className="mt-1 leading-6">
                              {schedule.override_request.reason}
                            </p>
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
                            {readImpactedPatientNames(
                              schedule.override_request.impact_summary
                            ).length > 0 && (
                              <p className="mt-1 text-xs text-amber-800/80">
                                影響患者:{' '}
                                {readImpactedPatientNames(
                                  schedule.override_request.impact_summary
                                ).join('、')}
                              </p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rescheduleApprovalMutation.mutate(schedule.id)}
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
                            />
                            <span className="text-xs text-foreground">{label}</span>
                          </div>
                        ))}
                      </div>
                      {schedule.preparation?.prepared_at && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          最終更新{' '}
                          {format(parseISO(schedule.preparation.prepared_at), 'yyyy/MM/dd HH:mm', {
                            locale: ja,
                          })}
                        </p>
                      )}
                    </div>

                    {scheduleCadence && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-950">
                        <p className="font-medium">算定 cadence</p>
                        <p className="mt-1">
                          次回算定可能日: {scheduleCadence.next_billable_date ?? '提案不可'} / 残回数{' '}
                          {scheduleCadence.remaining_month_count}
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
                            { locale: ja }
                          )}{' '}
                          {timeLabel(
                            schedule.applied_override.source_schedule.time_window_start,
                            schedule.applied_override.source_schedule.time_window_end
                          )}{' '}
                          から再調整。理由: {schedule.applied_override.reason}
                        </p>
                        <p className="mt-1 text-xs text-orange-800/80">
                          変更前担当:
                          {' '}
                          {pharmacistNameById.get(
                            schedule.applied_override.source_schedule.pharmacist_id
                          ) ?? '薬剤師未登録'}
                        </p>
                      </div>
                    )}

                    {['completed', 'cancelled', 'rescheduled'].includes(schedule.schedule_status) ? null : (
                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        {['ready', 'departed'].includes(schedule.schedule_status) && (
                          <Button
                            size="sm"
                            className="gap-1.5"
                            variant={getDepartureCarryWarning(schedule) ? 'destructive' : 'default'}
                            onClick={() => handleVisitStart(schedule)}
                          >
                            <PlayCircle className="size-4" aria-hidden="true" />
                            {getDepartureCarryWarning(schedule)
                              ? '警告を確認して訪問開始'
                              : '訪問開始'}
                          </Button>
                        )}
                        {schedule.schedule_status === 'in_progress' && (
                          <Link href={`/visits/${schedule.id}/record`}>
                            <Button size="sm" variant="default" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              訪問完了
                            </Button>
                          </Link>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openPreparationDialog(schedule)}
                        >
                          訪問準備
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRescheduleDialog(schedule)}
                        >
                          リスケ候補を作る
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </div>

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
                      rescheduleTarget.time_window_end
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
                      reason_code: (value as typeof current.reason_code | null) ?? current.reason_code,
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
        onOpenChange={(open) => !open && setContactLogTarget(null)}
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
                <p className="font-medium text-foreground">
                  {contactLogTarget.case_.patient.name}
                </p>
                <p className="text-muted-foreground">
                  {format(parseISO(contactLogTarget.proposed_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    contactLogTarget.time_window_start,
                    contactLogTarget.time_window_end
                  )}
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
              onClick={() => setContactLogTarget(null)}
              disabled={proposalActionMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => {
                if (!contactLogTarget) return;
                proposalActionMutation.mutate({
                  id: contactLogTarget.id,
                  payload: {
                    action: 'contact_attempt',
                    outcome: contactLogForm.outcome,
                    contact_method: contactLogForm.contact_method,
                    contact_name: contactLogForm.contact_name || undefined,
                    contact_phone: contactLogForm.contact_phone || undefined,
                    note: contactLogForm.note || undefined,
                    callback_due_at: contactLogForm.callback_due_at
                      ? new Date(contactLogForm.callback_due_at).toISOString()
                      : undefined,
                  },
                });
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
            <DialogTitle>施設単位の定期訪問日を設定</DialogTitle>
            <DialogDescription>
              同一施設患者の訪問曜日と受入時間帯をまとめて保存し、RRULE 生成時の共通条件として使います。
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
                              ? [...current.preferred_weekdays, weekday.value].sort((left, right) => left - right)
                              : current.preferred_weekdays.filter((value) => value !== weekday.value),
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
              {facilityVisitDayMutation.isPending ? '保存中...' : '施設訪問日を保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preparationTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          preparationRequestIdRef.current = null;
          setPreparationLoading(false);
          setPreparationDetails(null);
          setPreparationTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>訪問準備チェック</DialogTitle>
            <DialogDescription>
              ready に進む前に、訪問前チェックリストを完了させます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {preparationTarget && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">
                  {preparationTarget.case_.patient.name}
                </p>
                <p className="text-muted-foreground">
                  {format(parseISO(preparationTarget.scheduled_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    preparationTarget.time_window_start,
                    preparationTarget.time_window_end
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preparationLoading
                    ? '最新の訪問準備を読み込み中...'
                    : preparationDetails?.preparation?.prepared_at
                      ? `最終更新 ${format(parseISO(preparationDetails.preparation.prepared_at), 'yyyy/MM/dd HH:mm', {
                          locale: ja,
                        })}`
                      : '未保存'}
                </p>
              </div>
            )}
            {getDepartureCarryWarning(preparationTarget) && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                <p className="font-medium">
                  {getDepartureCarryWarning(preparationTarget)?.title}
                </p>
                <p className="mt-1 leading-6">
                  {getDepartureCarryWarning(preparationTarget)?.description}
                </p>
              </div>
            )}
            {preparationDetails?.pack && (
              <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Pre-Visit Pack</p>
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

                {preparationDetails.pack.readiness_blockers.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    未完了: {preparationDetails.pack.readiness_blockers.join(' / ')}
                  </div>
                )}

                {preparationDetails.pack.onboarding_readiness && (
                  <OnboardingWarningBadges readiness={preparationDetails.pack.onboarding_readiness} />
                )}

                {preparationDetails.pack.previous_visit && (
                  <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs">
                    <p className="font-medium text-foreground">前回訪問</p>
                    <p className="mt-1 text-muted-foreground">
                      {format(
                        parseISO(preparationDetails.pack.previous_visit.visit_date),
                        'yyyy/MM/dd',
                        { locale: ja }
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
                              parseISO(preparationDetails.pack.prescription_changes.previous_prescribed_date),
                              'yyyy/MM/dd',
                              { locale: ja }
                            )} → ${format(
                              parseISO(preparationDetails.pack.prescription_changes.current_prescribed_date),
                              'yyyy/MM/dd',
                              { locale: ja }
                            )}`
                          : `最新 ${format(
                              parseISO(preparationDetails.pack.prescription_changes.current_prescribed_date),
                              'yyyy/MM/dd',
                              { locale: ja }
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
                            {preparationDetails.pack.prescription_changes.added.slice(0, 4).map((drug) => (
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
                            {preparationDetails.pack.prescription_changes.changed.slice(0, 4).map((item) => (
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
                            {preparationDetails.pack.prescription_changes.removed.slice(0, 4).map((drug) => (
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

                {(preparationDetails.pack.open_tasks.length > 0 ||
                  preparationDetails.pack.recent_contact_logs.length > 0 ||
                  preparationDetails.pack.care_team.length > 0) && (
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
                )}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-3">
                {PREPARATION_ITEMS.map(([field, label]) => (
                  <label
                    key={field}
                    className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={preparationForm[field as keyof typeof preparationForm]}
                      onCheckedChange={(checked) =>
                        setPreparationForm((current) => ({
                          ...current,
                          [field]: Boolean(checked),
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              {preparationDetails?.pack?.patient.address ? (
                <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">訪問先マップ</p>
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
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                preparationRequestIdRef.current = null;
                setPreparationLoading(false);
                setPreparationDetails(null);
                setPreparationTarget(null);
              }}
              disabled={preparationMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: false,
                })
              }
              disabled={preparationMutation.isPending}
            >
              保存
            </Button>
            <Button
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: true,
                })
              }
              disabled={
                preparationMutation.isPending ||
                Object.values(preparationForm).some((value) => !value)
              }
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
                  departureWarningTarget.time_window_end
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                持参物ステータス: {departureWarningTarget.carry_items_status}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepartureWarningTarget(null)}>
              戻る
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!departureWarningTarget) return;
                router.push(`/visits/${departureWarningTarget.id}/record`);
                setDepartureWarningTarget(null);
              }}
            >
              警告を確認して訪問開始
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
