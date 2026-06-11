'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronRight,
  PhoneCall,
  RefreshCw,
  Route,
  UserRound,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  VisitProposalDiagnosticsCard,
  type ProposalGenerationDiagnosticsCardData,
} from '@/components/features/visits/visit-proposal-diagnostics-card';
import { VisitRoutePreviewPanel } from '@/components/features/visits/visit-route-preview-panel';
import { VISIT_ROUTE_TRAVEL_MODE_LABELS } from '@/components/features/visits/visit-route-shared';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import { useReplaceSearchParams } from '@/lib/navigation/use-synced-search-params';
import {
  applyVisitScheduleProposalRouteUpdates,
  type VisitRouteConfirmationContext,
  type VisitScheduleProposalRouteUpdate,
} from '@/app/(dashboard)/schedules/visit-route-client';
import { useRouteOrderDraft } from '@/app/(dashboard)/schedules/route-order-draft';
import { ProposalHumanDecisionFlow } from '../proposal-human-decision-flow';
import { mergeScheduleProposalSearchParams } from './proposal-query-state';
import { buildDashboardDiagnosticActions } from './schedule-proposal-diagnostic-actions';
import {
  type CaseOption,
  CONTACT_STATUS_LABELS,
  PRIORITY_LABELS,
  PROPOSAL_STATUS_LABELS,
  readImpactCount,
  readImpactedPatientNames,
  splitProposalReason,
  statusBadgeClass,
  timeLabel,
  type Proposal,
  type VisitVehicleResourceSummary,
  type VisitScheduleBillingPreview,
} from '../day-view.shared';

type DashboardTab = 'unapproved' | 'patient_contact_pending' | 'confirmed' | 'rejected';
type TravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
type FilterPreset = 'all' | 'today' | 'contact' | 'reschedule' | 'stale';

type ProposalDetail = Proposal & {
  approved_at?: string | null;
  patient_contacted_at?: string | null;
  confirmed_at?: string | null;
  related_proposals: Proposal[];
  pharmacist_day_schedules: Array<{
    id: string;
    visit_type: Proposal['visit_type'];
    priority: Proposal['priority'];
    schedule_status:
      | 'planned'
      | 'in_preparation'
      | 'ready'
      | 'departed'
      | 'in_progress'
      | 'completed'
      | 'cancelled'
      | 'postponed'
      | 'rescheduled'
      | 'no_show';
    route_order: number | null;
    scheduled_date: string;
    time_window_start: string | null;
    time_window_end: string | null;
    case_: {
      patient: {
        name: string;
        residences: Array<{
          address: string;
          lat: number | null;
          lng: number | null;
        }>;
      };
    };
    site: {
      id: string;
      name: string;
      address: string;
      lat?: number | null;
      lng?: number | null;
    } | null;
    vehicle_resource: VisitVehicleResourceSummary | null;
  }>;
  route_preview: {
    plan: {
      status: 'ok' | 'unavailable';
      note: string | null;
      travelMode: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
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
    points: Array<{
      schedule_id: string;
      point_kind: 'proposal' | 'schedule';
      patient_name: string;
      address: string;
      lat: number;
      lng: number;
      priority: Proposal['priority'];
      schedule_status:
        | 'planned'
        | 'in_preparation'
        | 'ready'
        | 'departed'
        | 'in_progress'
        | 'completed'
        | 'cancelled'
        | 'postponed'
        | 'rescheduled'
        | 'no_show';
      time_window_start: string | null;
      time_window_end: string | null;
    }>;
    site: {
      name: string;
      lat: number;
      lng: number;
    } | null;
  };
  creation_diagnostics: ProposalGenerationDiagnostics | null;
};

type ProposalGenerationDiagnostics = ProposalGenerationDiagnosticsCardData;

type ScheduleProposalsResponse = { data: Proposal[] };
type ScheduleProposalDetailResponse = { data: ProposalDetail };
type CreateProposalResponse = {
  data: Proposal[];
  diagnostics?: ProposalGenerationDiagnostics;
};
type CaseSearchResponse = { data: CaseOption[] };
type VisitVehicleResourceOption = VisitVehicleResourceSummary & {
  available: boolean;
  site: {
    id: string;
    name: string;
  } | null;
};
type VisitVehicleResourcesResponse = { data: VisitVehicleResourceOption[] };
type ContactOutcome = 'attempted' | 'declined' | 'change_requested' | 'unreachable' | 'confirmed';
type SingleProposalConfirmAction = 'approve' | 'confirm';
type ContactMethod = 'phone' | 'fax' | 'email';
type ContactFormState = {
  outcome: ContactOutcome;
  contact_method: ContactMethod;
  contact_name: string;
  contact_phone: string;
  note: string;
  callback_due_at: string;
};

type BulkActionFailureSummary = {
  action: 'approve' | 'reject';
  successCount: number;
  failureCount: number;
  failures: Array<{
    id: string;
    patientName: string;
    proposedDate: string;
    timeWindowStart: string | null;
    timeWindowEnd: string | null;
    pharmacistName: string;
    vehicleLabel: string;
    message: string;
  }>;
};

type BulkActionFailure = {
  proposal: Proposal;
  ok: false;
  message: string;
  reachedServer: boolean;
};

type ProposalActionPayload =
  | { action: 'approve' }
  | { action: 'confirm' }
  | { action: 'reject'; reject_reason?: string }
  | {
      action: 'contact_attempt';
      outcome: ContactOutcome;
      contact_method: ContactMethod;
      contact_name?: string;
      contact_phone?: string;
      note?: string;
      callback_due_at?: string;
    };

type SingleProposalConfirmState = {
  action: SingleProposalConfirmAction;
  proposal: Proposal;
};

type ProposalRouteOrderMutationInput = {
  routeOrderUpdates: VisitScheduleProposalRouteUpdate[];
  confirmationContext: VisitRouteConfirmationContext;
};

type ContentProps = {
  initialStatus?: string | null;
  initialCaseId?: string | null;
  initialPatientId?: string | null;
  initialDateFrom?: string | null;
  initialDateTo?: string | null;
  initialFocus?: string | null;
  initialPreset?: string | null;
  initialDetailId?: string | null;
  initialTravelMode?: string | null;
};

const TAB_LABELS: Record<DashboardTab, string> = {
  unapproved: '未承認',
  patient_contact_pending: '患者連絡中',
  confirmed: '確定済み',
  rejected: '却下',
};

const PROPOSAL_TOUCH_TARGET_CLASS = 'min-h-[44px] sm:h-auto sm:min-h-[44px]';
const PROPOSAL_CHECKBOX_TOUCH_TARGET_CLASS =
  'size-11 rounded-lg sm:size-11 after:inset-0 [&_svg]:size-4';

const FILTER_PRESET_LABELS: Record<FilterPreset, string> = {
  all: '全て',
  today: '本日候補',
  contact: '患者連絡中',
  reschedule: '再調整',
  stale: '差替済み・期限切れ',
};

const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
};

const AUTO_VEHICLE_RESOURCE_VALUE = '__auto_vehicle_resource__';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '未設定';
  return format(parseISO(value), 'yyyy/MM/dd HH:mm', { locale: ja });
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return '未設定';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

function formatDistanceLabel(value: number | null | undefined) {
  if (value == null) return '0.0';
  return value.toFixed(1);
}

function formatEtaLabel(
  baseDate: string,
  timeWindowStart: string | null,
  offsetSeconds: number | null,
) {
  if (offsetSeconds == null) {
    return timeLabel(timeWindowStart, null);
  }

  const parsed = parseISO(`${baseDate}T09:00:00`);
  const eta = new Date(parsed.getTime() + offsetSeconds * 1000);
  return format(eta, 'HH:mm', { locale: ja });
}

function formatVehicleResourceLabel(vehicle: VisitVehicleResourceSummary | null | undefined) {
  if (!vehicle) return '未割当';
  const constraints = [
    vehicle.max_stops != null ? `最大${vehicle.max_stops}件` : null,
    vehicle.max_route_duration_minutes != null
      ? `${vehicle.max_route_duration_minutes}分以内`
      : null,
  ].filter(Boolean);
  return constraints.length > 0 ? `${vehicle.label} (${constraints.join(' / ')})` : vehicle.label;
}

function isPriorityRouteProposal(proposal: Pick<Proposal, 'priority' | 'proposal_reason'>) {
  return (
    (proposal.priority === 'emergency' || proposal.priority === 'urgent') &&
    proposal.proposal_reason.includes('即応枠')
  );
}

function isPatientPreferenceAlignedProposal(proposal: Pick<Proposal, 'proposal_reason'>) {
  return proposal.proposal_reason.includes('患者条件');
}

function proposalRouteDecisionLabel(
  proposal: Pick<Proposal, 'priority' | 'proposal_reason' | 'route_order'>,
) {
  if (isPriorityRouteProposal(proposal)) {
    return `緊急度優先で順路 ${proposal.route_order ?? '未設定'}`;
  }
  if (isPatientPreferenceAlignedProposal(proposal)) {
    return `患者希望枠で順路 ${proposal.route_order ?? '未設定'}`;
  }
  return `順路 ${proposal.route_order ?? '未設定'}`;
}

function ProposalDecisionBadges({ proposal }: { proposal: Proposal }) {
  return (
    <div className="flex flex-wrap gap-2">
      {proposal.assignment_mode === 'fallback' ? (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          代替担当
        </Badge>
      ) : (
        <Badge variant="outline">主担当</Badge>
      )}
      {isPriorityRouteProposal(proposal) ? (
        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
          緊急度で前倒し
        </Badge>
      ) : null}
      {isPatientPreferenceAlignedProposal(proposal) ? (
        <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800">
          患者希望枠内
        </Badge>
      ) : null}
      {proposal.vehicle_resource ? (
        <Badge variant="outline">
          <Car className="mr-1 size-3" />
          {proposal.vehicle_resource.label}
        </Badge>
      ) : null}
    </div>
  );
}

function ProposalRankingCard({
  candidate,
  rank,
  activeProposalId,
}: {
  candidate: Proposal;
  rank: number;
  activeProposalId: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        candidate.id === activeProposalId
          ? 'border-primary/40 bg-primary/5'
          : 'border-border/70 bg-background',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {rank}位 {formatDateLabel(candidate.proposed_date)}{' '}
            {timeLabel(candidate.time_window_start, candidate.time_window_end)}
          </p>
          <p className="text-xs text-muted-foreground">
            担当 {candidate.proposed_pharmacist?.name ?? '未解決'} /{' '}
            {candidate.site?.name ?? '拠点未設定'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            移動 {formatDistanceLabel(candidate.route_distance_score)}
          </Badge>
          <Badge variant="outline">
            配置 {candidate.assignment_mode === 'primary' ? '主担当優先' : '代替担当'}
          </Badge>
          {isPriorityRouteProposal(candidate) ? (
            <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
              緊急度で前倒し
            </Badge>
          ) : null}
          {isPatientPreferenceAlignedProposal(candidate) ? (
            <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800">
              患者希望枠内
            </Badge>
          ) : null}
          {candidate.vehicle_resource ? (
            <Badge variant="outline">
              <Car className="mr-1 size-3" />
              {candidate.vehicle_resource.label}
            </Badge>
          ) : null}
          <Badge variant="outline">期限 {formatDateLabel(candidate.visit_deadline_date)}</Badge>
        </div>
      </div>
      <ProposalReasonChips proposal={candidate} className="mt-3" />
    </div>
  );
}

function ProposalReasonChips({ proposal, className }: { proposal: Proposal; className?: string }) {
  const proposalReasons = splitProposalReason(proposal.proposal_reason ?? '');

  if (proposalReasons.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {proposalReasons.map((reason) => (
        <span
          key={`${proposal.id}-${reason}`}
          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
        >
          {reason}
        </span>
      ))}
    </div>
  );
}

function ProposalOperationalFacts({ proposal }: { proposal: Proposal }) {
  return (
    <div className="space-y-2 rounded-2xl bg-muted/30 p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">担当拠点</span>
        <span className="font-medium text-foreground">{proposal.site?.name ?? '未設定'}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">社用車</span>
        <span className="text-right font-medium text-foreground">
          {formatVehicleResourceLabel(proposal.vehicle_resource)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">期限</span>
        <span className="font-medium text-foreground">
          {formatDateLabel(proposal.visit_deadline_date)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">服薬最終日</span>
        <span className="font-medium text-foreground">
          {formatDateLabel(proposal.medication_end_date)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">ルート順</span>
        <span className="text-right font-medium text-foreground">
          {proposalRouteDecisionLabel(proposal)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">担当判定</span>
        <span className="text-right font-medium text-foreground">
          {proposal.assignment_mode === 'fallback'
            ? (proposal.escalation_reason ?? '代替薬剤師を割り当て')
            : '主担当薬剤師を優先'}
        </span>
      </div>
    </div>
  );
}

function toDashboardTab(status?: string | null): DashboardTab {
  if (status === 'patient_contact_pending') return 'patient_contact_pending';
  if (status === 'confirmed') return 'confirmed';
  if (status === 'rejected') return 'rejected';
  return 'unapproved';
}

function todayKey() {
  return format(new Date(), 'yyyy-MM-dd');
}

function matchesTab(proposal: Proposal, tab: DashboardTab) {
  switch (tab) {
    case 'unapproved':
      return ['proposed', 'reschedule_pending'].includes(proposal.proposal_status);
    case 'patient_contact_pending':
      return proposal.proposal_status === 'patient_contact_pending';
    case 'confirmed':
      return proposal.proposal_status === 'confirmed';
    case 'rejected':
      return ['rejected', 'superseded', 'expired'].includes(proposal.proposal_status);
    default:
      return false;
  }
}

function canApplyBulkProposalAction(proposal: Proposal, action: 'approve' | 'reject') {
  if (action === 'approve') {
    return ['proposed', 'reschedule_pending'].includes(proposal.proposal_status);
  }
  return ['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(
    proposal.proposal_status,
  );
}

function shortEntityIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return '未設定';
  const withoutKnownPrefix = normalized.replace(/^(proposal|case|patient)[_-]/u, '');
  const candidate = withoutKnownPrefix || normalized;
  return candidate.length <= 8 ? candidate : candidate.slice(-8);
}

function proposalSafeIdentifierLabel(proposal: Pick<Proposal, 'case_id' | 'id'>) {
  return `ケース ${shortEntityIdentifier(proposal.case_id)} / 候補 ${shortEntityIdentifier(proposal.id)}`;
}

function proposalActionTargetLabel(proposal: Proposal) {
  const pharmacistName = proposal.proposed_pharmacist?.name ?? '担当未解決';
  const vehicleLabel = proposal.vehicle_resource?.label ?? '社用車未指定';
  return `${proposal.case_.patient.name} ${formatDateLabel(proposal.proposed_date)} ${timeLabel(proposal.time_window_start, proposal.time_window_end)} / ${pharmacistName} / ${vehicleLabel} / ${proposalSafeIdentifierLabel(proposal)}`;
}

function caseOptionPrimaryPharmacistLabel(careCase: CaseOption) {
  return careCase.primary_pharmacist_name ?? '主担当未設定';
}

function caseOptionTargetLabel(careCase: CaseOption) {
  return `${careCase.patient.name} / ケース ${shortEntityIdentifier(careCase.id)} / 患者識別 ${shortEntityIdentifier(careCase.patient.id)} / 主担当 ${caseOptionPrimaryPharmacistLabel(careCase)}`;
}

function proposalListVisitPlaceLabel(proposal: Proposal) {
  const siteName = proposal.site?.name?.trim();
  return siteName
    ? `訪問先住所は詳細・ルート確認で表示 / 担当拠点 ${siteName}`
    : '訪問先住所は詳細・ルート確認で表示';
}

const SAFE_PROPOSAL_ACTION_FAILURE_MESSAGES = new Set([
  'この候補は承認できません',
  'この候補は却下できません',
  '勤務枠が埋まりました',
  '候補はすでに更新済みです',
  '訪問候補が見つかりません',
  '確定済み訪問の変更は管理者承認後に進めてください',
  '確定済み訪問の変更は承認後に新候補を確定してください',
]);

function proposalActionFailureDisplayMessage(message: string, reachedServer: boolean) {
  if (!reachedServer) {
    return '通信が完了しませんでした。接続を確認して再試行してください。';
  }

  const trimmedMessage = message.trim();
  if (SAFE_PROPOSAL_ACTION_FAILURE_MESSAGES.has(trimmedMessage)) {
    return trimmedMessage;
  }

  return 'サーバー側の状態変更または入力確認により未更新です。再取得後に候補状態を確認してください。';
}

function bulkActionFailureDisplayMessage(failure: BulkActionFailure) {
  return proposalActionFailureDisplayMessage(failure.message, failure.reachedServer);
}

function singleProposalActionLabel(action: SingleProposalConfirmAction) {
  return action === 'approve' ? '承認して患者連絡へ進める' : '日時確定する';
}

function singleProposalActionQuestion(action: SingleProposalConfirmAction) {
  return action === 'approve' ? '承認して患者連絡へ進めますか' : '日時確定しますか';
}

function singleProposalActionResultLabel(action: SingleProposalConfirmAction) {
  return action === 'approve' ? '患者連絡待ち' : '訪問予定確定';
}

export function ScheduleProposalsContent({
  initialStatus,
  initialCaseId,
  initialPatientId,
  initialDateFrom,
  initialDateTo,
  initialPreset,
  initialDetailId,
  initialTravelMode,
}: ContentProps) {
  const searchParams = useSearchParams();
  const replaceSearchParams = useReplaceSearchParams();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DashboardTab>(toDashboardTab(initialStatus));
  const [caseId, setCaseId] = useState(initialCaseId ?? '');
  const [patientId, setPatientId] = useState(initialPatientId ?? '');
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? '');
  const [dateTo, setDateTo] = useState(initialDateTo ?? '');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [singleConfirmAction, setSingleConfirmAction] = useState<SingleProposalConfirmState | null>(
    null,
  );
  const [bulkConfirmAction, setBulkConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [proposalRouteConfirmOpen, setProposalRouteConfirmOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [bulkActionFailureSummary, setBulkActionFailureSummary] =
    useState<BulkActionFailureSummary | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null);
  const [contactFormDraft, setContactFormDraft] = useState<ContactFormState | null>(null);
  const [reproposalFormDraft, setReproposalFormDraft] = useState<{
    start_date: string;
    priority: Proposal['priority'];
    preferred_time_from: string;
    preferred_time_to: string;
    vehicle_resource_id: string;
    note: string;
    candidate_count: string;
  } | null>(null);
  const [routeTravelMode, setRouteTravelMode] = useState<TravelMode>(
    initialTravelMode === 'BICYCLE' ||
      initialTravelMode === 'WALK' ||
      initialTravelMode === 'TWO_WHEELER'
      ? initialTravelMode
      : 'DRIVE',
  );
  const [caseSearchInput, setCaseSearchInput] = useState('');
  const [selectedCaseSummary, setSelectedCaseSummary] = useState<CaseOption | null>(null);
  const [filterPreset, setFilterPreset] = useState<FilterPreset>(
    initialPreset === 'today' ||
      initialPreset === 'contact' ||
      initialPreset === 'reschedule' ||
      initialPreset === 'stale'
      ? initialPreset
      : 'all',
  );
  const [lastGenerationDiagnostics, setLastGenerationDiagnostics] =
    useState<ProposalGenerationDiagnostics | null>(null);
  const deferredCaseSearchInput = useDeferredValue(caseSearchInput.trim());

  function clearSelectedProposals() {
    setSelectedIds([]);
    setBulkConfirmAction(null);
    setBulkRejectReason('');
    setBulkActionFailureSummary(null);
  }

  const replaceDashboardUrl = (patch: Record<string, string | null | undefined>) => {
    const next = mergeScheduleProposalSearchParams({
      params: new URLSearchParams(searchParams.toString()),
      patch: {
        workspace: 'dashboard',
        ...patch,
      },
    });
    replaceSearchParams(next);
  };

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (caseId.trim()) params.set('case_id', caseId.trim());
    if (patientId.trim()) params.set('patient_id', patientId.trim());
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params.toString();
  }, [caseId, dateFrom, dateTo, patientId]);

  const proposalsQuery = useRealtimeQuery({
    queryKey: ['schedule-proposals-dashboard', orgId, queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/visit-schedule-proposals?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('訪問候補の取得に失敗しました');
      return response.json() as Promise<ScheduleProposalsResponse>;
    },
    enabled: !!orgId,
    invalidateOn: ['workflow_refresh'],
  });

  const proposals = useMemo(() => proposalsQuery.data?.data ?? [], [proposalsQuery.data]);
  const casesQuery = useQuery({
    queryKey: ['schedule-proposals-case-search', orgId, deferredCaseSearchInput],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: 'active',
        limit: '8',
        q: deferredCaseSearchInput,
      });
      const response = await fetch(`/api/cases?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ケース候補の取得に失敗しました');
      return response.json() as Promise<CaseSearchResponse>;
    },
    enabled: !!orgId && deferredCaseSearchInput.length >= 2,
  });

  const vehicleResourcesQuery = useQuery({
    queryKey: ['visit-vehicle-resources', orgId, 'available'],
    queryFn: async () => {
      const response = await fetch('/api/visit-vehicle-resources?available=true', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('社用車リソースの取得に失敗しました');
      return response.json() as Promise<VisitVehicleResourcesResponse>;
    },
    enabled: !!orgId,
  });

  const tabCounts = useMemo(
    () => ({
      unapproved: proposals.filter((proposal) => matchesTab(proposal, 'unapproved')).length,
      patient_contact_pending: proposals.filter((proposal) =>
        matchesTab(proposal, 'patient_contact_pending'),
      ).length,
      confirmed: proposals.filter((proposal) => matchesTab(proposal, 'confirmed')).length,
      rejected: proposals.filter((proposal) => matchesTab(proposal, 'rejected')).length,
      stale: proposals.filter((proposal) =>
        ['superseded', 'expired'].includes(proposal.proposal_status),
      ).length,
    }),
    [proposals],
  );

  const todayFilterCount = useMemo(
    () =>
      proposals.filter(
        (proposal) =>
          matchesTab(proposal, 'unapproved') && proposal.proposed_date.slice(0, 10) === todayKey(),
      ).length,
    [proposals],
  );
  const rescheduleCount = useMemo(
    () => proposals.filter((proposal) => proposal.reschedule_source_schedule_id != null).length,
    [proposals],
  );

  const visibleProposals = useMemo(
    () =>
      proposals.filter((proposal) => {
        if (!matchesTab(proposal, activeTab)) return false;
        if (filterPreset === 'reschedule' && proposal.reschedule_source_schedule_id == null) {
          return false;
        }
        if (filterPreset === 'today' && proposal.proposed_date.slice(0, 10) !== todayKey()) {
          return false;
        }
        return true;
      }),
    [activeTab, filterPreset, proposals],
  );
  const proposalPreviewRequests = useMemo(
    () =>
      visibleProposals.map((proposal) => ({
        key: proposal.id,
        case_id: proposal.case_id,
        proposed_date: proposal.proposed_date.slice(0, 10),
        pharmacist_id: proposal.proposed_pharmacist_id,
        site_id: proposal.site?.id ?? undefined,
        visit_type: proposal.visit_type,
      })),
    [visibleProposals],
  );
  const { data: proposalPreviewMap } = useQuery({
    queryKey: ['schedule-proposals-dashboard-billing-preview', orgId, proposalPreviewRequests],
    queryFn: async () => {
      const response = await fetch('/api/visit-schedule-proposals/billing-preview-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ items: proposalPreviewRequests }),
      });
      if (!response.ok) throw new Error('候補の算定プレビュー取得に失敗しました');
      const payload = (await response.json()) as {
        data: Record<string, VisitScheduleBillingPreview>;
      };
      return new Map(Object.entries(payload.data));
    },
    enabled: !!orgId && proposalPreviewRequests.length > 0,
  });

  const selectedProposals = useMemo(
    () => visibleProposals.filter((proposal) => selectedIds.includes(proposal.id)),
    [selectedIds, visibleProposals],
  );
  const bulkApproveEligibleProposals = useMemo(
    () => selectedProposals.filter((proposal) => canApplyBulkProposalAction(proposal, 'approve')),
    [selectedProposals],
  );
  const bulkRejectEligibleProposals = useMemo(
    () => selectedProposals.filter((proposal) => canApplyBulkProposalAction(proposal, 'reject')),
    [selectedProposals],
  );
  const bulkConfirmEligibleProposals = useMemo(() => {
    if (bulkConfirmAction === 'approve') return bulkApproveEligibleProposals;
    if (bulkConfirmAction === 'reject') return bulkRejectEligibleProposals;
    return [];
  }, [bulkApproveEligibleProposals, bulkConfirmAction, bulkRejectEligibleProposals]);

  const effectiveSelectedCaseSummary = useMemo(() => {
    if (selectedCaseSummary) return selectedCaseSummary;
    if (!caseId && !patientId) return null;
    const matchedProposal = proposals.find((proposal) =>
      caseId ? proposal.case_id === caseId : proposal.case_.patient.id === patientId,
    );
    if (!matchedProposal) return null;
    return {
      id: matchedProposal.case_id,
      status: 'active',
      primary_pharmacist_id: matchedProposal.proposed_pharmacist_id,
      primary_pharmacist_name: matchedProposal.proposed_pharmacist?.name ?? null,
      patient: {
        id: matchedProposal.case_.patient.id,
        name: matchedProposal.case_.patient.name,
        residences: matchedProposal.case_.patient.residences.map((residence) => ({
          address: residence.address,
          lat: residence.lat ?? null,
          lng: residence.lng ?? null,
        })),
      },
    } satisfies CaseOption;
  }, [caseId, patientId, proposals, selectedCaseSummary]);

  const activeDetailId =
    detailId && proposals.some((proposal) => proposal.id === detailId) ? detailId : null;

  useEffect(() => {
    if (!activeDetailId) return;

    const timeoutId = window.setTimeout(() => {
      document
        .getElementById(`proposal-${activeDetailId}`)
        ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeDetailId]);

  const detailQuery = useRealtimeQuery({
    queryKey: ['schedule-proposal-detail', orgId, activeDetailId, routeTravelMode],
    queryFn: async () => {
      const response = await fetch(
        `/api/visit-schedule-proposals/${activeDetailId}?travel_mode=${routeTravelMode}`,
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!response.ok) throw new Error('訪問候補詳細の取得に失敗しました');
      return response.json() as Promise<ScheduleProposalDetailResponse>;
    },
    enabled: !!orgId && !!activeDetailId,
    invalidateOn: ['workflow_refresh'],
  });

  const detail = detailQuery.data?.data ?? null;
  const visibleDiagnostics = lastGenerationDiagnostics ?? detail?.creation_diagnostics ?? null;

  const contactForm = useMemo<ContactFormState>(() => {
    if (contactFormDraft) return contactFormDraft;
    if (!detail) {
      return {
        outcome: 'attempted' as const,
        contact_method: 'phone' as const,
        contact_name: '',
        contact_phone: '',
        note: '',
        callback_due_at: '',
      };
    }
    const latestLog = detail.contact_logs[0] ?? null;
    return {
      outcome:
        detail.patient_contact_status === 'confirmed'
          ? 'confirmed'
          : detail.patient_contact_status === 'declined'
            ? 'declined'
            : detail.patient_contact_status === 'change_requested'
              ? 'change_requested'
              : detail.patient_contact_status === 'unreachable'
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
    };
  }, [contactFormDraft, detail]);

  const reproposalForm = useMemo(() => {
    if (reproposalFormDraft) return reproposalFormDraft;
    return {
      start_date: detail?.proposed_date.slice(0, 10) ?? initialDateFrom ?? '',
      priority: detail?.priority ?? 'normal',
      preferred_time_from: '09:00',
      preferred_time_to: '12:00',
      vehicle_resource_id: detail?.vehicle_resource?.id ?? '',
      note: '',
      candidate_count: '3',
    };
  }, [detail, initialDateFrom, reproposalFormDraft]);

  const applyCaseFilter = (careCase: CaseOption) => {
    setSelectedCaseSummary(careCase);
    setCaseId(careCase.id);
    setPatientId(careCase.patient.id);
    setCaseSearchInput('');
    setDetailId(null);
    clearSelectedProposals();
    replaceDashboardUrl({
      case_id: careCase.id,
      patient_id: careCase.patient.id,
      focus: 'patient',
      detail: null,
    });
  };

  const clearCaseFilter = () => {
    setSelectedCaseSummary(null);
    setCaseId('');
    setPatientId('');
    clearSelectedProposals();
    replaceDashboardUrl({
      case_id: null,
      patient_id: null,
      focus: null,
    });
  };

  const activatePreset = (preset: FilterPreset) => {
    const today = todayKey();
    setFilterPreset(preset);
    clearSelectedProposals();
    if (preset === 'today') {
      setActiveTab('unapproved');
      setDateFrom(today);
      setDateTo(today);
      replaceDashboardUrl({
        preset,
        status: 'proposed',
        date_from: today,
        date_to: today,
      });
      return;
    }
    if (preset === 'contact') {
      setActiveTab('patient_contact_pending');
      replaceDashboardUrl({
        preset,
        status: 'patient_contact_pending',
      });
      return;
    }
    if (preset === 'stale') {
      setActiveTab('rejected');
      replaceDashboardUrl({
        preset,
        status: 'rejected',
      });
      return;
    }
    if (preset === 'all') {
      setDateFrom(initialDateFrom ?? '');
      setDateTo('');
    }
    replaceDashboardUrl({
      preset: preset === 'all' ? null : preset,
      status: preset === 'all' ? activeTab : null,
      date_from: preset === 'all' ? initialDateFrom : dateFrom,
      date_to: preset === 'all' ? initialDateTo : dateTo,
    });
  };

  const resetFilters = () => {
    setFilterPreset('all');
    setCaseSearchInput('');
    setSelectedCaseSummary(null);
    setCaseId('');
    setPatientId('');
    clearSelectedProposals();
    setDateFrom(initialDateFrom ?? '');
    setDateTo('');
    setActiveTab(toDashboardTab(initialStatus));
    replaceDashboardUrl({
      status: initialStatus,
      case_id: null,
      patient_id: null,
      focus: null,
      preset: null,
      date_from: initialDateFrom,
      date_to: initialDateTo,
      detail: null,
    });
  };

  const openDetail = (proposalId: string) => {
    setDetailId(proposalId);
    setContactFormDraft(null);
    setReproposalFormDraft(null);
    replaceDashboardUrl({
      detail: proposalId,
      focus: 'detail',
    });
  };

  const invalidateProposalQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schedule-proposals-dashboard', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-proposal-detail', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'visit-contact-followup', orgId] }),
    ]);
  };

  const proposalActionMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: ProposalActionPayload }) => {
      let response: Response;
      try {
        response = await fetch(`/api/visit-schedule-proposals/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '候補更新に失敗しました';
        throw new Error(proposalActionFailureDisplayMessage(message, false));
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          proposalActionFailureDisplayMessage(error.message ?? '候補更新に失敗しました', true),
        );
      }
      try {
        return await response.json();
      } catch {
        throw new Error(proposalActionFailureDisplayMessage('候補更新に失敗しました', true));
      }
    },
    onSuccess: async (_data, variables) => {
      setSingleConfirmAction(null);
      const payload = variables.payload;
      if (payload.action === 'approve') {
        toast.success('候補を承認し、患者連絡待ちへ移しました');
      } else if (payload.action === 'confirm') {
        toast.success('訪問予定を確定しました');
      } else if (payload.action === 'reject') {
        toast.success('候補を却下しました');
      } else if (payload.outcome === 'change_requested') {
        toast.success('変更希望として記録しました');
      } else if (payload.outcome === 'confirmed') {
        toast.success('患者確認済みとして記録しました');
      } else if (payload.outcome === 'declined') {
        toast.success('辞退として記録しました');
      } else if (payload.outcome === 'unreachable') {
        toast.success('不通として記録しました');
      } else {
        toast.success('患者連絡結果を保存しました');
      }
      await invalidateProposalQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補更新に失敗しました');
    },
  });

  const bulkActionMutation = useMutation({
    mutationFn: async (
      variables:
        | { action: 'approve' }
        | {
            action: 'reject';
            reject_reason: string;
          },
    ) => {
      const action = variables.action;
      const rejectReason = action === 'reject' ? variables.reject_reason.trim() : '';
      if (action === 'reject' && rejectReason.length === 0) {
        throw new Error('却下理由を入力してください');
      }
      const eligible = selectedProposals.filter((proposal) =>
        canApplyBulkProposalAction(proposal, action),
      );
      if (eligible.length === 0) {
        throw new Error(
          action === 'approve'
            ? '承認できる候補が選択されていません'
            : '却下できる候補が選択されていません',
        );
      }

      const results = await Promise.all(
        eligible.map(async (proposal) => {
          let response: Response;
          try {
            response = await fetch(`/api/visit-schedule-proposals/${proposal.id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-org-id': orgId,
              },
              body: JSON.stringify(
                action === 'reject' ? { action, reject_reason: rejectReason } : { action },
              ),
            });
          } catch (error) {
            return {
              proposal,
              ok: false as const,
              message: error instanceof Error ? error.message : '一括更新に失敗しました',
              reachedServer: false,
            } satisfies BulkActionFailure;
          }

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            return {
              proposal,
              ok: false as const,
              message: error.message ?? '一括更新に失敗しました',
              reachedServer: true,
            } satisfies BulkActionFailure;
          }

          try {
            await response.json();
            return { proposal, ok: true as const };
          } catch (error) {
            return {
              proposal,
              ok: false as const,
              message: error instanceof Error ? error.message : '一括更新に失敗しました',
              reachedServer: true,
            } satisfies BulkActionFailure;
          }
        }),
      );

      return {
        action,
        succeeded: results.filter((result) => result.ok),
        failed: results.filter((result) => !result.ok),
      };
    },
    onSuccess: async (result) => {
      const successCount = result.succeeded.length;
      const failedCount = result.failed.length;
      const shouldRefreshAfterFailures = result.failed.some((item) => item.reachedServer);

      if (failedCount === 0) {
        toast.success(
          result.action === 'approve' ? '選択候補を承認しました' : '選択候補を却下しました',
        );
        clearSelectedProposals();
        await invalidateProposalQueries();
        return;
      }

      const failedIds = new Set(result.failed.map((item) => item.proposal.id));
      setSelectedIds((current) => current.filter((id) => failedIds.has(id)));
      setBulkConfirmAction(null);
      setBulkRejectReason('');
      setBulkActionFailureSummary({
        action: result.action,
        successCount,
        failureCount: failedCount,
        failures: result.failed.map((item) => ({
          id: item.proposal.id,
          patientName: item.proposal.case_.patient.name,
          proposedDate: item.proposal.proposed_date,
          timeWindowStart: item.proposal.time_window_start,
          timeWindowEnd: item.proposal.time_window_end,
          pharmacistName: item.proposal.proposed_pharmacist?.name ?? '担当未解決',
          vehicleLabel: item.proposal.vehicle_resource?.label ?? '社用車未指定',
          message: bulkActionFailureDisplayMessage(item),
        })),
      });

      if (successCount > 0) {
        toast.warning(
          `${successCount + failedCount}件中${successCount}件を処理しました。${failedCount}件は未更新です。選択中の候補を確認して再試行してください。`,
        );
        await invalidateProposalQueries();
      } else {
        toast.error(
          `${failedCount}件を更新できませんでした。選択中の候補を確認して再試行してください。`,
        );
        if (shouldRefreshAfterFailures) {
          await invalidateProposalQueries();
        }
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '一括更新に失敗しました');
    },
  });

  const reorderProposalMutation = useMutation({
    mutationFn: async ({
      routeOrderUpdates,
      confirmationContext,
    }: ProposalRouteOrderMutationInput) =>
      applyVisitScheduleProposalRouteUpdates({
        orgId,
        routeOrderUpdates,
        confirmationContext,
      }),
    onSuccess: async () => {
      setProposalRouteConfirmOpen(false);
      toast.success('候補群の route_order を最適順に更新しました');
      await invalidateProposalQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補順の更新に失敗しました');
    },
  });

  const reProposalMutation = useMutation({
    mutationFn: async () => {
      if (!detail) {
        throw new Error('再提案対象が選択されていません');
      }

      await proposalActionMutation.mutateAsync({
        id: detail.id,
        payload: {
          action: 'contact_attempt',
          outcome: 'change_requested',
          contact_method: contactForm.contact_method,
          contact_name: contactForm.contact_name || undefined,
          contact_phone: contactForm.contact_phone || undefined,
          note: [
            contactForm.note.trim(),
            reproposalForm.note.trim() ? `希望条件: ${reproposalForm.note.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      });

      const response = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          case_id: detail.case_id,
          visit_type: detail.visit_type,
          priority: reproposalForm.priority,
          travel_mode: routeTravelMode,
          start_date: reproposalForm.start_date || detail.proposed_date.slice(0, 10),
          preferred_time_from: reproposalForm.preferred_time_from || undefined,
          preferred_time_to: reproposalForm.preferred_time_to || undefined,
          vehicle_resource_id: reproposalForm.vehicle_resource_id || undefined,
          candidate_count: Number(
            reproposalForm.candidate_count ||
              proposalPreviewMap?.get(detail.id)?.suggested_schedule_slot_count ||
              '3',
          ),
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? '再提案の生成に失敗しました');
      }
      return response.json() as Promise<CreateProposalResponse>;
    },
    onSuccess: async (payload) => {
      setLastGenerationDiagnostics(payload.diagnostics ?? null);
      toast.success(`${payload.data.length}件の再提案候補を生成しました`);
      if ((payload.diagnostics?.rejected.length ?? 0) > 0) {
        toast.info(`採用外 ${payload.diagnostics?.rejected.length ?? 0} 件の理由を表示しています`);
      }
      setActiveTab('unapproved');
      replaceDashboardUrl({ status: 'proposed' });
      setSelectedIds([]);
      const nextId = payload.data[0]?.id ?? null;
      await invalidateProposalQueries();
      if (nextId) {
        openDetail(nextId);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '再提案に失敗しました');
    },
  });

  const rankedCandidates = useMemo(() => {
    if (!detail) return [];
    return [detail, ...detail.related_proposals].sort((left, right) => {
      const leftScore = left.route_distance_score ?? Number.POSITIVE_INFINITY;
      const rightScore = right.route_distance_score ?? Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return left.proposed_date.localeCompare(right.proposed_date);
    });
  }, [detail]);
  const detailPreview = detail ? (proposalPreviewMap?.get(detail.id) ?? null) : null;
  const currentDetailRouteIds = useMemo(() => {
    if (!detail) return [];
    const proposalRouteOrderById = new Map(
      [detail, ...detail.related_proposals].map((proposal) => [
        `proposal:${proposal.id}`,
        proposal.route_order ?? Number.MAX_SAFE_INTEGER,
      ]),
    );
    return [...detail.route_preview.points]
      .sort((left, right) => {
        const leftOrder =
          left.point_kind === 'proposal'
            ? (proposalRouteOrderById.get(left.schedule_id) ?? Number.MAX_SAFE_INTEGER)
            : (detail.pharmacist_day_schedules.find((schedule) => schedule.id === left.schedule_id)
                ?.route_order ?? Number.MAX_SAFE_INTEGER);
        const rightOrder =
          right.point_kind === 'proposal'
            ? (proposalRouteOrderById.get(right.schedule_id) ?? Number.MAX_SAFE_INTEGER)
            : (detail.pharmacist_day_schedules.find((schedule) => schedule.id === right.schedule_id)
                ?.route_order ?? Number.MAX_SAFE_INTEGER);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (left.time_window_start ?? '').localeCompare(right.time_window_start ?? '');
      })
      .map((point) => point.schedule_id);
  }, [detail]);
  const detailRouteDraft = useRouteOrderDraft({
    sourceKey: `${activeDetailId ?? 'none'}:${routeTravelMode}:${detail?.route_preview.plan.orderedScheduleIds.join(',') ?? ''}:${currentDetailRouteIds.join(',')}`,
    optimizedIds: detail?.route_preview.plan.orderedScheduleIds ?? currentDetailRouteIds,
    currentIds: currentDetailRouteIds,
  });
  const detailProposalRouteUpdates = useMemo<VisitScheduleProposalRouteUpdate[]>(() => {
    return detailRouteDraft.draftIds
      .map((item, index) =>
        item.startsWith('proposal:')
          ? {
              proposal_id: item.replace('proposal:', ''),
              route_order: index + 1,
            }
          : null,
      )
      .filter((item): item is VisitScheduleProposalRouteUpdate => item != null);
  }, [detailRouteDraft.draftIds]);
  const proposalRouteConfirmItems = useMemo(() => {
    if (!detail) return [];
    const proposalById = new Map(
      [detail, ...detail.related_proposals].map((proposal) => [proposal.id, proposal]),
    );
    return detailProposalRouteUpdates
      .map((update) => {
        const proposal = proposalById.get(update.proposal_id);
        if (!proposal) return null;
        return {
          id: proposal.id,
          patientName: proposal.case_.patient.name,
          safeIdentifier: proposalSafeIdentifierLabel(proposal),
          time: `${formatDateLabel(proposal.proposed_date)} ${timeLabel(
            proposal.time_window_start,
            proposal.time_window_end,
          )}`,
          currentOrder: proposal.route_order,
          nextOrder: update.route_order,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [detail, detailProposalRouteUpdates]);
  const proposalRouteConfirmationContext = useMemo<VisitRouteConfirmationContext | null>(() => {
    if (!detail) return null;
    return {
      source: 'proposal_detail_route_preview',
      date: detail.proposed_date.slice(0, 10),
      pharmacist_id: detail.proposed_pharmacist_id,
      travel_mode: routeTravelMode,
      target_count: detailProposalRouteUpdates.length,
      route_order_diff_count: detailRouteDraft.diffCount,
    };
  }, [detail, detailProposalRouteUpdates.length, detailRouteDraft.diffCount, routeTravelMode]);

  const routeMapPoints = useMemo(() => {
    if (!detail) return [];
    const planById = new Map(
      detail.route_preview.plan.stopSummaries.map((summary) => [summary.scheduleId, summary]),
    );
    const draftIndexById = new Map(
      detailRouteDraft.draftIds.map((scheduleId, index) => [scheduleId, index + 1]),
    );
    return detail.route_preview.points.map((point) => ({
      scheduleId: point.schedule_id,
      patientName: point.patient_name,
      address: point.address,
      lat: point.lat,
      lng: point.lng,
      orderLabel: String(draftIndexById.get(point.schedule_id) ?? '•'),
      status: point.schedule_status,
      priority: point.priority,
      pointKind: point.point_kind,
      timeLabel: timeLabel(point.time_window_start, point.time_window_end),
      etaLabel: detailRouteDraft.manualDirty
        ? null
        : formatEtaLabel(
            detail.proposed_date.slice(0, 10),
            point.time_window_start,
            planById.get(point.schedule_id)?.arrivalOffsetSeconds ?? null,
          ),
    }));
  }, [detail, detailRouteDraft.draftIds, detailRouteDraft.manualDirty]);
  const detailRouteSelectionLabel = detail
    ? `${formatDateLabel(detail.proposed_date)} / ${detail.proposed_pharmacist?.name ?? '担当未解決'}`
    : null;
  const detailTargetLabel = detail ? proposalActionTargetLabel(detail) : null;

  const allVisibleSelected =
    visibleProposals.length > 0 &&
    visibleProposals.every((proposal) => selectedIds.includes(proposal.id));
  const activeBulkActionFailureSummary = useMemo(() => {
    if (!bulkActionFailureSummary) return null;

    const actionableFailureIds = new Set(
      visibleProposals
        .filter((proposal) => canApplyBulkProposalAction(proposal, bulkActionFailureSummary.action))
        .map((proposal) => proposal.id),
    );
    const failures = bulkActionFailureSummary.failures.filter((failure) =>
      actionableFailureIds.has(failure.id),
    );
    if (failures.length === 0) return null;

    return {
      ...bulkActionFailureSummary,
      failureCount: failures.length,
      failures,
    };
  }, [bulkActionFailureSummary, visibleProposals]);
  const bulkApproveEligibleCount = bulkApproveEligibleProposals.length;
  const bulkRejectEligibleCount = bulkRejectEligibleProposals.length;
  const bulkConfirmEligibleCount = bulkConfirmEligibleProposals.length;
  const bulkConfirmSkippedCount = bulkConfirmAction
    ? Math.max(0, selectedProposals.length - bulkConfirmEligibleCount)
    : 0;
  const bulkConfirmActionLabel = bulkConfirmAction === 'approve' ? '一括承認' : '一括却下';
  const trimmedBulkRejectReason = bulkRejectReason.trim();
  const bulkRejectReasonInvalid =
    bulkConfirmAction === 'reject' && trimmedBulkRejectReason.length === 0;
  const singleConfirmProposal = singleConfirmAction?.proposal ?? null;
  const singleConfirmTargetLabel = singleConfirmProposal
    ? proposalActionTargetLabel(singleConfirmProposal)
    : null;
  const singleConfirmTitle =
    singleConfirmAction && singleConfirmTargetLabel
      ? `${singleConfirmTargetLabel} を${singleProposalActionQuestion(singleConfirmAction.action)}`
      : '訪問候補の操作を確認します';
  const singleConfirmDescription =
    singleConfirmAction?.action === 'approve'
      ? '承認後は患者連絡待ちへ進みます。日時確定ではありません。'
      : '患者確認済みの候補を訪問予定として確定します。';
  const bulkConfirmTitle =
    bulkConfirmAction === 'approve'
      ? `選択中${bulkConfirmEligibleCount}件の訪問候補を一括承認しますか`
      : `選択中${bulkConfirmEligibleCount}件の訪問候補を一括却下しますか`;
  const bulkConfirmDescription =
    bulkConfirmAction === 'approve'
      ? '承認後は患者連絡待ちへ進みます。日時確定ではありません。対象患者、候補日、担当、社用車を確認してください。'
      : '却下すると選択候補から外れます。患者連絡中の候補は辞退扱いとして記録される場合があります。対象患者、候補日、担当、社用車を確認してください。';
  const bulkConfirmDateRange =
    dateFrom || dateTo
      ? `${dateFrom ? formatDateLabel(dateFrom) : '開始日未指定'} - ${
          dateTo ? formatDateLabel(dateTo) : '終了日未指定'
        }`
      : '日付指定なし';
  const bulkRejectButtonLabel =
    bulkRejectEligibleCount > 0
      ? `選択中${bulkRejectEligibleCount}件の訪問候補を一括却下`
      : '却下できる訪問候補を選択して一括却下';
  const bulkApproveButtonLabel =
    bulkApproveEligibleCount > 0
      ? `選択中${bulkApproveEligibleCount}件の訪問候補を一括承認`
      : '承認できる訪問候補を選択して一括承認';
  const caseSearchResults = casesQuery.data?.data ?? [];
  const vehicleResourceOptions = vehicleResourcesQuery.data?.data ?? [];
  const selectedReproposalVehicle = vehicleResourceOptions.find(
    (vehicle) => vehicle.id === reproposalForm.vehicle_resource_id,
  );
  const rescheduleFilterActive = filterPreset === 'reschedule';
  const todayFilterActive =
    filterPreset === 'today' ||
    (activeTab === 'unapproved' && dateFrom === todayKey() && dateTo === todayKey());
  const presetBanner =
    filterPreset === 'contact'
      ? {
          title: '未架電・連絡対応の候補を表示中です。',
          description: '患者連絡中タブに固定し、架電や折返し確認が必要な候補を優先表示しています。',
          icon: PhoneCall,
          className: 'border-sky-200 bg-sky-50 text-sky-900',
        }
      : filterPreset === 'reschedule'
        ? {
            title: '再調整が必要な候補を表示中です。',
            description: 'リスケ由来の候補に絞り、差替や再提案が必要な案件を追いやすくしています。',
            icon: RefreshCw,
            className: 'border-orange-200 bg-orange-50 text-orange-900',
          }
        : filterPreset === 'today'
          ? {
              title: '本日候補を表示中です。',
              description:
                '当日中に処理したい未承認候補へすぐ着手できるよう、今日の日付帯で絞り込んでいます。',
              icon: CalendarClock,
              className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
            }
          : filterPreset === 'stale'
            ? {
                title: '差替済み・期限切れ候補を表示中です。',
                description:
                  '却下タブに切り替え、追跡が必要な stale 候補を確認しやすくしています。',
                icon: XCircle,
                className: 'border-amber-200 bg-amber-50 text-amber-900',
              }
            : null;
  const PresetBannerIcon = presetBanner?.icon;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <PageSection
          title="提案フィルタ"
          description="ケース検索、即時対応 preset、日付帯で候補を絞り込みます。"
          tone="subtle"
        >
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,0.7fr))]">
              <div className="space-y-1.5">
                <Label htmlFor="proposal-case-search">ケース/患者検索</Label>
                <Input
                  id="proposal-case-search"
                  value={caseSearchInput}
                  onChange={(event) => setCaseSearchInput(event.target.value)}
                  placeholder="患者名・かなで検索"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proposal-date-from">候補日 From</Label>
                <Input
                  id="proposal-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDateFrom(value);
                    clearSelectedProposals();
                    replaceDashboardUrl({ date_from: value });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proposal-date-to">候補日 To</Label>
                <Input
                  id="proposal-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDateTo(value);
                    clearSelectedProposals();
                    replaceDashboardUrl({ date_to: value });
                  }}
                />
              </div>
            </div>

            {effectiveSelectedCaseSummary ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {effectiveSelectedCaseSummary.patient.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ケース固定中
                    {' / '}
                    ケース {shortEntityIdentifier(effectiveSelectedCaseSummary.id)}
                    {' / '}
                    患者識別 {shortEntityIdentifier(effectiveSelectedCaseSummary.patient.id)}
                    {' / '}
                    主担当 {caseOptionPrimaryPharmacistLabel(effectiveSelectedCaseSummary)}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={clearCaseFilter}>
                  ケース固定を解除
                </Button>
              </div>
            ) : null}

            {caseSearchInput.trim().length >= 2 ? (
              <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/10 p-3">
                <p className="text-xs font-medium text-muted-foreground">検索結果</p>
                {casesQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">ケース候補を読み込み中...</p>
                ) : caseSearchResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">一致するケースはありません。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {caseSearchResults.map((careCase) => (
                      <Button
                        key={careCase.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn(
                          PROPOSAL_TOUCH_TARGET_CLASS,
                          'h-auto whitespace-normal py-2 text-left',
                        )}
                        aria-label={`${caseOptionTargetLabel(careCase)} で候補を絞り込む`}
                        onClick={() => applyCaseFilter(careCase)}
                      >
                        <span className="flex flex-col items-start leading-tight">
                          <span>{careCase.patient.name}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            ケース {shortEntityIdentifier(careCase.id)} / 患者識別{' '}
                            {shortEntityIdentifier(careCase.patient.id)} / 主担当{' '}
                            {caseOptionPrimaryPharmacistLabel(careCase)}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">即時対応 preset</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={todayFilterActive ? 'default' : 'outline'}
                  onClick={() => activatePreset('today')}
                >
                  本日候補
                  <Badge variant="outline" className="ml-2 bg-white/80">
                    {todayFilterCount}
                  </Badge>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={activeTab === 'patient_contact_pending' ? 'default' : 'outline'}
                  onClick={() => activatePreset('contact')}
                >
                  要患者連絡
                  <Badge variant="outline" className="ml-2 bg-white/80">
                    {tabCounts.patient_contact_pending}
                  </Badge>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={rescheduleFilterActive ? 'default' : 'outline'}
                  onClick={() => activatePreset(rescheduleFilterActive ? 'all' : 'reschedule')}
                >
                  リスケ由来
                  <Badge variant="outline" className="ml-2 bg-white/80">
                    {rescheduleCount}
                  </Badge>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={activeTab === 'rejected' ? 'default' : 'outline'}
                  onClick={() => activatePreset('stale')}
                >
                  差替/期限切れ
                  <Badge variant="outline" className="ml-2 bg-white/80">
                    {tabCounts.stale}
                  </Badge>
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
                  条件をクリア
                </Button>
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection
          title="次の操作"
          description="候補確認の前後に使う関連画面へ移動します。"
          tone="subtle"
          contentClassName="space-y-3"
        >
          <Link
            href="/schedules"
            className="flex min-h-[44px] items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
          >
            本日の訪問予定へ
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            href="/workflow"
            className="flex min-h-[44px] items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
          >
            例外・未接続案件を確認
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <div className="rounded-xl border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
            差替済み / 期限切れ: {tabCounts.stale} 件
          </div>
        </PageSection>
      </div>

      {presetBanner ? (
        <Alert className={presetBanner.className} data-testid="proposal-preset-banner">
          {PresetBannerIcon ? <PresetBannerIcon className="size-4" aria-hidden="true" /> : null}
          <AlertDescription className="space-y-1 text-current">
            <p className="font-medium">{presetBanner.title}</p>
            <p>{presetBanner.description}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <PageSection
        title="対象候補と一括操作"
        description="表示タブ、候補件数、選択数を確認し、表示中の候補に対する一括承認・却下を行います。"
        tone="subtle"
        actions={
          <ActionRail>
            <Button
              variant="outline"
              size="sm"
              className={PROPOSAL_TOUCH_TARGET_CLASS}
              onClick={() => setBulkConfirmAction('reject')}
              disabled={bulkRejectEligibleCount === 0 || bulkActionMutation.isPending}
              aria-label={bulkRejectButtonLabel}
            >
              <XCircle className="mr-1.5 size-4" />
              {bulkRejectButtonLabel}
            </Button>
            <Button
              size="sm"
              className={PROPOSAL_TOUCH_TARGET_CLASS}
              onClick={() => setBulkConfirmAction('approve')}
              disabled={bulkApproveEligibleCount === 0 || bulkActionMutation.isPending}
              aria-label={bulkApproveButtonLabel}
            >
              <CheckCircle2 className="mr-1.5 size-4" />
              {bulkApproveButtonLabel}
            </Button>
          </ActionRail>
        }
        contentClassName="space-y-4"
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const nextTab = value as DashboardTab;
            setActiveTab(nextTab);
            clearSelectedProposals();
            replaceDashboardUrl({
              status:
                nextTab === 'patient_contact_pending'
                  ? 'patient_contact_pending'
                  : nextTab === 'confirmed'
                    ? 'confirmed'
                    : nextTab === 'rejected'
                      ? 'rejected'
                      : 'proposed',
            });
          }}
          className="space-y-4"
        >
          <TabsList variant="line" className="flex w-full flex-wrap justify-start gap-2">
            {(Object.keys(TAB_LABELS) as DashboardTab[]).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="gap-2">
                {TAB_LABELS[tab]}
                <Badge variant="outline">{tabCounts[tab]}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-[44px] items-center gap-3 text-sm">
            <Checkbox
              className={PROPOSAL_CHECKBOX_TOUCH_TARGET_CLASS}
              checked={allVisibleSelected}
              onCheckedChange={(checked) => {
                setBulkActionFailureSummary(null);
                setSelectedIds(checked ? visibleProposals.map((proposal) => proposal.id) : []);
              }}
              aria-label="表示中の候補をすべて選択"
            />
            表示中の候補をすべて選択
          </label>
          <div className="min-w-0 flex-1">
            <FilterSummaryBar
              items={[
                { label: '表示候補', value: `${visibleProposals.length}件` },
                { label: '選択中', value: `${selectedProposals.length}件` },
                { label: '本日候補', value: `${todayFilterCount}件` },
                {
                  label: '患者連絡中',
                  value: `${tabCounts.patient_contact_pending}件`,
                  tone: tabCounts.patient_contact_pending > 0 ? 'warning' : 'default',
                },
                {
                  label: '差替/期限切れ',
                  value: `${tabCounts.stale}件`,
                  tone: tabCounts.stale > 0 ? 'warning' : 'default',
                },
              ]}
            />
          </div>
        </div>

        {activeBulkActionFailureSummary ? (
          <Alert
            className="border-amber-300 bg-amber-50 text-amber-900"
            data-testid="proposal-bulk-partial-failure"
          >
            <XCircle className="size-4" aria-hidden="true" />
            <AlertDescription className="space-y-2 text-current">
              <p className="font-medium">
                {activeBulkActionFailureSummary.successCount > 0
                  ? `${activeBulkActionFailureSummary.successCount + activeBulkActionFailureSummary.failureCount}件中${activeBulkActionFailureSummary.successCount}件を処理しました。${activeBulkActionFailureSummary.failureCount}件は未更新です。`
                  : `${activeBulkActionFailureSummary.failureCount}件を更新できませんでした。`}
              </p>
              <ul aria-label="未更新の訪問候補" className="space-y-2">
                {activeBulkActionFailureSummary.failures.map((failure) => (
                  <li
                    key={failure.id}
                    className="rounded-md border border-amber-200 bg-white/70 p-2"
                  >
                    <p className="font-medium">{failure.patientName}</p>
                    <p className="text-xs leading-5">
                      {formatDateLabel(failure.proposedDate)}{' '}
                      {timeLabel(failure.timeWindowStart, failure.timeWindowEnd)} /{' '}
                      {failure.pharmacistName} / {failure.vehicleLabel} / 候補{' '}
                      {shortEntityIdentifier(failure.id)}
                    </p>
                    <p className="text-xs leading-5">未更新理由: {failure.message}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        PROPOSAL_TOUCH_TARGET_CLASS,
                        'mt-2 border-amber-300 bg-white text-amber-950 hover:bg-amber-100',
                      )}
                      onClick={() => openDetail(failure.id)}
                      aria-label={`${failure.patientName} ${formatDateLabel(failure.proposedDate)} ${timeLabel(failure.timeWindowStart, failure.timeWindowEnd)} / 候補 ${shortEntityIdentifier(failure.id)} の未更新候補を詳細で確認`}
                    >
                      該当候補を確認
                      <ChevronRight className="ml-1 size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </PageSection>

      <div className="grid gap-4">
        {visibleDiagnostics ? (
          <VisitProposalDiagnosticsCard
            diagnostics={visibleDiagnostics}
            actions={buildDashboardDiagnosticActions({
              diagnostics: visibleDiagnostics,
              travelMode: routeTravelMode,
              nextBillableDate: detailPreview?.cadence.next_billable_date ?? null,
              currentStartDate: reproposalForm.start_date,
              onSetTravelMode: (value) => {
                setRouteTravelMode(value);
                replaceDashboardUrl({ travel_mode: value });
              },
              onSetCandidateCount: (value) =>
                setReproposalFormDraft((current) => ({
                  ...(current ?? reproposalForm),
                  candidate_count: value,
                })),
              onSetStartDate: (value) =>
                setReproposalFormDraft((current) => ({
                  ...(current ?? reproposalForm),
                  start_date: value,
                })),
              onExpandTimeWindow: () =>
                setReproposalFormDraft((current) => ({
                  ...(current ?? reproposalForm),
                  preferred_time_from: '09:00',
                  preferred_time_to: '18:00',
                })),
              onSetPriorityEmergency: () =>
                setReproposalFormDraft((current) => ({
                  ...(current ?? reproposalForm),
                  priority: 'emergency',
                })),
              onOpenOptimizer: () =>
                replaceDashboardUrl({
                  workspace: 'optimizer',
                  optimizer_case_id: detail?.case_id ?? null,
                  optimizer_travel_mode: routeTravelMode,
                }),
              onScrollToReproposal: () =>
                document
                  .getElementById('schedule-proposal-reproposal')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            })}
          />
        ) : null}

        {proposalsQuery.isLoading ? (
          <Card>
            <CardContent className="py-10 text-sm text-muted-foreground">
              訪問候補を読み込み中...
            </CardContent>
          </Card>
        ) : visibleProposals.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-sm text-muted-foreground">
              条件に一致する訪問候補はありません。
            </CardContent>
          </Card>
        ) : (
          visibleProposals.map((proposal) => {
            const proposalPreview = proposalPreviewMap?.get(proposal.id);
            const proposalCadence = proposalPreview?.cadence ?? null;
            const proposalWarningMessages =
              proposalPreview?.alerts
                ?.filter((alert) => alert.severity !== 'info')
                .map((alert) => alert.message) ?? [];
            const canApprove = ['proposed', 'reschedule_pending'].includes(
              proposal.proposal_status,
            );
            const canConfirm =
              proposal.proposal_status === 'patient_contact_pending' &&
              proposal.patient_contact_status === 'confirmed';
            const impactedCount = readImpactCount(
              proposal.reschedule_source_schedule?.override_request?.impact_summary,
            );
            const impactedNames = readImpactedPatientNames(
              proposal.reschedule_source_schedule?.override_request?.impact_summary,
            );
            const proposalTargetLabel = proposalActionTargetLabel(proposal);

            return (
              <Card
                key={proposal.id}
                id={`proposal-${proposal.id}`}
                data-testid={
                  activeDetailId === proposal.id ? 'schedule-proposal-active-row' : undefined
                }
                className={cn(
                  'border-border/70 bg-card/95 scroll-mt-28',
                  activeDetailId === proposal.id ? 'ring-2 ring-primary/30' : null,
                )}
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className={PROPOSAL_CHECKBOX_TOUCH_TARGET_CLASS}
                        checked={selectedIds.includes(proposal.id)}
                        onCheckedChange={(checked) => {
                          setBulkActionFailureSummary(null);
                          setSelectedIds((current) =>
                            checked
                              ? Array.from(new Set([...current, proposal.id]))
                              : current.filter((id) => id !== proposal.id),
                          );
                        }}
                        aria-label={`${proposalTargetLabel} の候補を選択`}
                      />
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold text-foreground">
                            {proposal.case_.patient.name}
                          </p>
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(proposal.proposal_status)}
                          >
                            {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                          </Badge>
                          <Badge variant="outline">
                            {CONTACT_STATUS_LABELS[proposal.patient_contact_status]}
                          </Badge>
                          <Badge variant="outline">{PRIORITY_LABELS[proposal.priority]}</Badge>
                          <Badge variant="outline">{proposalSafeIdentifierLabel(proposal)}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-4" />
                            {formatDateLabel(proposal.proposed_date)}{' '}
                            {timeLabel(proposal.time_window_start, proposal.time_window_end)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="size-4" />
                            {proposal.proposed_pharmacist?.name ?? '担当未解決'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Route className="size-4" />
                            スコア {formatDistanceLabel(proposal.route_distance_score)}
                          </span>
                          {proposal.vehicle_resource ? (
                            <span className="inline-flex items-center gap-1">
                              <Car className="size-4" />
                              {proposal.vehicle_resource.label}
                            </span>
                          ) : null}
                        </div>
                        <ProposalDecisionBadges proposal={proposal} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className={PROPOSAL_TOUCH_TARGET_CLASS}
                        onClick={() => openDetail(proposal.id)}
                        aria-label={`${proposalTargetLabel} の候補詳細を開く`}
                      >
                        詳細
                      </Button>
                      {canApprove ? (
                        <Button
                          size="sm"
                          className={PROPOSAL_TOUCH_TARGET_CLASS}
                          onClick={() => setSingleConfirmAction({ proposal, action: 'approve' })}
                          disabled={proposalActionMutation.isPending}
                          aria-label={`${proposalTargetLabel} を承認して患者連絡へ進める`}
                        >
                          承認して連絡へ
                        </Button>
                      ) : null}
                      {canConfirm ? (
                        <Button
                          size="sm"
                          className={PROPOSAL_TOUCH_TARGET_CLASS}
                          onClick={() => setSingleConfirmAction({ proposal, action: 'confirm' })}
                          disabled={proposalActionMutation.isPending}
                          aria-label={`${proposalTargetLabel} を日時確定する`}
                        >
                          日時確定
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="space-y-3">
                      <ProposalHumanDecisionFlow proposal={proposal} compact />

                      <ProposalReasonChips proposal={proposal} />
                      <p className="text-sm text-muted-foreground">
                        {proposalListVisitPlaceLabel(proposal)}
                      </p>
                      {proposal.escalation_reason ? (
                        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          {proposal.escalation_reason}
                        </p>
                      ) : null}
                      {proposalCadence ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                          <p className="font-medium">算定 cadence</p>
                          <p className="mt-1">
                            次回算定可能日: {proposalCadence.next_billable_date ?? '提案不可'} /
                            残回数 {proposalCadence.remaining_month_count}
                          </p>
                          {proposalWarningMessages.length > 0 ? (
                            <p className="mt-1 text-xs text-amber-800">
                              {proposalWarningMessages.slice(0, 2).join(' / ')}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {impactedCount ? (
                        <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                          リスケ影響 {impactedCount} 件
                          {impactedNames.length > 0 ? ` / ${impactedNames.join('、')}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <ProposalOperationalFacts proposal={proposal} />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <AlertDialog
        open={singleConfirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !proposalActionMutation.isPending) {
            setSingleConfirmAction(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{singleConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{singleConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          {singleConfirmAction && singleConfirmProposal ? (
            <div className="space-y-3 text-sm">
              <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">操作</dt>
                  <dd className="font-medium">
                    {singleProposalActionLabel(singleConfirmAction.action)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">実行後</dt>
                  <dd className="font-medium">
                    {singleProposalActionResultLabel(singleConfirmAction.action)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">患者</dt>
                  <dd className="font-medium">{singleConfirmProposal.case_.patient.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">候補日時</dt>
                  <dd className="font-medium">
                    {formatDateLabel(singleConfirmProposal.proposed_date)}{' '}
                    {timeLabel(
                      singleConfirmProposal.time_window_start,
                      singleConfirmProposal.time_window_end,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">識別子</dt>
                  <dd className="font-medium">
                    {proposalSafeIdentifierLabel(singleConfirmProposal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">担当</dt>
                  <dd className="font-medium">
                    {singleConfirmProposal.proposed_pharmacist?.name ?? '担当未解決'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">社用車</dt>
                  <dd className="font-medium">
                    {singleConfirmProposal.vehicle_resource?.label ?? '社用車未指定'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">現在の候補状態</dt>
                  <dd className="font-medium">
                    {PROPOSAL_STATUS_LABELS[singleConfirmProposal.proposal_status]}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">患者連絡</dt>
                  <dd className="font-medium">
                    {CONTACT_STATUS_LABELS[singleConfirmProposal.patient_contact_status]}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                住所や連絡先、薬剤・処方に関する細かな内容はこの確認画面には表示しません。対象患者・候補日・担当・社用車・識別子だけを確認してから実行してください。
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={proposalActionMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!singleConfirmAction) return;
                proposalActionMutation.mutate({
                  id: singleConfirmAction.proposal.id,
                  payload: { action: singleConfirmAction.action },
                });
              }}
              disabled={!singleConfirmAction || proposalActionMutation.isPending}
            >
              {proposalActionMutation.isPending
                ? '処理中...'
                : singleConfirmAction
                  ? singleProposalActionLabel(singleConfirmAction.action)
                  : '実行'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkConfirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !bulkActionMutation.isPending) {
            setBulkConfirmAction(null);
            setBulkRejectReason('');
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{bulkConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">操作</dt>
                <dd className="font-medium">{bulkConfirmActionLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">実行対象</dt>
                <dd className="font-medium">{bulkConfirmEligibleCount}件</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">表示タブ / 絞り込み</dt>
                <dd className="font-medium">
                  {TAB_LABELS[activeTab]} / {FILTER_PRESET_LABELS[filterPreset]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">日付範囲</dt>
                <dd className="font-medium">{bulkConfirmDateRange}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">対象外</dt>
                <dd className="font-medium">{bulkConfirmSkippedCount}件</dd>
              </div>
            </dl>

            <ul
              aria-label="一括操作の対象候補"
              className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2"
            >
              {bulkConfirmEligibleProposals.map((proposal) => (
                <li key={proposal.id} className="rounded-md bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{proposal.case_.patient.name}</span>
                    <Badge variant="outline" className={statusBadgeClass(proposal.proposal_status)}>
                      {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                    </Badge>
                    <Badge variant="outline">{PRIORITY_LABELS[proposal.priority]}</Badge>
                    <Badge variant="outline">{proposalSafeIdentifierLabel(proposal)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateLabel(proposal.proposed_date)}{' '}
                    {timeLabel(proposal.time_window_start, proposal.time_window_end)} /{' '}
                    {proposal.proposed_pharmacist?.name ?? '担当未解決'} /{' '}
                    {proposal.vehicle_resource?.label ?? '社用車未指定'}
                  </p>
                </li>
              ))}
            </ul>

            {bulkConfirmAction === 'reject' ? (
              <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <Label htmlFor="bulk-reject-reason">却下理由</Label>
                <Textarea
                  id="bulk-reject-reason"
                  value={bulkRejectReason}
                  onChange={(event) => setBulkRejectReason(event.target.value)}
                  placeholder="例: 患者都合によりこの候補日は見送り"
                  aria-describedby={
                    bulkRejectReasonInvalid
                      ? 'bulk-reject-reason-help bulk-reject-reason-error'
                      : 'bulk-reject-reason-help'
                  }
                  aria-invalid={bulkRejectReasonInvalid}
                  disabled={bulkActionMutation.isPending}
                  autoFocus
                  required
                />
                {bulkRejectReasonInvalid ? (
                  <p
                    id="bulk-reject-reason-error"
                    role="alert"
                    className="text-xs font-medium text-destructive"
                  >
                    却下理由を入力してください。
                  </p>
                ) : null}
                <p id="bulk-reject-reason-help" className="text-xs leading-5 text-muted-foreground">
                  入力した理由は実行対象 {bulkConfirmEligibleCount}{' '}
                  件すべてに記録されます。住所、電話番号、薬剤名、処方詳細は入力しないでください。
                </p>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              住所、電話番号、薬剤名、処方詳細はこの確認画面には表示しません。対象患者・候補日・担当・社用車・識別子だけを確認してから実行してください。
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkActionMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              variant={bulkConfirmAction === 'reject' ? 'destructive' : 'default'}
              onClick={() => {
                if (!bulkConfirmAction || bulkConfirmEligibleCount === 0) return;
                setBulkActionFailureSummary(null);
                if (bulkConfirmAction === 'reject') {
                  bulkActionMutation.mutate({
                    action: 'reject',
                    reject_reason: trimmedBulkRejectReason,
                  });
                  return;
                }
                bulkActionMutation.mutate({ action: 'approve' });
              }}
              disabled={
                !bulkConfirmAction ||
                bulkConfirmEligibleCount === 0 ||
                bulkActionMutation.isPending ||
                bulkRejectReasonInvalid
              }
            >
              {bulkActionMutation.isPending
                ? '一括処理中...'
                : bulkConfirmAction === 'approve'
                  ? `${bulkConfirmEligibleCount}件を一括承認`
                  : `${bulkConfirmEligibleCount}件を一括却下`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={proposalRouteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !reorderProposalMutation.isPending) {
            setProposalRouteConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>候補群の route_order を反映しますか</AlertDialogTitle>
            <AlertDialogDescription>
              候補詳細で確認した対象日、薬剤師、移動手段、候補順序を反映します。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 text-sm">
            <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">対象候補</dt>
                <dd className="font-medium">{detailTargetLabel ?? '候補未選択'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">対象日 / 薬剤師</dt>
                <dd className="font-medium">{detailRouteSelectionLabel ?? '未設定'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">移動手段</dt>
                <dd className="font-medium">{VISIT_ROUTE_TRAVEL_MODE_LABELS[routeTravelMode]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">候補 / 差分</dt>
                <dd className="font-medium">
                  {proposalRouteConfirmItems.length}件 / {detailRouteDraft.diffCount}件
                </dd>
              </div>
            </dl>

            <ul
              aria-label="候補ルート順反映の対象候補"
              className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-2"
            >
              {proposalRouteConfirmItems.map((proposal) => (
                <li key={proposal.id} className="rounded-md bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {proposal.nextOrder}. {proposal.patientName}
                    </span>
                    <Badge variant="outline">{proposal.safeIdentifier}</Badge>
                    <Badge variant="outline">
                      現在 {proposal.currentOrder ?? '未設定'} → {proposal.nextOrder}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{proposal.time}</p>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-muted-foreground">
              住所、電話番号、薬剤名、処方詳細はこの確認画面には表示しません。候補日・担当・患者順序が一致している場合のみ反映してください。
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={reorderProposalMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!proposalRouteConfirmationContext) return;
                reorderProposalMutation.mutate({
                  routeOrderUpdates: detailProposalRouteUpdates,
                  confirmationContext: proposalRouteConfirmationContext,
                });
              }}
              disabled={
                reorderProposalMutation.isPending ||
                detailProposalRouteUpdates.length === 0 ||
                !detailRouteDraft.differsFromCurrent ||
                !proposalRouteConfirmationContext
              }
            >
              {reorderProposalMutation.isPending
                ? '候補順を反映中...'
                : `${detailProposalRouteUpdates.length}件の候補順を反映`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={activeDetailId !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDetailId(null);
          replaceDashboardUrl({
            detail: null,
            focus: caseId || patientId ? 'patient' : null,
          });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {detailTargetLabel ? `${detailTargetLabel} の訪問候補詳細` : '訪問候補の詳細'}
            </SheetTitle>
            <SheetDescription>
              {detail
                ? `${PROPOSAL_STATUS_LABELS[detail.proposal_status]} / ${CONTACT_STATUS_LABELS[detail.patient_contact_status]}。候補比較、当日ルート、患者連絡、再提案までここで完結させます。`
                : '候補比較、当日ルート、患者連絡、再提案までここで完結させます。'}
            </SheetDescription>
          </SheetHeader>

          {!detail || detailQuery.isLoading ? (
            <div className="py-10 text-sm text-muted-foreground">詳細を読み込み中...</div>
          ) : (
            <div className="mt-6 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <h2 className="font-heading text-base leading-snug font-medium">
                    {detail.case_.patient.name}
                  </h2>
                  <CardDescription>
                    {formatDateLabel(detail.proposed_date)}{' '}
                    {timeLabel(detail.time_window_start, detail.time_window_end)} /{' '}
                    {detail.proposed_pharmacist?.name ?? '担当未解決'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={statusBadgeClass(detail.proposal_status)}>
                      {PROPOSAL_STATUS_LABELS[detail.proposal_status]}
                    </Badge>
                    <Badge variant="outline">
                      {CONTACT_STATUS_LABELS[detail.patient_contact_status]}
                    </Badge>
                    <Badge variant="outline">{PRIORITY_LABELS[detail.priority]}</Badge>
                  </div>
                  <ProposalDecisionBadges proposal={detail} />
                  <div className="flex flex-wrap gap-2">
                    {detail.proposal_status !== 'patient_contact_pending' &&
                    ['proposed', 'reschedule_pending'].includes(detail.proposal_status) ? (
                      <Button
                        size="sm"
                        className={PROPOSAL_TOUCH_TARGET_CLASS}
                        onClick={() =>
                          setSingleConfirmAction({ proposal: detail, action: 'approve' })
                        }
                        disabled={proposalActionMutation.isPending}
                        aria-label={
                          detailTargetLabel
                            ? `${detailTargetLabel} を承認して患者連絡へ進める`
                            : undefined
                        }
                      >
                        承認して連絡へ
                      </Button>
                    ) : null}
                    {detail.proposal_status === 'patient_contact_pending' ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className={PROPOSAL_TOUCH_TARGET_CLASS}
                          onClick={() =>
                            proposalActionMutation.mutate({
                              id: detail.id,
                              payload: {
                                action: 'contact_attempt',
                                outcome: contactForm.outcome,
                                contact_method: contactForm.contact_method,
                                contact_name: contactForm.contact_name || undefined,
                                contact_phone: contactForm.contact_phone || undefined,
                                note: contactForm.note || undefined,
                                callback_due_at: contactForm.callback_due_at
                                  ? new Date(contactForm.callback_due_at).toISOString()
                                  : undefined,
                              },
                            })
                          }
                          disabled={proposalActionMutation.isPending}
                          aria-label={
                            detailTargetLabel
                              ? `${detailTargetLabel} の連絡結果を保存する`
                              : undefined
                          }
                        >
                          連絡結果を保存
                        </Button>
                        <Button
                          size="sm"
                          className={PROPOSAL_TOUCH_TARGET_CLASS}
                          onClick={() =>
                            setSingleConfirmAction({ proposal: detail, action: 'confirm' })
                          }
                          disabled={
                            proposalActionMutation.isPending ||
                            detail.patient_contact_status !== 'confirmed'
                          }
                          aria-label={
                            detailTargetLabel ? `${detailTargetLabel} を日時確定する` : undefined
                          }
                        >
                          日時確定
                        </Button>
                      </>
                    ) : null}
                    {detail.finalized_schedule ? (
                      <Link
                        href={`/visits/${detail.finalized_schedule.id}/record`}
                        className={cn(
                          PROPOSAL_TOUCH_TARGET_CLASS,
                          'inline-flex items-center rounded-md border border-border px-3 text-sm hover:bg-muted/40',
                        )}
                        aria-label={
                          detailTargetLabel ? `${detailTargetLabel} の確定予定を開く` : undefined
                        }
                      >
                        確定予定を開く
                      </Link>
                    ) : null}
                  </div>
                  {detailPreview ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <p className="font-medium">算定 cadence</p>
                      <p className="mt-1">
                        次回算定可能日: {detailPreview.cadence.next_billable_date ?? '提案不可'} /
                        残回数 {detailPreview.cadence.remaining_month_count}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <ProposalHumanDecisionFlow proposal={detail} />

              <Card>
                <CardHeader className="pb-3">
                  <h3 className="font-heading text-base leading-snug font-medium">
                    候補ランキング
                  </h3>
                  <CardDescription>同一生成バッチの候補を比較します。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rankedCandidates.map((candidate, index) => (
                    <ProposalRankingCard
                      key={candidate.id}
                      candidate={candidate}
                      rank={index + 1}
                      activeProposalId={detail.id}
                    />
                  ))}
                </CardContent>
              </Card>

              <VisitRoutePreviewPanel
                controlId="proposal-detail-route"
                title="ルートプレビュー"
                description="候補を含めた当日ルートの並びを確認します。"
                selectionLabel={detailRouteSelectionLabel}
                travelMode={routeTravelMode}
                onTravelModeChange={(value) => {
                  setRouteTravelMode(value as TravelMode);
                  replaceDashboardUrl({ travel_mode: value });
                }}
                plan={detail.route_preview.plan}
                points={routeMapPoints}
                site={detail.route_preview.site}
                orderedIds={detailRouteDraft.draftIds}
                currentOrderedIds={detailRouteDraft.currentIds}
                movableIds={detailRouteDraft.draftIds.filter((item) =>
                  item.startsWith('proposal:'),
                )}
                onMoveItem={(scheduleId, direction) =>
                  detailRouteDraft.moveItem(scheduleId, direction)
                }
                headerControls={
                  detailRouteDraft.manualDirty ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={detailRouteDraft.resetToOptimized}
                    >
                      最適順へ戻す
                    </Button>
                  ) : null
                }
                actionLabel="候補群へ最適順を反映"
                actionDisabled={
                  reorderProposalMutation.isPending ||
                  detailProposalRouteUpdates.length === 0 ||
                  !detailRouteDraft.differsFromCurrent
                }
                actionPending={reorderProposalMutation.isPending}
                onAction={() => setProposalRouteConfirmOpen(true)}
                extraSummary={
                  detailRouteDraft.diffCount > 0 ? (
                    <Badge variant="outline">差分 {detailRouteDraft.diffCount} 件</Badge>
                  ) : null
                }
              />

              <Card>
                <CardHeader className="pb-3">
                  <h3 className="font-heading text-base leading-snug font-medium">
                    同日スケジュール
                  </h3>
                  <CardDescription>同じ薬剤師の当日予定との並びを確認します。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.pharmacist_day_schedules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">同日の既存予定はありません。</p>
                  ) : (
                    detail.pharmacist_day_schedules.map((schedule) => (
                      <div
                        key={schedule.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {schedule.case_.patient.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {timeLabel(schedule.time_window_start, schedule.time_window_end)} / 順路{' '}
                            {schedule.route_order ?? '未設定'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {schedule.vehicle_resource ? (
                            <Badge variant="outline">
                              <Car className="mr-1 size-3" />
                              {schedule.vehicle_resource.label}
                            </Badge>
                          ) : null}
                          <Badge variant="outline">{schedule.site?.name ?? '拠点未設定'}</Badge>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <h3 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
                    <PhoneCall className="size-4 text-amber-600" />
                    患者連絡ワークフロー
                  </h3>
                  <CardDescription>
                    連絡方法と結果を記録し、確認済みならそのまま確定できます。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="proposal-contact-method">連絡方法</Label>
                      <Select
                        value={contactForm.contact_method}
                        onValueChange={(value) =>
                          setContactFormDraft((current) => ({
                            ...(current ?? contactForm),
                            contact_method: value as typeof contactForm.contact_method,
                          }))
                        }
                      >
                        <SelectTrigger id="proposal-contact-method">
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
                      <Label htmlFor="proposal-contact-outcome">連絡結果</Label>
                      <Select
                        value={contactForm.outcome}
                        onValueChange={(value) =>
                          setContactFormDraft((current) => ({
                            ...(current ?? contactForm),
                            outcome: value as typeof contactForm.outcome,
                          }))
                        }
                      >
                        <SelectTrigger id="proposal-contact-outcome">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="attempted">架電済み</SelectItem>
                          <SelectItem value="confirmed">確認済み</SelectItem>
                          <SelectItem value="unreachable">不在 / 不通</SelectItem>
                          <SelectItem value="declined">辞退</SelectItem>
                          <SelectItem value="change_requested">変更希望</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="proposal-contact-name">対応者名</Label>
                      <Input
                        id="proposal-contact-name"
                        value={contactForm.contact_name}
                        onChange={(event) =>
                          setContactFormDraft((current) => ({
                            ...(current ?? contactForm),
                            contact_name: event.target.value,
                          }))
                        }
                        placeholder="例: 本人 / 長女"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="proposal-contact-phone">連絡先</Label>
                      <Input
                        id="proposal-contact-phone"
                        value={contactForm.contact_phone}
                        onChange={(event) =>
                          setContactFormDraft((current) => ({
                            ...(current ?? contactForm),
                            contact_phone: event.target.value,
                          }))
                        }
                        placeholder="例: 090-0000-0000"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="proposal-contact-callback">折返し予定</Label>
                    <Input
                      id="proposal-contact-callback"
                      type="datetime-local"
                      value={contactForm.callback_due_at}
                      onChange={(event) =>
                        setContactFormDraft((current) => ({
                          ...(current ?? contactForm),
                          callback_due_at: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="proposal-contact-note">連絡メモ</Label>
                    <Textarea
                      id="proposal-contact-note"
                      rows={4}
                      value={contactForm.note}
                      onChange={(event) =>
                        setContactFormDraft((current) => ({
                          ...(current ?? contactForm),
                          note: event.target.value,
                        }))
                      }
                      placeholder="例: 家族同席で了承。次回は午前帯希望。"
                    />
                  </div>

                  {detail.contact_logs.length > 0 ? (
                    <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-4">
                      <p className="text-sm font-medium text-foreground">最近の連絡履歴</p>
                      {detail.contact_logs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-xl border border-border/60 bg-background px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">
                                {
                                  CONTACT_METHOD_LABELS[
                                    (log.contact_method as ContactMethod) ?? 'phone'
                                  ]
                                }
                              </Badge>
                              <Badge variant="outline">{CONTACT_STATUS_LABELS[log.outcome]}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(log.called_at)}
                            </span>
                          </div>
                          {log.contact_name || log.contact_phone ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {log.contact_name ?? '対応者未入力'}
                              {log.contact_phone ? ` / ${log.contact_phone}` : ''}
                            </p>
                          ) : null}
                          {log.note ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {log.note}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card id="schedule-proposal-reproposal">
                <CardHeader className="pb-3">
                  <h3 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
                    <RefreshCw className="size-4 text-indigo-600" />
                    変更希望時の再提案
                  </h3>
                  <CardDescription>
                    変更希望を記録したうえで、新しい時間条件で候補を再生成します。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-5">
                    <div className="space-y-1.5">
                      <Label htmlFor="reproposal-start-date">再提案開始日</Label>
                      <Input
                        id="reproposal-start-date"
                        type="date"
                        value={reproposalForm.start_date}
                        onChange={(event) =>
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            start_date: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reproposal-priority">優先度</Label>
                      <Select
                        value={reproposalForm.priority}
                        onValueChange={(value) =>
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            priority: value as Proposal['priority'],
                          }))
                        }
                      >
                        <SelectTrigger id="reproposal-priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PRIORITY_LABELS) as Proposal['priority'][]).map(
                            (priority) => (
                              <SelectItem key={priority} value={priority}>
                                {PRIORITY_LABELS[priority]}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reproposal-time-from">希望時間 From</Label>
                      <Input
                        id="reproposal-time-from"
                        type="time"
                        value={reproposalForm.preferred_time_from}
                        onChange={(event) =>
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            preferred_time_from: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reproposal-time-to">希望時間 To</Label>
                      <Input
                        id="reproposal-time-to"
                        type="time"
                        value={reproposalForm.preferred_time_to}
                        onChange={(event) =>
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            preferred_time_to: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reproposal-candidate-count">候補数</Label>
                      <Input
                        id="reproposal-candidate-count"
                        type="number"
                        min={1}
                        max={5}
                        value={reproposalForm.candidate_count}
                        onChange={(event) =>
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            candidate_count: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="reproposal-vehicle-resource">社用車</Label>
                      <Select
                        value={reproposalForm.vehicle_resource_id || AUTO_VEHICLE_RESOURCE_VALUE}
                        onValueChange={(value) => {
                          const selectedVehicleResourceId =
                            value && value !== AUTO_VEHICLE_RESOURCE_VALUE ? value : '';
                          setReproposalFormDraft((current) => ({
                            ...(current ?? reproposalForm),
                            vehicle_resource_id: selectedVehicleResourceId,
                          }));
                        }}
                      >
                        <SelectTrigger id="reproposal-vehicle-resource">
                          <SelectValue placeholder="自動割当" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO_VEHICLE_RESOURCE_VALUE}>自動割当</SelectItem>
                          {vehicleResourceOptions.map((vehicle) => (
                            <SelectItem key={vehicle.id} value={vehicle.id}>
                              {vehicle.site?.name
                                ? `${vehicle.label} / ${vehicle.site.name}`
                                : vehicle.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {selectedReproposalVehicle
                          ? formatVehicleResourceLabel(selectedReproposalVehicle)
                          : vehicleResourcesQuery.isLoading
                            ? '社用車候補を読み込み中'
                            : '未指定の場合は患者希望時間とルート条件から自動割当します'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reproposal-note">希望条件メモ</Label>
                    <Textarea
                      id="reproposal-note"
                      rows={3}
                      value={reproposalForm.note}
                      onChange={(event) =>
                        setReproposalFormDraft((current) => ({
                          ...(current ?? reproposalForm),
                          note: event.target.value,
                        }))
                      }
                      placeholder="例: 月水金の午前のみ可 / 施設食後に合わせたい"
                    />
                  </div>
                  <Button
                    onClick={() => reProposalMutation.mutate()}
                    disabled={reProposalMutation.isPending}
                  >
                    {reProposalMutation.isPending ? '再提案を生成中...' : '変更希望で再提案'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
