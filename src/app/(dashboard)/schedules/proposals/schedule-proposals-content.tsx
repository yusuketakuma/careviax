'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  MapPinned,
  PhoneCall,
  RefreshCw,
  Route,
  UserRound,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { VisitRouteMap } from '@/components/features/visits/visit-route-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  addressOfPatient,
  CONTACT_STATUS_LABELS,
  PRIORITY_LABELS,
  PROPOSAL_STATUS_LABELS,
  readImpactCount,
  readImpactedPatientNames,
  splitProposalReason,
  statusBadgeClass,
  timeLabel,
  type Proposal,
} from '../day-view.shared';

type DashboardTab = 'unapproved' | 'patient_contact_pending' | 'confirmed' | 'rejected';

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
      encodedPath: string | null;
      orderedScheduleIds: string[];
      totalDistanceMeters: number | null;
      totalDurationSeconds: number | null;
      stopSummaries: Array<{
        scheduleId: string;
        optimizedOrder: number;
        arrivalOffsetSeconds: number | null;
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
};

type ScheduleProposalsResponse = { data: Proposal[] };
type ScheduleProposalDetailResponse = { data: ProposalDetail };
type ContactOutcome =
  | 'attempted'
  | 'declined'
  | 'change_requested'
  | 'unreachable'
  | 'confirmed';
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
  initialDate?: string | null;
  initialFocus?: string | null;
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

function formatDurationLabel(value: number | null | undefined) {
  if (value == null) return '未計算';
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

function formatEtaLabel(baseDate: string, timeWindowStart: string | null, offsetSeconds: number | null) {
  if (offsetSeconds == null) {
    return timeLabel(timeWindowStart, null);
  }

  const parsed = parseISO(`${baseDate}T09:00:00`);
  const eta = new Date(parsed.getTime() + offsetSeconds * 1000);
  return format(eta, 'HH:mm', { locale: ja });
}

function toDashboardTab(status?: string | null): DashboardTab {
  if (status === 'patient_contact_pending') return 'patient_contact_pending';
  if (status === 'confirmed') return 'confirmed';
  if (status === 'rejected') return 'rejected';
  return 'unapproved';
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
  initialDate,
  initialFocus,
}: ContentProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DashboardTab>(toDashboardTab(initialStatus));
  const [caseId, setCaseId] = useState(initialCaseId ?? '');
  const [patientId, setPatientId] = useState(initialPatientId ?? '');
  const [dateFrom, setDateFrom] = useState(initialDate ?? '');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(
    initialFocus === 'patient' || Boolean(initialCaseId) || Boolean(initialPatientId)
      ? AUTO_DETAIL_ID
      : null
  );
  const [contactFormDraft, setContactFormDraft] = useState<ContactFormState | null>(null);
  const [reproposalFormDraft, setReproposalFormDraft] = useState<{
    start_date: string;
    preferred_time_from: string;
    preferred_time_to: string;
    note: string;
    candidate_count: string;
  } | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (caseId.trim()) params.set('case_id', caseId.trim());
    if (patientId.trim()) params.set('patient_id', patientId.trim());
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return params.toString();
  }, [caseId, dateFrom, dateTo, patientId]);

  const proposalsQuery = useQuery({
    queryKey: ['schedule-proposals-dashboard', orgId, queryParams],
    queryFn: async () => {
      const response = await fetch(`/api/visit-schedule-proposals?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('訪問候補の取得に失敗しました');
      return response.json() as Promise<ScheduleProposalsResponse>;
    },
    enabled: !!orgId,
  });

  const proposals = useMemo(() => proposalsQuery.data?.data ?? [], [proposalsQuery.data]);

  const tabCounts = useMemo(
    () => ({
      unapproved: proposals.filter((proposal) => matchesTab(proposal, 'unapproved')).length,
      patient_contact_pending: proposals.filter((proposal) =>
        matchesTab(proposal, 'patient_contact_pending')
      ).length,
      confirmed: proposals.filter((proposal) => matchesTab(proposal, 'confirmed')).length,
      rejected: proposals.filter((proposal) => matchesTab(proposal, 'rejected')).length,
      stale: proposals.filter((proposal) =>
        ['superseded', 'expired'].includes(proposal.proposal_status)
      ).length,
    }),
    [proposals]
  );

  const visibleProposals = useMemo(
    () => proposals.filter((proposal) => matchesTab(proposal, activeTab)),
    [activeTab, proposals]
  );

  const selectedProposals = useMemo(
    () => visibleProposals.filter((proposal) => selectedIds.includes(proposal.id)),
    [selectedIds, visibleProposals]
  );

  const autoDetailId =
    initialFocus === 'patient' || initialCaseId || initialPatientId
      ? (proposals.find((proposal) => matchesTab(proposal, activeTab)) ?? proposals[0])?.id ?? null
      : null;

  const activeDetailId =
    detailId === AUTO_DETAIL_ID
      ? autoDetailId
      : detailId && proposals.some((proposal) => proposal.id === detailId)
        ? detailId
        : null;

  const detailQuery = useQuery({
    queryKey: ['schedule-proposal-detail', orgId, activeDetailId],
    queryFn: async () => {
      const response = await fetch(`/api/visit-schedule-proposals/${activeDetailId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('訪問候補詳細の取得に失敗しました');
      return response.json() as Promise<ScheduleProposalDetailResponse>;
    },
    enabled: !!orgId && !!activeDetailId,
  });

  const detail = detailQuery.data?.data ?? null;

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
      start_date: detail?.proposed_date.slice(0, 10) ?? initialDate ?? '',
      preferred_time_from: '09:00',
      preferred_time_to: '12:00',
      note: '',
      candidate_count: '3',
    };
  }, [detail, initialDate, reproposalFormDraft]);

  const openDetail = (proposalId: string) => {
    setDetailId(proposalId);
    setContactFormDraft(null);
    setReproposalFormDraft(null);
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
          proposal.proposal_status
        );
      });
      if (eligible.length === 0) {
        throw new Error(action === 'approve' ? '承認できる候補が選択されていません' : '却下できる候補が選択されていません');
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
          })
        )
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
          priority: detail.priority,
          start_date: reproposalForm.start_date || detail.proposed_date.slice(0, 10),
          preferred_time_from: reproposalForm.preferred_time_from || undefined,
          preferred_time_to: reproposalForm.preferred_time_to || undefined,
          candidate_count: Number(reproposalForm.candidate_count || '3'),
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? '再提案の生成に失敗しました');
      }
      return response.json() as Promise<{ data: Proposal[] }>;
    },
    onSuccess: async (payload) => {
      toast.success(`${payload.data.length}件の再提案候補を生成しました`);
      setActiveTab('unapproved');
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

  const routeMapPoints = useMemo(() => {
    if (!detail) return [];
    const planById = new Map(
      detail.route_preview.plan.stopSummaries.map((summary) => [summary.scheduleId, summary])
    );
    return detail.route_preview.points.map((point) => ({
      scheduleId: point.schedule_id,
      patientName: point.patient_name,
      address: point.address,
      lat: point.lat,
      lng: point.lng,
      orderLabel: String(planById.get(point.schedule_id)?.optimizedOrder ?? '•'),
      status: point.schedule_status,
      priority: point.priority,
      etaLabel: formatEtaLabel(
        detail.proposed_date.slice(0, 10),
        point.time_window_start,
        planById.get(point.schedule_id)?.arrivalOffsetSeconds ?? null
      ),
    }));
  }, [detail]);

  const allVisibleSelected =
    visibleProposals.length > 0 && visibleProposals.every((proposal) => selectedIds.includes(proposal.id));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">提案フィルタ</CardTitle>
            <CardDescription>ケース単位・患者単位・日付帯で候補を絞り込みます。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="proposal-case-id">ケース ID</Label>
              <Input
                id="proposal-case-id"
                value={caseId}
                onChange={(event) => setCaseId(event.target.value)}
                placeholder="case_xxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proposal-patient-id">患者 ID</Label>
              <Input
                id="proposal-patient-id"
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
                placeholder="patient_xxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proposal-date-from">候補日 From</Label>
              <Input
                id="proposal-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proposal-date-to">候補日 To</Label>
              <Input
                id="proposal-date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">次の操作</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="/schedules"
              className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
            >
              本日の訪問予定へ
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
            <Link
              href="/workflow"
              className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2 text-sm hover:bg-muted/40"
            >
              例外・未接続案件を確認
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
            <div className="rounded-xl border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
              差替済み / 期限切れ: {tabCounts.stale} 件
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DashboardTab)}
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-3">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(checked) =>
              setSelectedIds(checked ? visibleProposals.map((proposal) => proposal.id) : [])
            }
            aria-label="表示中の候補をすべて選択"
          />
          <div>
            <p className="text-sm font-medium text-foreground">一括操作</p>
            <p className="text-xs text-muted-foreground">選択中 {selectedIds.length} 件</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      <div className="grid gap-4">
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
            const canApprove = ['proposed', 'reschedule_pending'].includes(proposal.proposal_status);
            const canConfirm =
              proposal.proposal_status === 'patient_contact_pending' &&
              proposal.patient_contact_status === 'confirmed';
            const impactedCount = readImpactCount(
              proposal.reschedule_source_schedule?.override_request?.impact_summary
            );
            const impactedNames = readImpactedPatientNames(
              proposal.reschedule_source_schedule?.override_request?.impact_summary
            );

            return (
              <Card
                key={proposal.id}
                className="border-border/70 bg-card/95"
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
                              : current.filter((id) => id !== proposal.id)
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
                            {formatDateLabel(proposal.proposed_date)} {timeLabel(proposal.time_window_start, proposal.time_window_end)}
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
                      <div className="flex flex-wrap gap-2">
                        {splitProposalReason(proposal.proposal_reason ?? '').map((reason) => (
                          <span
                            key={reason}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {addressOfPatient(proposal)}
                      </p>
                      {proposal.escalation_reason ? (
                        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          {proposal.escalation_reason}
                        </p>
                      ) : null}
                      {impactedCount ? (
                        <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                          リスケ影響 {impactedCount} 件
                          {impactedNames.length > 0 ? ` / ${impactedNames.join('、')}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2 rounded-2xl bg-muted/30 p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">担当拠点</span>
                        <span className="font-medium text-foreground">
                          {proposal.site?.name ?? '未設定'}
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
                        <span className="font-medium text-foreground">{proposal.route_order ?? '未設定'}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Sheet open={activeDetailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
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
                    {formatDateLabel(detail.proposed_date)} {timeLabel(detail.time_window_start, detail.time_window_end)} / {detail.proposed_pharmacist?.name ?? '担当未解決'}
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">候補ランキング</CardTitle>
                  <CardDescription>同一生成バッチの候補を比較します。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rankedCandidates.map((candidate, index) => (
                    <div
                      key={candidate.id}
                      className={`rounded-2xl border px-4 py-3 ${candidate.id === detail.id ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-background'}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {index + 1}位 {formatDateLabel(candidate.proposed_date)} {timeLabel(candidate.time_window_start, candidate.time_window_end)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            担当 {candidate.proposed_pharmacist?.name ?? '未解決'} / {candidate.site?.name ?? '拠点未設定'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">移動 {formatDistanceLabel(candidate.route_distance_score)}</Badge>
                          <Badge variant="outline">
                            配置 {candidate.assignment_mode === 'primary' ? '主担当優先' : '代替担当'}
                          </Badge>
                          <Badge variant="outline">
                            期限 {formatDateLabel(candidate.visit_deadline_date)}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {splitProposalReason(candidate.proposal_reason ?? '').map((reason) => (
                          <span
                            key={`${candidate.id}-${reason}`}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MapPinned className="size-4 text-sky-600" />
                    ルートプレビュー
                  </CardTitle>
                  <CardDescription>
                    候補を含めた当日ルートの並びを確認します。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">
                      距離 {detail.route_preview.plan.totalDistanceMeters != null ? `${(detail.route_preview.plan.totalDistanceMeters / 1000).toFixed(1)}km` : '未取得'}
                    </Badge>
                    <Badge variant="outline">
                      移動 {formatDurationLabel(detail.route_preview.plan.totalDurationSeconds)}
                    </Badge>
                  </div>
                  <VisitRouteMap
                    className="w-full"
                    points={routeMapPoints}
                    encodedPath={detail.route_preview.plan.encodedPath}
                    note={detail.route_preview.plan.note}
                    site={detail.route_preview.site}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">同日スケジュール</CardTitle>
                  <CardDescription>
                    同じ薬剤師の当日予定との並びを確認します。
                  </CardDescription>
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
                            {timeLabel(schedule.time_window_start, schedule.time_window_end)} / 順路 {schedule.route_order ?? '未設定'}
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
                        <div key={log.id} className="rounded-xl border border-border/60 bg-background px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{CONTACT_METHOD_LABELS[(log.contact_method as ContactMethod) ?? 'phone']}</Badge>
                              <Badge variant="outline">{CONTACT_STATUS_LABELS[log.outcome]}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(log.called_at)}
                            </span>
                          </div>
                          {(log.contact_name || log.contact_phone) ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {log.contact_name ?? '対応者未入力'}
                              {log.contact_phone ? ` / ${log.contact_phone}` : ''}
                            </p>
                          ) : null}
                          {log.note ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{log.note}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
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
                  <div className="grid gap-4 md:grid-cols-3">
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
