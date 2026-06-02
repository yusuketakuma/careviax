'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
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
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { applyVisitScheduleProposalRouteUpdates } from '@/app/(dashboard)/schedules/visit-route-client';
import { useRouteOrderDraft } from '@/app/(dashboard)/schedules/route-order-draft';
import { ProposalHumanDecisionFlow } from '../proposal-human-decision-flow';
import { mergeScheduleProposalSearchParams } from './proposal-query-state';
import { buildDashboardDiagnosticActions } from './schedule-proposal-diagnostic-actions';
import {
  addressOfPatient,
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
type ContactOutcome = 'attempted' | 'declined' | 'change_requested' | 'unreachable' | 'confirmed';
type ContactMethod = 'phone' | 'fax' | 'email';
type ContactFormState = {
  outcome: ContactOutcome;
  contact_method: ContactMethod;
  contact_name: string;
  contact_phone: string;
  note: string;
  callback_due_at: string;
};

type ProposalActionPayload =
  | { action: 'approve' }
  | { action: 'confirm' }
  | { action: 'reject' }
  | {
      action: 'contact_attempt';
      outcome: ContactOutcome;
      contact_method: ContactMethod;
      contact_name?: string;
      contact_phone?: string;
      note?: string;
      callback_due_at?: string;
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

const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
};

const AUTO_DETAIL_ID = '__auto__';

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
        <span className="font-medium text-foreground">{proposal.route_order ?? '未設定'}</span>
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

export function ScheduleProposalsContent({
  initialStatus,
  initialCaseId,
  initialPatientId,
  initialDateFrom,
  initialDateTo,
  initialFocus,
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
  const [detailId, setDetailId] = useState<string | null>(
    initialDetailId ??
      (initialFocus === 'patient' || Boolean(initialCaseId) || Boolean(initialPatientId)
        ? AUTO_DETAIL_ID
        : null),
  );
  const [contactFormDraft, setContactFormDraft] = useState<ContactFormState | null>(null);
  const [reproposalFormDraft, setReproposalFormDraft] = useState<{
    start_date: string;
    priority: Proposal['priority'];
    preferred_time_from: string;
    preferred_time_to: string;
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

  const autoDetailId =
    initialFocus === 'patient' || initialCaseId || initialPatientId
      ? ((proposals.find((proposal) => matchesTab(proposal, activeTab)) ?? proposals[0])?.id ??
        null)
      : null;

  const activeDetailId =
    detailId === AUTO_DETAIL_ID
      ? autoDetailId
      : detailId && proposals.some((proposal) => proposal.id === detailId)
        ? detailId
        : null;

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
      note: '',
      candidate_count: '3',
    };
  }, [detail, initialDateFrom, reproposalFormDraft]);

  const applyCaseFilter = (careCase: CaseOption) => {
    setSelectedCaseSummary(careCase);
    setCaseId(careCase.id);
    setPatientId(careCase.patient.id);
    setCaseSearchInput('');
    setDetailId(AUTO_DETAIL_ID);
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
    replaceDashboardUrl({
      case_id: null,
      patient_id: null,
      focus: null,
    });
  };

  const activatePreset = (preset: FilterPreset) => {
    const today = todayKey();
    setFilterPreset(preset);
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
      const response = await fetch(`/api/visit-schedule-proposals/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? '候補更新に失敗しました');
      }
      return response.json();
    },
    onSuccess: async (_data, variables) => {
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
    mutationFn: async (action: 'approve' | 'reject') => {
      const eligible = selectedProposals.filter((proposal) => {
        if (action === 'approve') {
          return ['proposed', 'reschedule_pending'].includes(proposal.proposal_status);
        }
        return ['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(
          proposal.proposal_status,
        );
      });
      if (eligible.length === 0) {
        throw new Error(
          action === 'approve'
            ? '承認できる候補が選択されていません'
            : '却下できる候補が選択されていません',
        );
      }

      await Promise.all(
        eligible.map((proposal) =>
          fetch(`/api/visit-schedule-proposals/${proposal.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'x-org-id': orgId,
            },
            body: JSON.stringify({ action }),
          }).then(async (response) => {
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw new Error(error.message ?? '一括更新に失敗しました');
            }
            return response.json();
          }),
        ),
      );
    },
    onSuccess: async (_data, action) => {
      toast.success(action === 'approve' ? '選択候補を承認しました' : '選択候補を却下しました');
      setSelectedIds([]);
      await invalidateProposalQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '一括更新に失敗しました');
    },
  });

  const reorderProposalMutation = useMutation({
    mutationFn: async (
      routeOrderUpdates: Array<{
        proposal_id: string;
        route_order: number;
      }>,
    ) =>
      applyVisitScheduleProposalRouteUpdates({
        orgId,
        routeOrderUpdates,
      }),
    onSuccess: async () => {
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

  const allVisibleSelected =
    visibleProposals.length > 0 &&
    visibleProposals.every((proposal) => selectedIds.includes(proposal.id));
  const caseSearchResults = casesQuery.data?.data ?? [];
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
                    {effectiveSelectedCaseSummary.primary_pharmacist_name
                      ? ` / 主担当 ${effectiveSelectedCaseSummary.primary_pharmacist_name}`
                      : ''}
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
                        onClick={() => applyCaseFilter(careCase)}
                      >
                        {careCase.patient.name}
                        {careCase.primary_pharmacist_name
                          ? ` / ${careCase.primary_pharmacist_name}`
                          : ''}
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
              onClick={() => bulkActionMutation.mutate('reject')}
              disabled={selectedIds.length === 0 || bulkActionMutation.isPending}
            >
              <XCircle className="mr-1.5 size-4" />
              一括却下
            </Button>
            <Button
              size="sm"
              onClick={() => bulkActionMutation.mutate('approve')}
              disabled={selectedIds.length === 0 || bulkActionMutation.isPending}
            >
              <CheckCircle2 className="mr-1.5 size-4" />
              一括承認
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
          <label className="flex min-h-[44px] items-center gap-3 text-sm sm:min-h-0">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(checked) =>
                setSelectedIds(checked ? visibleProposals.map((proposal) => proposal.id) : [])
              }
              aria-label="表示中の候補をすべて選択"
            />
            表示中の候補をすべて選択
          </label>
          <div className="min-w-0 flex-1">
            <FilterSummaryBar
              items={[
                { label: '表示候補', value: `${visibleProposals.length}件` },
                { label: '選択中', value: `${selectedIds.length}件` },
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
                        checked={selectedIds.includes(proposal.id)}
                        onCheckedChange={(checked) =>
                          setSelectedIds((current) =>
                            checked
                              ? Array.from(new Set([...current, proposal.id]))
                              : current.filter((id) => id !== proposal.id),
                          )
                        }
                        aria-label={`${proposal.case_.patient.name} の候補を選択`}
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
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openDetail(proposal.id)}>
                        詳細
                      </Button>
                      {canApprove ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            proposalActionMutation.mutate({
                              id: proposal.id,
                              payload: { action: 'approve' },
                            })
                          }
                          disabled={proposalActionMutation.isPending}
                        >
                          承認して連絡へ
                        </Button>
                      ) : null}
                      {canConfirm ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            proposalActionMutation.mutate({
                              id: proposal.id,
                              payload: { action: 'confirm' },
                            })
                          }
                          disabled={proposalActionMutation.isPending}
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
                      <p className="text-sm text-muted-foreground">{addressOfPatient(proposal)}</p>
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
            <SheetTitle>訪問候補の詳細</SheetTitle>
            <SheetDescription>
              候補比較、当日ルート、患者連絡、再提案までここで完結させます。
            </SheetDescription>
          </SheetHeader>

          {!detail || detailQuery.isLoading ? (
            <div className="py-10 text-sm text-muted-foreground">詳細を読み込み中...</div>
          ) : (
            <div className="mt-6 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{detail.case_.patient.name}</CardTitle>
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
                  <div className="flex flex-wrap gap-2">
                    {detail.proposal_status !== 'patient_contact_pending' &&
                    ['proposed', 'reschedule_pending'].includes(detail.proposal_status) ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          proposalActionMutation.mutate({
                            id: detail.id,
                            payload: { action: 'approve' },
                          })
                        }
                        disabled={proposalActionMutation.isPending}
                      >
                        承認して連絡へ
                      </Button>
                    ) : null}
                    {detail.proposal_status === 'patient_contact_pending' ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
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
                        >
                          連絡結果を保存
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            proposalActionMutation.mutate({
                              id: detail.id,
                              payload: { action: 'confirm' },
                            })
                          }
                          disabled={
                            proposalActionMutation.isPending ||
                            detail.patient_contact_status !== 'confirmed'
                          }
                        >
                          日時確定
                        </Button>
                      </>
                    ) : null}
                    {detail.finalized_schedule ? (
                      <Link
                        href={`/visits/${detail.finalized_schedule.id}/record`}
                        className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted/40"
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
                  <CardTitle className="text-base">候補ランキング</CardTitle>
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
                  detailRouteDraft.draftIds.filter((item) => item.startsWith('proposal:'))
                    .length === 0 ||
                  !detailRouteDraft.differsFromCurrent
                }
                actionPending={reorderProposalMutation.isPending}
                onAction={() =>
                  reorderProposalMutation.mutate(
                    detailRouteDraft.draftIds
                      .map((item, index) =>
                        item.startsWith('proposal:')
                          ? {
                              proposal_id: item.replace('proposal:', ''),
                              route_order: index + 1,
                            }
                          : null,
                      )
                      .filter(
                        (
                          item,
                        ): item is {
                          proposal_id: string;
                          route_order: number;
                        } => item != null,
                      ),
                  )
                }
                extraSummary={
                  detailRouteDraft.diffCount > 0 ? (
                    <Badge variant="outline">差分 {detailRouteDraft.diffCount} 件</Badge>
                  ) : null
                }
              />

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">同日スケジュール</CardTitle>
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
                        <Badge variant="outline">{schedule.site?.name ?? '拠点未設定'}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PhoneCall className="size-4 text-amber-600" />
                    患者連絡ワークフロー
                  </CardTitle>
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
                  <CardTitle className="flex items-center gap-2 text-base">
                    <RefreshCw className="size-4 text-indigo-600" />
                    変更希望時の再提案
                  </CardTitle>
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
