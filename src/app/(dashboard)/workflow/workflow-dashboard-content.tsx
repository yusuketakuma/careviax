'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { StagnationIndicator } from '@/components/features/workflow/stagnation-indicator';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  BellRing,
  Building2,
  Clock,
  ClipboardList,
  RefreshCw,
  Route,
  TrendingUp,
  UserRound,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { HomeCareFeatureBoard } from '@/components/home-care/home-care-feature-board';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { HomeCareFeatureSummary } from '@/types/home-care';

type WorkflowData = {
  cycle_status_counts: Record<string, number>;
  workflow_exceptions: {
    open: number;
    items: Array<{
      id: string;
      exception_type: string;
      description: string;
      severity: string;
      patient_name: string | null;
      created_at: string;
    }>;
  };
  communication_requests: { pending: number; overdue: number };
  delivery: { failures: number };
  visit_operations: {
    overdue: number;
    awaiting_reports: number;
    missing_visit_consent: number;
    missing_management_plan: number;
  };
  operations_queue: {
    visit_demands: number;
    callback_followups: number;
    management_plan_reviews: number;
    preparation_pending: number;
    geocode_reviews: number;
    intake_linkages: number;
    self_reports_triage: number;
  };
  role_inboxes: {
    current_role: string;
    buckets: Array<{
      role: 'pharmacist' | 'clerk' | 'admin';
      label: string;
      open_items: number;
      urgent_items: number;
      communication_items: number;
      action_href: string;
    }>;
  };
  communication_queue: {
    summary: {
      pending_count: number;
      overdue_count: number;
      self_reports: number;
      callback_followups: number;
      open_requests: number;
      delivery_backlog: number;
      expiring_external_shares: number;
      unconfirmed_count: number;
      reply_waiting_count: number;
      failed_count: number;
    };
    items: Array<{
      id: string;
      queue_type: string;
      title: string;
      summary: string;
      channel: string;
      status: string;
      priority: 'urgent' | 'high' | 'normal';
      patient_name: string | null;
      due_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    timeline: Array<{
      id: string;
      source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
      patient_name: string | null;
      title: string;
      summary: string;
      status: string;
      occurred_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    emergency_drafts: Array<{
      id: string;
      patient_id: string;
      template_key: string;
      request_type: string;
      target_name: string | null;
      target_role: string;
      title: string;
      summary: string;
      subject: string;
      content: string;
      action_href: string;
      action_label: string;
    }>;
  };
  patient_risk_queue: {
    high_risk_count: number;
    items: Array<{
      patient_id: string;
      patient_name: string;
      score: number;
      level: 'stable' | 'watch' | 'high';
      reasons: string[];
      unresolved_self_reports: number;
      open_issues: number;
      disrupted_visits_30d: number;
      pending_reports: number;
      open_tasks: number;
      missing_visit_consent: boolean;
      missing_management_plan: boolean;
    }>;
  };
  inquiry_workbench: Array<{
    id: string;
    item_type: 'issue' | 'inquiry';
    inquiry_id: string | null;
    issue_id: string | null;
    line_id: string | null;
    cycle_id: string | null;
    case_id: string | null;
    patient_id: string;
    patient_name: string;
    title: string;
    summary: string;
    reason: string;
    inquiry_to_physician: string;
    change_detail: string | null;
    line: {
      id: string;
      drug_name: string;
      dose: string;
      frequency: string;
      days: number;
    } | null;
    request_status: string | null;
    queue_state: string;
    due_at: string | null;
    created_at: string;
    can_create: boolean;
  }>;
  remediation_guidance: Array<{
    id: string;
    title: string;
    description: string;
    severity: 'urgent' | 'high' | 'normal';
    count: number;
    action_href: string;
    action_label: string;
  }>;
  unified_workbench: Array<{
    id: string;
    item_type: 'task' | 'proposal' | 'visit' | 'self_report' | 'aggregate';
    queue_label: string;
    title: string;
    summary: string;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    due_at: string | null;
    action_href: string;
    action_label: string;
    owner_name: string | null;
    patient_name: string | null;
    badges: string[];
  }>;
  facility_visibility: {
    clusters: Array<{
      id: string;
      date: string;
      label: string;
      site_name: string | null;
      pharmacist_name: string | null;
      patient_count: number;
      patient_names: string[];
      route_window: string;
    }>;
  };
  exception_command_center: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    patient_name: string | null;
    created_at: string | null;
    action_href: string;
    action_label: string;
  }>;
  workload_metrics: {
    pharmacists: Array<{
      pharmacist_id: string;
      pharmacist_name: string;
      confirmed_visits: number;
      pending_tasks: number;
      urgent_items: number;
      callback_followups: number;
      facility_clusters: number;
    }>;
  };
  route_operations: {
    locked_confirmed_visits: number;
    fallback_assignments: number;
    override_pending: number;
    emergency_candidates: number;
  };
  outcome_metrics: {
    completed_last_7_days: number;
    disrupted_last_7_days: number;
    urgent_completed_last_7_days: number;
    awaiting_reports: number;
    open_exceptions: number;
  };
  route_control: {
    locked_schedules: number;
    pending_override_requests: number;
    emergency_impact_items: number;
  };
  after_hours_readiness: {
    emergency_capable_shift_count: number;
    holiday_gap_count: number;
    holiday_gaps: Array<{
      id: string;
      date: string;
      name: string;
      site_id: string | null;
    }>;
  };
  inventory_readiness: {
    blocked: number;
    partial: number;
  };
  regional_pipeline: {
    follow_up_activities: number;
    conference_action_items: number;
    intake_cases: number;
    top_followups: Array<{
      id: string;
      title: string;
      partner_name: string | null;
      activity_type: string;
      activity_date: string;
      referrals_generated: number | null;
    }>;
  };
  billing_prevention: {
    previsit_blockers: number;
    review_tasks: number;
    report_delivery_backlog: number;
  };
  home_care_feature_summary: HomeCareFeatureSummary;
  intake_linkage: Array<{
    id: string;
    patient_name: string;
    reason: string;
    due_at: string | null;
    action_href: string;
    action_label: string;
    category: string;
  }>;
  self_reports: Array<{
    id: string;
    patient_name: string;
    reported_by_name: string;
    relation: string | null;
    subject: string;
    category: string;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    status: string;
    created_at: string;
  }>;
  refill_upcoming: Array<{
    id: string;
    cycle_id: string;
    case_id: string | null;
    upcoming_kind: 'refill' | 'split';
    remaining_count: number;
    refill_remaining_count: number;
    split_dispense_total: number | null;
    split_dispense_current: number | null;
    prescribed_date: string;
    refill_next_dispense_date: string | null;
    split_next_dispense_date: string | null;
    next_dispense_date: string | null;
    suggested_start_date: string | null;
    has_existing_route: boolean;
    cycle: {
      patient_id: string;
      case_: { patient: { id: string; name: string } };
    };
  }>;
};

type InquiryWorkbenchItem = WorkflowData['inquiry_workbench'][number];

type InquiryEditState = {
  changeDetail: string;
  drugName: string;
  dose: string;
  frequency: string;
  days: string;
  proposalOrigin: 'post_inquiry' | 'pre_issuance';
  residualAdjustment: boolean;
};

function buildInquiryEditState(item: InquiryWorkbenchItem): InquiryEditState {
  const detail = item.change_detail ?? '';
  return {
    changeDetail: detail,
    drugName: item.line?.drug_name ?? '',
    dose: item.line?.dose ?? '',
    frequency: item.line?.frequency ?? '',
    days: item.line ? String(item.line.days) : '',
    proposalOrigin: detail.includes('proposal_origin:pre_issuance')
      ? 'pre_issuance'
      : 'post_inquiry',
    residualAdjustment:
      item.reason.includes('残薬') || detail.toLowerCase().includes('residual_adjustment:true'),
  };
}

function buildInquiryResolutionDetail(args: {
  result: 'changed' | 'unchanged' | 'pending';
  changeDetail?: string;
  proposalOrigin?: InquiryEditState['proposalOrigin'];
  residualAdjustment?: boolean;
}) {
  const baseDetail =
    args.changeDetail?.trim() ||
    (args.result === 'changed'
      ? 'workflow から処方反映ありで確定'
      : args.result === 'unchanged'
        ? 'workflow から変更なしで確定'
        : 'workflow から回答待ちへ更新');

  return [
    baseDetail,
    `proposal_origin:${args.proposalOrigin ?? 'post_inquiry'}`,
    `residual_adjustment:${args.residualAdjustment ? 'true' : 'false'}`,
  ].join(' | ');
}

const CYCLE_STATUS_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  intake_received: { label: '応需受付', color: 'bg-blue-100 text-blue-800' },
  structuring: { label: '構造化中', color: 'bg-blue-100 text-blue-800' },
  inquiry_pending: {
    label: '疑義照会中',
    color: 'bg-orange-100 text-orange-800',
  },
  inquiry_resolved: {
    label: '照会解決済',
    color: 'bg-green-100 text-green-800',
  },
  ready_to_dispense: {
    label: '調剤待ち',
    color: 'bg-blue-100 text-blue-800',
  },
  dispensing: { label: '調剤中', color: 'bg-green-100 text-green-800' },
  dispensed: { label: '調剤完了', color: 'bg-green-100 text-green-800' },
  audit_pending: {
    label: '鑑査待ち',
    color: 'bg-orange-100 text-orange-800',
  },
  audited: { label: '鑑査済み', color: 'bg-green-100 text-green-800' },
  setting: { label: 'セット中', color: 'bg-blue-100 text-blue-800' },
  set_audited: {
    label: 'セット鑑査済',
    color: 'bg-green-100 text-green-800',
  },
  visit_ready: { label: '訪問準備完了', color: 'bg-green-100 text-green-800' },
  visit_completed: {
    label: '訪問完了',
    color: 'bg-green-100 text-green-800',
  },
  on_hold: { label: '保留', color: 'bg-gray-100 text-gray-600' },
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'border-rose-200 bg-rose-50 text-rose-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  normal: 'border-sky-200 bg-sky-50 text-sky-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

const SEVERITY_CLASS: Record<string, string> = {
  urgent: 'border-rose-200 bg-rose-50 text-rose-700',
  critical: 'border-rose-200 bg-rose-50 text-rose-700',
  high: 'border-amber-200 bg-amber-50 text-amber-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
};

const DEFAULT_PRIORITY_CLASS = 'border-sky-200 bg-sky-50 text-sky-700';

function priorityClass(priority: string) {
  return PRIORITY_CLASS[priority] ?? DEFAULT_PRIORITY_CLASS;
}

function severityClass(severity: string) {
  return SEVERITY_CLASS[severity] ?? DEFAULT_PRIORITY_CLASS;
}

export function WorkflowDashboardContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [inquiryEdits, setInquiryEdits] = useState<Record<string, InquiryEditState>>({});

  const { data, isLoading, refetch } = useRealtimeQuery({
    queryKey: ['dashboard-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ダッシュボードの取得に失敗しました');
      return res.json() as Promise<{ data: WorkflowData }>;
    },
    enabled: !!orgId,
    refetchInterval: 60_000,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const workflow = data?.data;

  const createEmergencyDraftMutation = useMutation({
    mutationFn: async (draft: WorkflowData['communication_queue']['emergency_drafts'][number]) => {
      const res = await fetch('/api/communication-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          patient_id: draft.patient_id,
          request_type: draft.request_type,
          template_key: draft.template_key,
          recipient_name: draft.target_name ?? draft.target_role,
          recipient_role: draft.target_role,
          related_entity_type: 'patient',
          related_entity_id: draft.patient_id,
          context_snapshot: {
            source: 'communication_queue',
            template_key: draft.template_key,
          },
          status: 'draft',
          subject: draft.subject,
          content: draft.content,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '緊急連絡ドラフトの起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('緊急連絡ドラフトを起票しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '緊急連絡ドラフトの起票に失敗しました');
    },
  });

  const createInquiryMutation = useMutation({
    mutationFn: async (item: WorkflowData['inquiry_workbench'][number]) => {
      if (!item.cycle_id || !item.issue_id) {
        throw new Error('有効なサイクルがないため疑義照会を起票できません');
      }
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      const res = await fetch('/api/inquiry-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          cycle_id: item.cycle_id,
          issue_id: item.issue_id,
          reason: item.reason,
          inquiry_to_physician: item.inquiry_to_physician,
          inquiry_content: item.summary,
          inquired_at: new Date().toISOString(),
          request_due_date: format(dueDate, 'yyyy-MM-dd'),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '疑義照会の起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('疑義照会を起票しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '疑義照会の起票に失敗しました');
    },
  });

  const resolveInquiryMutation = useMutation({
    mutationFn: async ({
      inquiryId,
      result,
      changeDetail,
      lineUpdate,
    }: {
      inquiryId: string;
      result: 'changed' | 'unchanged' | 'pending';
      changeDetail?: string;
      lineUpdate?: {
        drug_name: string;
        dose: string;
        frequency: string;
        days: number;
      };
    }) => {
      const res = await fetch(`/api/inquiry-records/${inquiryId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          result,
          change_detail:
            changeDetail ??
            (result === 'changed'
              ? 'workflow から処方反映ありで確定'
              : result === 'unchanged'
                ? 'workflow から変更なしで確定'
                : 'workflow から回答待ちへ更新'),
          ...(lineUpdate ? { line_update: lineUpdate } : {}),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '疑義照会の更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      setInquiryEdits((prev) => {
        const next = { ...prev };
        delete next[variables.inquiryId];
        return next;
      });
      toast.success('疑義照会を更新しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '疑義照会の更新に失敗しました');
    },
  });

  const getInquiryEditState = (item: InquiryWorkbenchItem) => {
    if (!item.inquiry_id) return buildInquiryEditState(item);
    return inquiryEdits[item.inquiry_id] ?? buildInquiryEditState(item);
  };

  const updateInquiryEditState = (
    item: InquiryWorkbenchItem,
    patch: Partial<InquiryEditState>
  ) => {
    if (!item.inquiry_id) return;
    const inquiryId = item.inquiry_id;
    setInquiryEdits((prev) => ({
      ...prev,
      [inquiryId]: {
        ...(prev[inquiryId] ?? buildInquiryEditState(item)),
        ...patch,
      },
    }));
  };

  const generateRefillProposalMutation = useMutation({
    mutationFn: async (item: WorkflowData['refill_upcoming'][number]) => {
      if (!item.case_id) {
        throw new Error('ケースIDがないため再訪候補を作成できません');
      }
      const startDate =
        item.suggested_start_date ??
        item.next_dispense_date ??
        item.refill_next_dispense_date ??
        item.split_next_dispense_date ??
        item.prescribed_date;
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          case_id: item.case_id,
          visit_type: 'regular',
          priority: 'normal',
          start_date: startDate.slice(0, 10),
          candidate_count: 3,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '再訪候補の生成に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('リフィル再訪候補を生成しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '再訪候補の生成に失敗しました');
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="h-24 animate-pulse rounded bg-muted" />
          </Card>
        ))}
      </div>
    );
  }

  const cycleStatusEntries = Object.entries(
    workflow?.cycle_status_counts ?? {}
  ).filter(([, count]) => count > 0);

  return (
    <div className="space-y-8">
      {((workflow?.workflow_exceptions.open ?? 0) > 0 ||
        (workflow?.communication_requests.overdue ?? 0) > 0 ||
        (workflow?.delivery.failures ?? 0) > 0 ||
        (workflow?.visit_operations.overdue ?? 0) > 0 ||
        (workflow?.visit_operations.awaiting_reports ?? 0) > 0 ||
        (workflow?.visit_operations.missing_visit_consent ?? 0) > 0 ||
        (workflow?.visit_operations.missing_management_plan ?? 0) > 0 ||
        (workflow?.operations_queue.self_reports_triage ?? 0) > 0 ||
        (workflow?.route_control.pending_override_requests ?? 0) > 0 ||
        (workflow?.route_control.locked_schedules ?? 0) > 0 ||
        (workflow?.route_control.emergency_impact_items ?? 0) > 0) && (
        <div className="flex flex-wrap gap-3">
          {(workflow?.workflow_exceptions.open ?? 0) > 0 && (
            <AlertPill label="ワークフロー例外" value={workflow?.workflow_exceptions.open ?? 0} />
          )}
          {(workflow?.communication_requests.overdue ?? 0) > 0 && (
            <AlertPill label="期限超過依頼" value={workflow?.communication_requests.overdue ?? 0} />
          )}
          {(workflow?.delivery.failures ?? 0) > 0 && (
            <AlertPill label="送付失敗" value={workflow?.delivery.failures ?? 0} />
          )}
          {(workflow?.visit_operations.overdue ?? 0) > 0 && (
            <AlertPill label="訪問期限超過" value={workflow?.visit_operations.overdue ?? 0} />
          )}
          {(workflow?.visit_operations.awaiting_reports ?? 0) > 0 && (
            <AlertPill label="報告待ち" value={workflow?.visit_operations.awaiting_reports ?? 0} />
          )}
          {(workflow?.operations_queue.self_reports_triage ?? 0) > 0 && (
            <AlertPill
              label="セルフレポート triage"
              value={workflow?.operations_queue.self_reports_triage ?? 0}
            />
          )}
          {(workflow?.route_control.pending_override_requests ?? 0) > 0 && (
            <AlertPill
              label="変更承認待ち"
              value={workflow?.route_control.pending_override_requests ?? 0}
            />
          )}
          {(workflow?.route_control.locked_schedules ?? 0) > 0 && (
            <AlertPill
              label="確定ロック"
              value={workflow?.route_control.locked_schedules ?? 0}
            />
          )}
          {(workflow?.route_control.emergency_impact_items ?? 0) > 0 && (
            <AlertPill
              label="緊急影響"
              value={workflow?.route_control.emergency_impact_items ?? 0}
            />
          )}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          ルート制御
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard
            icon={Route}
            label="確定ロック"
            value={workflow?.route_control.locked_schedules ?? 0}
            caption="電話確定済み"
          />
          <MetricCard
            icon={RefreshCw}
            label="変更承認待ち"
            value={workflow?.route_control.pending_override_requests ?? 0}
            caption="専用リスケ待ち"
          />
          <MetricCard
            icon={AlertTriangle}
            label="緊急影響"
            value={workflow?.route_control.emergency_impact_items ?? 0}
            caption="割込・緊急訪問"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          役割別 inbox
        </h2>
        <div className="grid gap-3 lg:grid-cols-3">
          {workflow?.role_inboxes.buckets.map((bucket) => (
            <Card key={bucket.role} size="sm">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{bucket.label}</p>
                  <Badge
                    variant={workflow?.role_inboxes.current_role === bucket.role ? 'default' : 'outline'}
                  >
                    {bucket.role}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <LoadPill label="未処理" value={bucket.open_items} />
                  <LoadPill label="至急" value={bucket.urgent_items} />
                  <LoadPill label="連絡" value={bucket.communication_items} />
                </div>
                <a href={bucket.action_href} className="text-xs font-medium text-primary hover:underline">
                  inbox を開く
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          連絡キュー
        </h2>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            icon={BellRing}
            label="未処理"
            value={workflow?.communication_queue.summary.pending_count ?? 0}
            caption="連絡全体"
          />
          <MetricCard
            icon={Clock}
            label="期限超過"
            value={workflow?.communication_queue.summary.overdue_count ?? 0}
            caption="折返し・返信"
          />
          <MetricCard
            icon={UserRound}
            label="自己申告"
            value={workflow?.communication_queue.summary.self_reports ?? 0}
            caption="患者・家族"
          />
          <MetricCard
            icon={XCircle}
            label="未確認"
            value={workflow?.communication_queue.summary.unconfirmed_count ?? 0}
            caption="draft"
          />
          <MetricCard
            icon={Clock}
            label="返信待ち"
            value={workflow?.communication_queue.summary.reply_waiting_count ?? 0}
            caption="received / waiting"
          />
          <MetricCard
            icon={XCircle}
            label="送達失敗"
            value={workflow?.communication_queue.summary.failed_count ?? 0}
            caption="再送・確認"
          />
          <MetricCard
            icon={BellRing}
            label="外部共有期限"
            value={workflow?.communication_queue.summary.expiring_external_shares ?? 0}
            caption="未閲覧の期限接近"
          />
        </div>
        {(workflow?.communication_queue.items.length ?? 0) > 0 && (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {workflow?.communication_queue.items.map((item) => (
              <Card key={item.id} size="sm">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.patient_name ?? '患者未設定'} / {item.status}
                      </p>
                    </div>
                    <Badge variant={item.priority === 'urgent' ? 'destructive' : 'outline'}>
                      {item.channel}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {((workflow?.communication_queue.emergency_drafts.length ?? 0) > 0 ||
          (workflow?.communication_queue.timeline.length ?? 0) > 0) && (
          <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">緊急連絡ドラフト</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(workflow?.communication_queue.emergency_drafts.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">緊急ドラフト候補はありません</p>
                ) : (
                  workflow?.communication_queue.emergency_drafts.map((draft) => (
                    <div key={draft.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{draft.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {draft.target_name ?? draft.target_role} / {draft.request_type}
                          </p>
                        </div>
                        <a href={draft.action_href} className="text-xs font-medium text-primary hover:underline">
                          {draft.action_label}
                        </a>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{draft.summary}</p>
                      <div className="mt-3 flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => createEmergencyDraftMutation.mutate(draft)}
                          disabled={createEmergencyDraftMutation.isPending}
                        >
                          下書き作成
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">共有タイムライン</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(workflow?.communication_queue.timeline.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">共有履歴はありません</p>
                ) : (
                  workflow?.communication_queue.timeline.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.patient_name ?? '患者未設定'} / {item.status}
                          </p>
                        </div>
                        {item.occurred_at ? (
                          <span className="text-xs text-muted-foreground">
                            {format(parseISO(item.occurred_at), 'M/d HH:mm', { locale: ja })}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          疑義照会ワークベンチ
        </h2>
        {(workflow?.inquiry_workbench.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">未処理の疑義照会はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.inquiry_workbench.map((item) => {
              const inquiryEdit = item.item_type === 'inquiry' ? getInquiryEditState(item) : null;
              const parsedDays = inquiryEdit ? Number(inquiryEdit.days) : 0;
              const canSubmitChanged =
                item.item_type !== 'inquiry' ||
                item.line_id == null ||
                (
                  inquiryEdit != null &&
                  inquiryEdit.drugName.trim().length > 0 &&
                  inquiryEdit.dose.trim().length > 0 &&
                  inquiryEdit.frequency.trim().length > 0 &&
                  Number.isInteger(parsedDays) &&
                  parsedDays > 0
                );

              return (
                <Card key={item.id} size="sm">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{item.patient_name}</p>
                          <Badge variant="outline">{item.queue_state}</Badge>
                          <Badge variant="secondary">{item.item_type === 'issue' ? '候補' : '照会中'}</Badge>
                          <StagnationIndicator updatedAt={item.created_at} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.title} / {item.inquiry_to_physician}
                        </p>
                      </div>
                      {item.due_at ? (
                        <span className="text-xs text-muted-foreground">
                          {format(parseISO(item.due_at), 'M/d HH:mm', { locale: ja })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">{item.summary}</p>
                    {item.item_type === 'inquiry' ? (
                      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                        {item.line ? (
                          <>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-foreground">変更反映対象</p>
                              <p className="text-xs text-muted-foreground">
                                現在: {item.line.drug_name} / {item.line.dose} / {item.line.frequency} / {item.line.days}日
                              </p>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              <Input
                                value={inquiryEdit?.drugName ?? ''}
                                onChange={(event) =>
                                  updateInquiryEditState(item, { drugName: event.target.value })
                                }
                                placeholder="薬剤名"
                              />
                              <Input
                                value={inquiryEdit?.dose ?? ''}
                                onChange={(event) =>
                                  updateInquiryEditState(item, { dose: event.target.value })
                                }
                                placeholder="用量"
                              />
                              <Input
                                value={inquiryEdit?.frequency ?? ''}
                                onChange={(event) =>
                                  updateInquiryEditState(item, { frequency: event.target.value })
                                }
                                placeholder="用法"
                              />
                              <Input
                                type="number"
                                min={1}
                                value={inquiryEdit?.days ?? ''}
                                onChange={(event) =>
                                  updateInquiryEditState(item, { days: event.target.value })
                                }
                                placeholder="投与日数"
                              />
                            </div>
                          </>
                        ) : null}
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-foreground">
                            {item.line ? '変更内容メモ' : '回答メモ'}
                          </p>
                          <Textarea
                            value={inquiryEdit?.changeDetail ?? ''}
                            onChange={(event) =>
                              updateInquiryEditState(item, { changeDetail: event.target.value })
                            }
                            rows={2}
                            placeholder={
                              item.line
                                ? '例: 1日3回から1日2回へ変更、14日分で再発行'
                                : '回答内容の要点を記録'
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-foreground">算定区分メタデータ</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              type="button"
                              variant={
                                inquiryEdit?.proposalOrigin === 'post_inquiry'
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() =>
                                updateInquiryEditState(item, {
                                  proposalOrigin: 'post_inquiry',
                                })
                              }
                            >
                              照会後変更
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant={
                                inquiryEdit?.proposalOrigin === 'pre_issuance'
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() =>
                                updateInquiryEditState(item, {
                                  proposalOrigin: 'pre_issuance',
                                })
                              }
                            >
                              事前提案反映
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant={inquiryEdit?.residualAdjustment ? 'default' : 'outline'}
                              onClick={() =>
                                updateInquiryEditState(item, {
                                  residualAdjustment: !inquiryEdit?.residualAdjustment,
                                })
                              }
                            >
                              {inquiryEdit?.residualAdjustment ? '残薬調整あり' : '残薬調整なし'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {item.item_type === 'issue' ? (
                        <Button
                          size="sm"
                          onClick={() => createInquiryMutation.mutate(item)}
                          disabled={!item.can_create || createInquiryMutation.isPending}
                        >
                          疑義照会を起票
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              item.inquiry_id &&
                              resolveInquiryMutation.mutate({
                                inquiryId: item.inquiry_id,
                                result: 'pending',
                                changeDetail: buildInquiryResolutionDetail({
                                  result: 'pending',
                                  changeDetail: inquiryEdit?.changeDetail,
                                  proposalOrigin: inquiryEdit?.proposalOrigin,
                                  residualAdjustment: inquiryEdit?.residualAdjustment,
                                }),
                              })
                            }
                            disabled={!item.inquiry_id || resolveInquiryMutation.isPending}
                          >
                            回答待ち
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              item.inquiry_id &&
                              resolveInquiryMutation.mutate({
                                inquiryId: item.inquiry_id,
                                result: 'changed',
                                changeDetail: buildInquiryResolutionDetail({
                                  result: 'changed',
                                  changeDetail: inquiryEdit?.changeDetail,
                                  proposalOrigin: inquiryEdit?.proposalOrigin,
                                  residualAdjustment: inquiryEdit?.residualAdjustment,
                                }),
                                lineUpdate:
                                  item.line_id != null && inquiryEdit
                                    ? {
                                        drug_name: inquiryEdit.drugName.trim(),
                                        dose: inquiryEdit.dose.trim(),
                                        frequency: inquiryEdit.frequency.trim(),
                                        days: Number(inquiryEdit.days),
                                      }
                                    : undefined,
                              })
                            }
                            disabled={
                              !item.inquiry_id ||
                              resolveInquiryMutation.isPending ||
                              !canSubmitChanged
                            }
                          >
                            変更ありで確定
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              item.inquiry_id &&
                              resolveInquiryMutation.mutate({
                                inquiryId: item.inquiry_id,
                                result: 'unchanged',
                                changeDetail: buildInquiryResolutionDetail({
                                  result: 'unchanged',
                                  changeDetail: inquiryEdit?.changeDetail,
                                  proposalOrigin: inquiryEdit?.proposalOrigin,
                                  residualAdjustment: inquiryEdit?.residualAdjustment,
                                }),
                              })
                            }
                            disabled={!item.inquiry_id || resolveInquiryMutation.isPending}
                          >
                            変更なしで確定
                          </Button>
                        </>
                      )}
                    </div>
                    {!item.can_create && item.item_type === 'issue' ? (
                      <p className="text-xs text-amber-700">
                        起票に必要な有効サイクルが見つからないため、患者詳細から確認してください。
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          患者リスク
        </h2>
        {(workflow?.patient_risk_queue.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">優先介入が必要な患者はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.patient_risk_queue.items.map((item) => (
              <Card key={item.patient_id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.patient_name}</p>
                      <p className="text-xs text-muted-foreground">
                        自己申告 {item.unresolved_self_reports} / 課題 {item.open_issues} / タスク {item.open_tasks}
                      </p>
                    </div>
                    <Badge variant={item.level === 'high' ? 'destructive' : 'outline'}>
                      {item.level} / {item.score}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {item.reasons.slice(0, 3).map((reason) => (
                      <p key={reason} className="text-sm text-muted-foreground">
                        {reason}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          運用レディネス
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard
            icon={Clock}
            label="時間外体制"
            value={workflow?.after_hours_readiness.emergency_capable_shift_count ?? 0}
            caption="緊急対応可能シフト"
          />
          <MetricCard
            icon={AlertTriangle}
            label="休日ギャップ"
            value={workflow?.after_hours_readiness.holiday_gap_count ?? 0}
            caption="当番未設定"
          />
          <MetricCard
            icon={ClipboardList}
            label="持参物ブロック"
            value={
              (workflow?.inventory_readiness.blocked ?? 0) +
              (workflow?.inventory_readiness.partial ?? 0)
            }
            caption="blocked / partial"
          />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card size="sm">
            <CardContent className="space-y-3">
              <p className="text-sm font-semibold text-foreground">地域・紹介パイプライン</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <LoadPill label="活動フォロー" value={workflow?.regional_pipeline.follow_up_activities ?? 0} />
                <LoadPill label="会議Action" value={workflow?.regional_pipeline.conference_action_items ?? 0} />
                <LoadPill label="導入案件" value={workflow?.regional_pipeline.intake_cases ?? 0} />
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="space-y-3">
              <p className="text-sm font-semibold text-foreground">請求予防</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <LoadPill label="訪問前ブロック" value={workflow?.billing_prevention.previsit_blockers ?? 0} />
                <LoadPill label="レビュー" value={workflow?.billing_prevention.review_tasks ?? 0} />
                <LoadPill label="報告滞留" value={workflow?.billing_prevention.report_delivery_backlog ?? 0} />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <HomeCareFeatureBoard
          summary={
            workflow?.home_care_feature_summary ?? {
              totals: { blocked: 0, attention: 0, monitoring: 0, ready: 0 },
              features: [],
            }
          }
          title="訪問支援ボード"
          description="訪問薬剤管理指導を止める要因と、整備すべき運用機能を同じ尺度で管理します。"
          compact
        />
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          統合ワークベンチ
        </h2>
        {(workflow?.unified_workbench.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">未処理の項目はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.unified_workbench.map((item) => (
              <Card key={item.id} size="sm" className="border-border/70">
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={priorityClass(item.priority)}>
                          {item.queue_label}
                        </Badge>
                        {item.badges.slice(0, 3).map((badge) => (
                          <Badge key={badge} variant="secondary">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    </div>
                    <a
                      href={item.action_href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {item.action_label}
                    </a>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{item.summary}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {item.patient_name && <span>患者: {item.patient_name}</span>}
                    {item.owner_name && <span>担当: {item.owner_name}</span>}
                    {item.due_at && (
                      <span>
                        期限{' '}
                        {format(parseISO(item.due_at), 'M/d HH:mm', {
                          locale: ja,
                        })}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          是正ガイダンス
        </h2>
        {(workflow?.remediation_guidance.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">即時対応が必要な前提不足はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.remediation_guidance.map((item) => (
              <Card key={item.id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={severityClass(item.severity)}>
                          {item.count}件
                        </Badge>
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <a
                      href={item.action_href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {item.action_label}
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          例外コマンドセンター
        </h2>
        {(workflow?.exception_command_center.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">重大例外はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.exception_command_center.map((item) => (
              <Card key={item.id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={severityClass(item.severity)}>
                      {item.type}
                    </Badge>
                    <a
                      href={item.action_href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {item.action_label}
                    </a>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {item.patient_name && <span>患者: {item.patient_name}</span>}
                    {item.created_at && (
                      <span>
                        起票{' '}
                        {format(parseISO(item.created_at), 'M/d HH:mm', {
                          locale: ja,
                        })}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          工程・アウトカム
        </h2>
        <div className="grid gap-3 md:grid-cols-5">
          <MetricCard
            icon={ClipboardList}
            label="完了訪問"
            value={workflow?.outcome_metrics.completed_last_7_days ?? 0}
            caption="直近7日"
          />
          <MetricCard
            icon={AlertTriangle}
            label="中断・延期"
            value={workflow?.outcome_metrics.disrupted_last_7_days ?? 0}
            caption="直近7日"
          />
          <MetricCard
            icon={TrendingUp}
            label="至急完了"
            value={workflow?.outcome_metrics.urgent_completed_last_7_days ?? 0}
            caption="直近7日"
          />
          <MetricCard
            icon={BellRing}
            label="報告待ち"
            value={workflow?.outcome_metrics.awaiting_reports ?? 0}
            caption="送信待ち"
          />
          <MetricCard
            icon={XCircle}
            label="例外未解消"
            value={workflow?.outcome_metrics.open_exceptions ?? 0}
            caption="オープン中"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          担当負荷
        </h2>
        {(workflow?.workload_metrics.pharmacists.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">表示可能な担当データがありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {workflow?.workload_metrics.pharmacists.map((item) => (
              <Card key={item.pharmacist_id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-semibold text-foreground">
                      {item.pharmacist_name}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <LoadPill label="確定訪問" value={item.confirmed_visits} />
                    <LoadPill label="未処理タスク" value={item.pending_tasks} />
                    <LoadPill label="至急案件" value={item.urgent_items} />
                    <LoadPill label="再架電" value={item.callback_followups} />
                    <LoadPill label="施設集約" value={item.facility_clusters} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          施設モード可視化
        </h2>
        {(workflow?.facility_visibility.clusters.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">同日集約の候補はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.facility_visibility.clusters.map((cluster) => (
              <Card key={cluster.id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                        <p className="text-sm font-semibold text-foreground">
                          {cluster.label}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(cluster.date), 'M/d(E)', { locale: ja })} /{' '}
                        {cluster.site_name ?? '拠点未設定'} / {cluster.pharmacist_name ?? '担当未設定'}
                      </p>
                    </div>
                    <Badge variant="outline">{cluster.patient_count}名</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    ルート順 {cluster.route_window} / {cluster.patient_names.join('、')}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Intake から訪問への接続
        </h2>
        {(workflow?.intake_linkage.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">未接続の処方受付はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.intake_linkage.map((item) => (
              <Card key={item.id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.patient_name}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.category}</p>
                    </div>
                    <a
                      href={item.action_href}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {item.action_label}
                    </a>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{item.reason}</p>
                  {item.due_at && (
                    <p className="text-xs text-muted-foreground">
                      期限{' '}
                      {format(parseISO(item.due_at), 'M/d', {
                        locale: ja,
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          患者・家族セルフレポート
        </h2>
        {(workflow?.self_reports.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">triage 対象の申告はありません</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {workflow?.self_reports.map((report) => (
              <Card key={report.id} size="sm">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {report.patient_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {report.reported_by_name}
                        {report.relation ? ` (${report.relation})` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{report.status}</Badge>
                      <Badge variant="secondary">{report.category}</Badge>
                      {report.requested_callback && <Badge variant="destructive">折返し希望</Badge>}
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{report.subject}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>
                      受付{' '}
                      {format(parseISO(report.created_at), 'M/d HH:mm', {
                        locale: ja,
                      })}
                    </span>
                    {report.preferred_contact_time && (
                      <span>希望連絡帯 {report.preferred_contact_time}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          処方サイクル工程別件数
        </h2>
        {cycleStatusEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            進行中のサイクルはありません
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {cycleStatusEntries.map(([status, count]) => {
              const config = CYCLE_STATUS_LABELS[status] ?? {
                label: status,
                color: 'bg-gray-100 text-gray-600',
              };
              return (
                <Card key={status} size="sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {config.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <span className="text-3xl font-bold tabular-nums text-foreground">
                        {count}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}
                      >
                        件
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          連携ダッシュボード
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <MetricCard icon={BellRing} label="返信待ち依頼" value={workflow?.communication_requests.pending ?? 0} caption="未完了" />
          <MetricCard icon={Clock} label="期限超過" value={workflow?.communication_requests.overdue ?? 0} caption="依頼" />
          <MetricCard icon={XCircle} label="送付失敗" value={workflow?.delivery.failures ?? 0} caption="送信" />
          <MetricCard icon={AlertTriangle} label="例外未解消" value={workflow?.workflow_exceptions.open ?? 0} caption="workflow" />
          <MetricCard icon={Route} label="確定ロック" value={workflow?.route_operations.locked_confirmed_visits ?? 0} caption="route" />
          <MetricCard icon={UserRound} label="代替担当" value={workflow?.route_operations.fallback_assignments ?? 0} caption="handoff" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          運用キュー
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <QueueCard label="訪問候補承認待ち" count={workflow?.operations_queue.visit_demands ?? 0} />
          <QueueCard label="再架電待ち" count={workflow?.operations_queue.callback_followups ?? 0} />
          <QueueCard label="計画見直し" count={workflow?.operations_queue.management_plan_reviews ?? 0} />
          <QueueCard label="訪問準備未完了" count={workflow?.operations_queue.preparation_pending ?? 0} />
          <QueueCard label="変更承認待ち" count={workflow?.route_operations.override_pending ?? 0} />
          <QueueCard label="住所座標確認" count={workflow?.operations_queue.geocode_reviews ?? 0} />
          <QueueCard label="Intake未接続" count={workflow?.operations_queue.intake_linkages ?? 0} />
          <QueueCard label="セルフレポート" count={workflow?.operations_queue.self_reports_triage ?? 0} />
          <QueueCard label="緊急候補" count={workflow?.route_operations.emergency_candidates ?? 0} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          継続調剤 — 次回対応
        </h2>
        {(workflow?.refill_upcoming.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            継続調剤の予定はありません
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    患者名
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    状況
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    次回調剤日
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                    再訪候補
                  </th>
                </tr>
              </thead>
              <tbody>
                {workflow?.refill_upcoming.map((item, index) => (
                  <tr
                    key={item.id}
                    className={index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                  >
                    <td className="px-4 py-2 font-medium">
                      {item.cycle.case_.patient.name}
                    </td>
                    <td className="px-4 py-2">
                      {item.upcoming_kind === 'refill' ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">リフィル残{item.remaining_count}回</Badge>
                          <Badge variant="outline">薬局保管</Badge>
                        </div>
                      ) : (
                        <Badge variant="outline">
                          分割 {item.split_dispense_current}/{item.split_dispense_total}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {item.next_dispense_date
                        ? format(parseISO(item.next_dispense_date), 'M/d', {
                            locale: ja,
                          })
                        : format(parseISO(item.prescribed_date), 'M/d', {
                            locale: ja,
                          })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {item.has_existing_route ? (
                        <Badge variant="outline">既存導線あり</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => generateRefillProposalMutation.mutate(item)}
                          disabled={
                            !item.case_id ||
                            item.has_existing_route ||
                            generateRefillProposalMutation.isPending
                          }
                        >
                          候補生成
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          type="button"
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          更新
        </button>
      </div>
    </div>
  );
}

function AlertPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="size-4" aria-hidden="true" />
      {label} <span className="font-bold">{value}</span>件
    </div>
  );
}

function QueueCard({ label, count }: { label: string; count: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span className={`text-3xl font-bold tabular-nums ${count > 0 ? 'text-orange-600' : ''}`}>
          {count}
        </span>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof Route;
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
