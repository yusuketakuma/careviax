'use client';

import { type FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Clock,
  Inbox,
  Phone,
  RadioTower,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { PageSection } from '@/components/layout/page-section';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { SkeletonRows } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type InboundInboxItem = {
  id: string;
  title: string;
  summary: string;
  channel: string;
  status: string;
  priority: 'urgent' | 'high' | 'normal';
  patient_name: string | null;
  due_at: string | null;
  action_href: string;
  action_label: string;
};

type InboundInboxData = {
  summary: {
    total_visible_count: number;
    filtered_count: number;
    needs_review_count: number;
    reviewed_pending_action_count: number;
    urgent_count: number;
    channel_counts: Record<'phone' | 'fax' | 'email' | 'mcs', number>;
  };
  items: InboundInboxItem[];
  filters: {
    channel: string | null;
    status: string | null;
    priority: string | null;
  };
};

type InboundInboxResponse = {
  data: InboundInboxData;
  meta: {
    generated_at: string;
    limit: number;
    count_basis: string;
  };
};

type InboundPhoneResponse = {
  data: {
    id: string;
    status: string;
    action_href: string;
  };
  meta: {
    generated_at: string;
  };
};

type InboundMcsResponse = InboundPhoneResponse;

type InboundSignalTaskResponse = {
  data: {
    task_id: string;
    task_type: string;
    status: string;
    action_href: string;
  };
  meta: {
    generated_at: string;
  };
};

type InboundSignalReviewAction = 'accept' | 'record_only' | 'reject';

type InboundSignalReviewResponse = {
  data: {
    signal_id: string;
    inbound_event_id: string;
    review_status: string;
    action_status: string;
    reviewed_at: string | null;
    review_task_closure_count?: number;
  };
  meta: {
    generated_at: string;
  };
};

type InboundSignalCandidateItem = {
  candidate_key: string;
  inbound_event_id: string;
  signal_id: string;
  channel: 'phone' | 'fax' | 'email' | 'mcs';
  occurred_at: string;
  patient_linked: boolean;
  case_linked: boolean;
  signal: {
    domain: string;
    type: string;
    has_quantity: boolean;
    unit: string | null;
    quantity_effect: string | null;
    source_confidence: string;
    review_status: string;
    action_status: string;
    evidence_code: string;
    requires_pharmacist_review: boolean;
    stock_review: {
      action: 'stage_for_pharmacist_review' | 'ignore_non_stock_signal' | 'reject_unsafe_payload';
      target_label: string;
      observation_kind: string | null;
      ledger_write_policy: string | null;
      review_priority: 'low' | 'medium' | 'high' | null;
      warning_codes: string[];
      has_medication_identity: boolean | null;
      has_observed_quantity: boolean | null;
      has_usage_quantity: boolean | null;
      direct_ledger_write_allowed: false;
    } | null;
  };
};

type InboundSignalCandidatesResponse = {
  data: {
    summary: {
      source_event_count: number;
      events_with_signals_count: number;
      signal_count: number;
      urgent_count: number;
      domain_counts: {
        medication_stock: number;
        medication_safety: number;
        schedule: number;
        urgent: number;
      };
    };
    items: InboundSignalCandidateItem[];
    filters: {
      channel: string | null;
      domain: string | null;
      type: string | null;
    };
  };
  meta: {
    generated_at: string;
    limit: number;
    count_basis: string;
    source: string;
    classifier_version: string;
  };
};

type PhoneFormState = {
  patientId: string;
  caseId: string;
  counterpartName: string;
  counterpartContact: string;
  eventType:
    | 'general_note'
    | 'medication_stock_report'
    | 'medication_safety_report'
    | 'schedule_request';
  content: string;
};

type McsFormState = {
  patientId: string;
  caseId: string;
  senderName: string;
  senderRole: string;
  senderOrganization: string;
  sourceUrl: string;
  eventType:
    | 'general_note'
    | 'medication_stock_report'
    | 'medication_safety_report'
    | 'schedule_request';
  content: string;
};

const CHANNEL_FILTERS = [
  { value: '', label: 'すべて' },
  { value: 'phone', label: '電話' },
  { value: 'fax', label: 'FAX' },
  { value: 'email', label: 'メール' },
  { value: 'mcs', label: 'MCS' },
] as const;

const PRIORITY_FILTERS = [
  { value: '', label: 'すべて' },
  { value: 'urgent', label: '至急' },
  { value: 'high', label: '要確認' },
  { value: 'normal', label: '通常' },
] as const;

const STATUS_FILTERS = [
  { value: 'needs_review', label: '未処理' },
  { value: 'reviewed_pending_action', label: '確認済み未反映' },
  { value: 'task_created', label: 'タスク化済み' },
  { value: 'task_completed', label: '処理済み' },
  { value: '', label: 'すべて' },
] as const;

const PHONE_EVENT_TYPES: Array<{ value: PhoneFormState['eventType']; label: string }> = [
  { value: 'general_note', label: '一般メモ' },
  { value: 'medication_stock_report', label: '残数報告' },
  { value: 'medication_safety_report', label: '薬剤安全' },
  { value: 'schedule_request', label: '日程相談' },
];

const MCS_EVENT_TYPES: Array<{ value: McsFormState['eventType']; label: string }> = [
  { value: 'general_note', label: '一般投稿' },
  { value: 'medication_stock_report', label: '残数報告' },
  { value: 'medication_safety_report', label: '薬剤安全' },
  { value: 'schedule_request', label: '日程相談' },
];

const EMPTY_ITEMS: InboundInboxItem[] = [];
const EMPTY_PHONE_FORM: PhoneFormState = {
  patientId: '',
  caseId: '',
  counterpartName: '',
  counterpartContact: '',
  eventType: 'general_note',
  content: '',
};
const EMPTY_MCS_FORM: McsFormState = {
  patientId: '',
  caseId: '',
  senderName: '',
  senderRole: '',
  senderOrganization: '',
  sourceUrl: '',
  eventType: 'general_note',
  content: '',
};

const channelLabel: Record<string, string> = {
  phone: '電話',
  fax: 'FAX',
  email: 'メール',
  mcs: 'MCS',
};

const signalDomainLabel: Record<string, string> = {
  medication_stock: '残数・使用量',
  medication_safety: '薬剤安全',
  schedule: '日程',
  urgent: '至急',
};

const signalTypeLabel: Record<string, string> = {
  observed_quantity: '残数観測',
  usage_delta: '使用量',
  low_stock_text: '残数少',
  out_of_stock_text: '不足',
  refill_request: '補充希望',
  side_effect_suspected: '副作用疑い',
  schedule_change_request: '日程変更',
  visit_request: '訪問希望',
  urgent_review_required: '緊急確認',
};

const stockObservationKindLabel: Record<string, string> = {
  remaining_quantity: '残数観測',
  patient_held_stock: '保有薬確認',
  prn_usage_report: '使用量報告',
  topical_remaining_report: '外用薬確認',
  no_stock_observed: '在庫なし',
  unknown: '確認事項',
};

const stockWarningLabel: Record<string, string> = {
  medication_identity_missing: '薬剤未紐づけ',
  medication_equivalence_review_required: '名寄せ確認',
  medication_name_only_identity: '名称のみ',
  package_identity_without_clinical_code: '包装コードのみ',
  raw_phi_key_present: '安全確認',
  no_stock_signal: '残数候補なし',
  unknown_source: '情報源未確認',
  review_required: '薬剤師確認',
};

const stockReviewPriorityLabel: Record<'low' | 'medium' | 'high', string> = {
  low: '優先度 低',
  medium: '優先度 中',
  high: '優先度 高',
};

function buildInboundInboxPath(filters: { channel: string; priority: string; status: string }) {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (filters.status) params.set('status', filters.status);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.priority) params.set('priority', filters.priority);
  const query = params.toString();
  return `/api/communications/inbound${query ? `?${query}` : ''}`;
}

function buildInboundSignalPath(filters: { channel: string }) {
  const params = new URLSearchParams();
  params.set('limit', '50');
  if (filters.channel) params.set('channel', filters.channel);
  const query = params.toString();
  return `/api/communications/inbound/signals${query ? `?${query}` : ''}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '日時未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時未設定';
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function priorityBadge(item: InboundInboxItem) {
  if (item.priority === 'urgent') return { role: 'hazard' as const, label: '至急' };
  if (item.priority === 'high') return { role: 'confirm' as const, label: '要確認' };
  return { role: 'info' as const, label: '通常' };
}

function communicationEventIdFromInboxId(id: string) {
  const prefix = 'inbound_communication:';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function signalReviewTarget(signal: InboundSignalCandidateItem['signal']) {
  if (signal.stock_review?.target_label) return signal.stock_review.target_label;
  if (signal.domain === 'medication_stock') return '残数レビュー';
  if (signal.domain === 'medication_safety' || signal.domain === 'urgent') return '薬剤師確認';
  if (signal.domain === 'schedule') return '日程調整';
  return '記録確認';
}

function signalReviewButtonDisabled(item: InboundSignalCandidateItem) {
  return item.signal.review_status !== 'needs_review';
}

function signalTaskButtonDisabled(item: InboundSignalCandidateItem) {
  return (
    item.signal.review_status !== 'needs_review' ||
    item.signal.action_status === 'linked_to_task' ||
    item.signal.action_status === 'linked_to_stock_event' ||
    item.signal.action_status === 'ignored'
  );
}

function signalReviewStatusBadge(status: string) {
  switch (status) {
    case 'needs_review':
      return { role: 'confirm' as const, label: '確認待ち' };
    case 'auto_accepted':
      return { role: 'info' as const, label: '自動受付' };
    case 'accepted':
      return { role: 'done' as const, label: '確認済み' };
    case 'record_only':
      return { role: 'info' as const, label: '記録のみ' };
    case 'rejected':
      return { role: 'readonly' as const, label: '却下済み' };
    case 'superseded':
      return { role: 'readonly' as const, label: '更新済み' };
    default:
      return { role: 'info' as const, label: '状態確認' };
  }
}

function signalActionStatusBadge(status: string) {
  switch (status) {
    case 'not_linked':
      return { role: 'info' as const, label: '未反映' };
    case 'linked_to_stock_event':
      return { role: 'done' as const, label: '残数反映済み' };
    case 'linked_to_task':
      return { role: 'confirm' as const, label: 'タスク化済み' };
    case 'linked_to_schedule':
      return { role: 'info' as const, label: '日程連動済み' };
    case 'linked_to_report':
      return { role: 'info' as const, label: '報告候補化済み' };
    case 'linked_to_visit_brief':
      return { role: 'info' as const, label: '訪問ブリーフ連動済み' };
    case 'ignored':
      return { role: 'readonly' as const, label: '反映なし' };
    default:
      return { role: 'info' as const, label: '処理状態確認' };
  }
}

function stockWarningDisplayLabel(code: string) {
  if (stockWarningLabel[code]) return stockWarningLabel[code];
  if (code.startsWith('ignored_signal:')) return '対象外候補';
  return '薬剤師確認';
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
        </div>
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  );
}

export function InboundCommunicationsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('needs_review');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneForm, setPhoneForm] = useState<PhoneFormState>(EMPTY_PHONE_FORM);
  const [mcsForm, setMcsForm] = useState<McsFormState>(EMPTY_MCS_FORM);

  const queryPath = buildInboundInboxPath({ channel, priority, status });
  const signalQueryPath = buildInboundSignalPath({ channel });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['communications-inbound', orgId, channel, priority, status],
    queryFn: async () => {
      const response = await fetch(queryPath, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<InboundInboxResponse>(response, {
        fallbackMessage: '他職種受信インボックスの取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });
  const {
    data: signalData,
    isLoading: isLoadingSignals,
    isError: isErrorSignals,
    refetch: refetchSignals,
  } = useQuery({
    queryKey: ['communications-inbound-signals', orgId, channel],
    queryFn: async () => {
      const response = await fetch(signalQueryPath, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<InboundSignalCandidatesResponse>(response, {
        fallbackMessage: '受信シグナル候補の取得に失敗しました',
      });
    },
    enabled: !!orgId,
  });

  const phoneMutation = useMutation({
    mutationFn: async (input: PhoneFormState) => {
      const body = {
        ...(input.patientId.trim() ? { patient_id: input.patientId.trim() } : {}),
        ...(input.caseId.trim() ? { case_id: input.caseId.trim() } : {}),
        ...(input.counterpartName.trim() ? { counterpart_name: input.counterpartName.trim() } : {}),
        ...(input.counterpartContact.trim()
          ? { counterpart_contact: input.counterpartContact.trim() }
          : {}),
        event_type: input.eventType,
        content: input.content.trim(),
      };
      const response = await fetch('/api/communications/inbound/phone', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(body),
      });
      return readApiJson<InboundPhoneResponse>(response, {
        fallbackMessage: '電話メモを登録できませんでした',
      });
    },
    onSuccess: async () => {
      toast.success('電話メモを受信キューに登録しました');
      setPhoneForm(EMPTY_PHONE_FORM);
      setSelectedId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communications-inbound', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['communications-inbound-signals', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '電話メモを登録できませんでした'));
    },
  });

  const mcsMutation = useMutation({
    mutationFn: async (input: McsFormState) => {
      const body = {
        ...(input.patientId.trim() ? { patient_id: input.patientId.trim() } : {}),
        ...(input.caseId.trim() ? { case_id: input.caseId.trim() } : {}),
        ...(input.senderName.trim() ? { sender_name: input.senderName.trim() } : {}),
        ...(input.senderRole.trim() ? { sender_role: input.senderRole.trim() } : {}),
        ...(input.senderOrganization.trim()
          ? { sender_organization: input.senderOrganization.trim() }
          : {}),
        ...(input.sourceUrl.trim() ? { source_url: input.sourceUrl.trim() } : {}),
        event_type: input.eventType,
        content: input.content.trim(),
      };
      const response = await fetch('/api/communications/inbound/mcs', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(body),
      });
      return readApiJson<InboundMcsResponse>(response, {
        fallbackMessage: 'MCS投稿を登録できませんでした',
      });
    },
    onSuccess: async () => {
      toast.success('MCS投稿を受信キューに登録しました');
      setMcsForm(EMPTY_MCS_FORM);
      setSelectedId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communications-inbound', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['communications-inbound-signals', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'MCS投稿を登録できませんでした'));
    },
  });

  const taskMutation = useMutation({
    mutationFn: async (candidateKey: string) => {
      const response = await fetch('/api/communications/inbound/signals/tasks', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ candidate_key: candidateKey }),
      });
      return readApiJson<InboundSignalTaskResponse>(response, {
        fallbackMessage: '薬剤師確認タスクを作成できませんでした',
      });
    },
    onSuccess: async () => {
      toast.success('薬剤師確認タスクを作成しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communications-inbound', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['communications-inbound-signals', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '薬剤師確認タスクを作成できませんでした'));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: { signalId: string; action: InboundSignalReviewAction }) => {
      const body =
        input.action === 'reject'
          ? { action: input.action, reason: 'rejected_from_inbound_review_queue' }
          : { action: input.action };
      const response = await fetch(`/api/communications/inbound/signals/${input.signalId}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(body),
      });
      return readApiJson<InboundSignalReviewResponse>(response, {
        fallbackMessage: '受信シグナルのレビュー状態を更新できませんでした',
      });
    },
    onSuccess: async (response) => {
      const closedCount = response.data.review_task_closure_count ?? 0;
      toast.success(
        closedCount > 0
          ? '受信シグナルを確認し、関連レビュータスクを完了しました'
          : '受信シグナルのレビュー状態を更新しました',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communications-inbound', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['communications-inbound-signals', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '受信シグナルのレビュー状態を更新できませんでした'));
    },
  });

  const inbox = data?.data;
  const signalCandidates = signalData?.data;
  const items = inbox?.items ?? EMPTY_ITEMS;
  const selectedItem = useMemo(() => {
    if (selectedId) return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
    return items[0] ?? null;
  }, [items, selectedId]);
  const selectedCommunicationEventId = selectedItem
    ? communicationEventIdFromInboxId(selectedItem.id)
    : null;
  const selectedSignalCandidates = useMemo(() => {
    if (!selectedCommunicationEventId || !signalCandidates) return [];
    return signalCandidates.items.filter(
      (item) => item.inbound_event_id === selectedCommunicationEventId,
    );
  }, [selectedCommunicationEventId, signalCandidates]);
  const isInitialLoading = isLoading && !inbox;

  const handlePhoneSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phoneForm.content.trim() || !orgId || phoneMutation.isPending) return;
    phoneMutation.mutate(phoneForm);
  };

  const handleMcsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mcsForm.content.trim() || !orgId || mcsMutation.isPending) return;
    mcsMutation.mutate(mcsForm);
  };

  return (
    <div className="space-y-4" data-testid="inbound-communications-content">
      <PageSection
        title="受信状況"
        description="他職種から薬局へ届いた確認待ち情報を、患者詳細を開かずに検出します。"
        tone="subtle"
      >
        {isError ? (
          <ErrorState
            variant="server"
            title="他職種受信を表示できません"
            cause="受信キューの取得に失敗しました。"
            nextAction="通信状態を確認して再試行してください。失敗時は受信なしとして扱いません。"
            onRetry={() => void refetch()}
            headingLevel={3}
          />
        ) : isInitialLoading ? (
          <div
            role="status"
            aria-label="他職種受信インボックスを読み込み中"
            aria-live="polite"
            className="rounded-lg border border-dashed border-border bg-card px-5 py-5"
          >
            <SkeletonRows rows={3} cols={3} status={false} />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              icon={Inbox}
              label="表示対象"
              value={inbox?.summary.filtered_count ?? 0}
              caption="現在の条件"
            />
            <SummaryTile
              icon={BellRing}
              label="確認待ち"
              value={inbox?.summary.needs_review_count ?? 0}
              caption="needs_review"
            />
            <SummaryTile
              icon={Clock}
              label="確認済み未反映"
              value={inbox?.summary.reviewed_pending_action_count ?? 0}
              caption="反映待ち"
            />
            <SummaryTile
              icon={TriangleAlert}
              label="至急"
              value={inbox?.summary.urgent_count ?? 0}
              caption="優先対応"
            />
            <SummaryTile
              icon={Phone}
              label="電話"
              value={inbox?.summary.channel_counts.phone ?? 0}
              caption="通話由来"
            />
            <SummaryTile
              icon={RadioTower}
              label="MCS"
              value={inbox?.summary.channel_counts.mcs ?? 0}
              caption="貼り付け/連携"
            />
          </div>
        )}
      </PageSection>

      <PageSection
        title="電話メモを登録"
        description="電話で受けた他職種情報を、確認待ちの受信情報として登録します。登録後の一覧には本文を表示しません。"
        tone="subtle"
      >
        <form className="space-y-4" onSubmit={handlePhoneSubmit}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">患者ID</span>
              <Input
                value={phoneForm.patientId}
                onChange={(event) =>
                  setPhoneForm((current) => ({ ...current, patientId: event.target.value }))
                }
                placeholder="未確定なら空欄"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">ケースID</span>
              <Input
                value={phoneForm.caseId}
                onChange={(event) =>
                  setPhoneForm((current) => ({ ...current, caseId: event.target.value }))
                }
                placeholder="任意"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">相手</span>
              <Input
                value={phoneForm.counterpartName}
                onChange={(event) =>
                  setPhoneForm((current) => ({ ...current, counterpartName: event.target.value }))
                }
                placeholder="職種・氏名"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">連絡先</span>
              <Input
                value={phoneForm.counterpartContact}
                onChange={(event) =>
                  setPhoneForm((current) => ({
                    ...current,
                    counterpartContact: event.target.value,
                  }))
                }
                placeholder="必要時のみ"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">種別</span>
              <div className="flex flex-wrap gap-2">
                {PHONE_EVENT_TYPES.map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant={phoneForm.eventType === item.value ? 'default' : 'outline'}
                    className="min-h-[40px]"
                    onClick={() =>
                      setPhoneForm((current) => ({ ...current, eventType: item.value }))
                    }
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
              登録レスポンスと一覧には本文・連絡先・添付名を返しません。詳細確認は再認可後の画面で行います。
            </div>
          </div>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">電話メモ本文</span>
            <Textarea
              value={phoneForm.content}
              onChange={(event) =>
                setPhoneForm((current) => ({ ...current, content: event.target.value }))
              }
              placeholder="例: 湿布は残り4枚です。来週の訪問時間を変更したいとの連絡。"
              className="min-h-24"
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              患者が未確定でも登録できます。未紐づけの受信情報としてレビューキューに残します。
            </p>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!phoneForm.content.trim() || phoneMutation.isPending}
            >
              {phoneMutation.isPending ? '登録中' : '電話メモを登録'}
            </Button>
          </div>
        </form>
      </PageSection>

      <PageSection
        title="MCS投稿を貼り付け"
        description="MCSで受けた他職種投稿を確認待ちの受信情報として登録します。API連携ではなく手入力の短期ブリッジです。"
        tone="subtle"
      >
        <form className="space-y-4" onSubmit={handleMcsSubmit}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">患者ID</span>
              <Input
                value={mcsForm.patientId}
                onChange={(event) =>
                  setMcsForm((current) => ({ ...current, patientId: event.target.value }))
                }
                placeholder="未確定なら空欄"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">ケースID</span>
              <Input
                value={mcsForm.caseId}
                onChange={(event) =>
                  setMcsForm((current) => ({ ...current, caseId: event.target.value }))
                }
                placeholder="任意"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">投稿者</span>
              <Input
                value={mcsForm.senderName}
                onChange={(event) =>
                  setMcsForm((current) => ({ ...current, senderName: event.target.value }))
                }
                placeholder="氏名"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">職種</span>
              <Input
                value={mcsForm.senderRole}
                onChange={(event) =>
                  setMcsForm((current) => ({ ...current, senderRole: event.target.value }))
                }
                placeholder="訪問看護師など"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">所属</span>
              <Input
                value={mcsForm.senderOrganization}
                onChange={(event) =>
                  setMcsForm((current) => ({
                    ...current,
                    senderOrganization: event.target.value,
                  }))
                }
                placeholder="事業所・施設"
                autoComplete="off"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">MCSスレッドURL</span>
              <Input
                value={mcsForm.sourceUrl}
                onChange={(event) =>
                  setMcsForm((current) => ({ ...current, sourceUrl: event.target.value }))
                }
                placeholder="https://www.medical-care.net/..."
                autoComplete="off"
              />
            </label>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">種別</span>
              <div className="flex flex-wrap gap-2">
                {MCS_EVENT_TYPES.map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant={mcsForm.eventType === item.value ? 'default' : 'outline'}
                    className="min-h-[40px]"
                    onClick={() => setMcsForm((current) => ({ ...current, eventType: item.value }))}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
              登録レスポンス、一覧、シグナル候補には本文・投稿者・URLを返しません。MCS URL
              は許可ホストだけ保存します。
            </div>
          </div>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">MCS投稿本文</span>
            <Textarea
              value={mcsForm.content}
              onChange={(event) =>
                setMcsForm((current) => ({ ...current, content: event.target.value }))
              }
              placeholder="例: 湿布は残り4枚です。痛み止めの使用が増えています。"
              className="min-h-28"
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              患者が未確定でも登録できます。正式なMCS API連携は後続フェーズで扱います。
            </p>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!mcsForm.content.trim() || mcsMutation.isPending}
            >
              {mcsMutation.isPending ? '登録中' : 'MCS投稿を登録'}
            </Button>
          </div>
        </form>
      </PageSection>

      <PageSection
        title="レビューキュー"
        description="一覧は要約のみです。原文や添付は詳細画面で権限確認後に扱います。"
        tone="default"
        contentClassName={
          isError || isInitialLoading
            ? undefined
            : 'grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_22rem]'
        }
      >
        {isError || isInitialLoading ? null : (
          <>
            <aside className="space-y-4" aria-label="他職種受信フィルタ">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">チャネル</h3>
                <div className="grid gap-2">
                  {CHANNEL_FILTERS.map((filter) => (
                    <Button
                      key={filter.value || 'all'}
                      type="button"
                      variant={channel === filter.value ? 'default' : 'outline'}
                      className="min-h-[44px] justify-start"
                      onClick={() => {
                        setChannel(filter.value);
                        setSelectedId(null);
                      }}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">優先度</h3>
                <div className="grid gap-2">
                  {PRIORITY_FILTERS.map((filter) => (
                    <Button
                      key={filter.value || 'all'}
                      type="button"
                      variant={priority === filter.value ? 'default' : 'outline'}
                      className="min-h-[44px] justify-start"
                      onClick={() => {
                        setPriority(filter.value);
                        setSelectedId(null);
                      }}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">処理状態</h3>
                <div className="grid gap-2">
                  {STATUS_FILTERS.map((filter) => (
                    <Button
                      key={filter.value || 'all'}
                      type="button"
                      variant={status === filter.value ? 'default' : 'outline'}
                      className="min-h-[44px] justify-start"
                      onClick={() => {
                        setStatus(filter.value);
                        setSelectedId(null);
                      }}
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="space-y-3" role="list" aria-label="他職種受信一覧">
              {items.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="確認待ちの他職種受信はありません"
                  description="現在の条件に該当する受信情報はありません。取得失敗時はこの空状態ではなくエラーとして表示します。"
                  headingLevel={3}
                />
              ) : (
                items.map((item) => {
                  const badge = priorityBadge(item);
                  const selected = selectedItem?.id === item.id;
                  return (
                    <div key={item.id} role="listitem">
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40',
                        )}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-semibold text-foreground">{item.title}</p>
                            <p className="text-sm leading-6 text-muted-foreground">
                              {item.summary}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.patient_name ?? '患者未紐づけ'} / {formatDateTime(item.due_at)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <StateBadge role={badge.role}>{badge.label}</StateBadge>
                            <StateBadge role="info">
                              {channelLabel[item.channel] ?? item.channel}
                            </StateBadge>
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <aside
              className="rounded-lg border border-border bg-card p-4"
              aria-label="選択中の受信概要"
              data-testid="selected-inbound-review-panel"
            >
              {selectedItem ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <RadioTower className="size-4 text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm font-semibold text-foreground">レビュー概要</p>
                    </div>
                    <h3 className="text-base font-bold text-foreground">{selectedItem.title}</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {selectedItem.summary}
                    </p>
                  </div>
                  <dl className="grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">患者</dt>
                      <dd className="font-medium text-foreground">
                        {selectedItem.patient_name ?? '未紐づけ'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">チャネル</dt>
                      <dd className="font-medium text-foreground">
                        {channelLabel[selectedItem.channel] ?? selectedItem.channel}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">受信日時</dt>
                      <dd className="font-medium text-foreground">
                        {formatDateTime(selectedItem.due_at)}
                      </dd>
                    </div>
                  </dl>
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
                    一覧では原文・相手連絡先・添付名を表示しません。詳細画面で再認可後に確認します。
                  </div>
                  <div className="space-y-3" data-testid="selected-inbound-signals">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-foreground">抽出候補</h4>
                      <StateBadge role="info">{selectedSignalCandidates.length}件</StateBadge>
                    </div>
                    {isErrorSignals ? (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
                        候補分類を取得できません。受信情報の正本は保持されています。
                      </div>
                    ) : isLoadingSignals && !signalCandidates ? (
                      <div
                        role="status"
                        aria-label="選択中の受信シグナル候補を読み込み中"
                        aria-live="polite"
                        className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3"
                      >
                        <SkeletonRows rows={1} cols={2} status={false} />
                      </div>
                    ) : selectedSignalCandidates.length > 0 ? (
                      <div className="space-y-2">
                        {selectedSignalCandidates.map((item) => {
                          const reviewBadge = signalReviewStatusBadge(item.signal.review_status);
                          const actionBadge = signalActionStatusBadge(item.signal.action_status);
                          const showAcceptedPendingStockLink =
                            item.signal.review_status === 'accepted' &&
                            item.signal.action_status === 'not_linked' &&
                            item.signal.domain === 'medication_stock';

                          return (
                            <div
                              key={item.candidate_key}
                              className="rounded-md border border-border bg-background px-3 py-3"
                            >
                              <div className="flex flex-col gap-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-foreground">
                                      {signalDomainLabel[item.signal.domain] ?? item.signal.domain}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {signalTypeLabel[item.signal.type] ?? item.signal.type}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    <StateBadge role={reviewBadge.role}>
                                      {reviewBadge.label}
                                    </StateBadge>
                                    <StateBadge role={actionBadge.role}>
                                      {actionBadge.label}
                                    </StateBadge>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <StateBadge role="info">
                                    反映先候補 {signalReviewTarget(item.signal)}
                                  </StateBadge>
                                  {item.signal.has_quantity ? (
                                    <StateBadge role="info">
                                      単位 {item.signal.unit ?? '未特定'}
                                    </StateBadge>
                                  ) : null}
                                  {item.signal.stock_review?.review_priority ? (
                                    <StateBadge
                                      role={
                                        item.signal.stock_review.review_priority === 'high'
                                          ? 'hazard'
                                          : 'confirm'
                                      }
                                    >
                                      {
                                        stockReviewPriorityLabel[
                                          item.signal.stock_review.review_priority
                                        ]
                                      }
                                    </StateBadge>
                                  ) : null}
                                  {item.signal.stock_review?.observation_kind ? (
                                    <StateBadge role="info">
                                      {stockObservationKindLabel[
                                        item.signal.stock_review.observation_kind
                                      ] ?? '残数確認'}
                                    </StateBadge>
                                  ) : null}
                                  {item.signal.stock_review?.warning_codes.map((code) => (
                                    <StateBadge key={code} role="confirm">
                                      {stockWarningDisplayLabel(code)}
                                    </StateBadge>
                                  ))}
                                  {!item.patient_linked ? (
                                    <StateBadge role="hazard">患者未紐づけ</StateBadge>
                                  ) : null}
                                  {!item.case_linked ? (
                                    <StateBadge role="info">ケース未紐づけ</StateBadge>
                                  ) : null}
                                </div>
                                {showAcceptedPendingStockLink ? (
                                  <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                    薬剤師レビューは完了しています。残数台帳への反映は、残数管理の明示操作で行います。
                                  </p>
                                ) : null}
                                <div className="flex justify-end">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-[36px]"
                                      disabled={
                                        reviewMutation.isPending || signalReviewButtonDisabled(item)
                                      }
                                      onClick={() =>
                                        reviewMutation.mutate({
                                          signalId: item.signal_id,
                                          action: 'accept',
                                        })
                                      }
                                    >
                                      確認済み
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-[36px]"
                                      disabled={
                                        reviewMutation.isPending || signalReviewButtonDisabled(item)
                                      }
                                      onClick={() =>
                                        reviewMutation.mutate({
                                          signalId: item.signal_id,
                                          action: 'record_only',
                                        })
                                      }
                                    >
                                      記録のみ
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-[36px]"
                                      disabled={
                                        reviewMutation.isPending || signalReviewButtonDisabled(item)
                                      }
                                      onClick={() =>
                                        reviewMutation.mutate({
                                          signalId: item.signal_id,
                                          action: 'reject',
                                        })
                                      }
                                    >
                                      却下
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="min-h-[36px]"
                                      disabled={
                                        taskMutation.isPending || signalTaskButtonDisabled(item)
                                      }
                                      onClick={() => taskMutation.mutate(item.candidate_key)}
                                    >
                                      薬剤師確認タスク化
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
                        この受信情報には、現在の分類器で扱える候補はありません。
                      </div>
                    )}
                  </div>
                  <Button asChild className="min-h-[44px] w-full">
                    <Link href={selectedItem.action_href}>{selectedItem.action_label}</Link>
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <Clock className="size-5" aria-hidden="true" />
                  受信情報を選択すると、ここに処理概要を表示します。
                </div>
              )}
            </aside>
          </>
        )}
      </PageSection>

      <PageSection
        title="シグナル候補"
        description="受信本文から抽出した確認候補です。本文・薬剤名・数量値は表示せず、分類結果だけを扱います。"
        tone="subtle"
      >
        {isErrorSignals ? (
          <ErrorState
            variant="server"
            title="シグナル候補を表示できません"
            cause="受信情報の分類候補を取得できませんでした。"
            nextAction="受信キューの内容は維持されています。分類候補だけ再取得してください。"
            onRetry={() => void refetchSignals()}
            headingLevel={3}
          />
        ) : isLoadingSignals && !signalCandidates ? (
          <div
            role="status"
            aria-label="受信シグナル候補を読み込み中"
            aria-live="polite"
            className="rounded-lg border border-dashed border-border bg-card px-5 py-5"
          >
            <SkeletonRows rows={2} cols={3} status={false} />
          </div>
        ) : signalCandidates && signalCandidates.items.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SummaryTile
                icon={RadioTower}
                label="候補"
                value={signalCandidates.summary.signal_count}
                caption="visible window"
              />
              <SummaryTile
                icon={TriangleAlert}
                label="至急"
                value={signalCandidates.summary.urgent_count}
                caption="緊急確認"
              />
              <SummaryTile
                icon={BellRing}
                label="残数・使用量"
                value={signalCandidates.summary.domain_counts.medication_stock}
                caption="薬剤師確認"
              />
              <SummaryTile
                icon={Clock}
                label="日程"
                value={signalCandidates.summary.domain_counts.schedule}
                caption="訪問調整"
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {signalCandidates.items.slice(0, 6).map((item) => (
                <div
                  key={item.candidate_key}
                  className="rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {signalDomainLabel[item.signal.domain] ?? item.signal.domain}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {signalTypeLabel[item.signal.type] ?? item.signal.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.occurred_at)} /{' '}
                        {channelLabel[item.channel] ?? item.channel}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const reviewBadge = signalReviewStatusBadge(item.signal.review_status);
                        return <StateBadge role={reviewBadge.role}>{reviewBadge.label}</StateBadge>;
                      })()}
                      {(() => {
                        const actionBadge = signalActionStatusBadge(item.signal.action_status);
                        return <StateBadge role={actionBadge.role}>{actionBadge.label}</StateBadge>;
                      })()}
                      {item.signal.has_quantity ? (
                        <StateBadge role="info">単位 {item.signal.unit ?? '未特定'}</StateBadge>
                      ) : null}
                      {item.signal.stock_review?.review_priority ? (
                        <StateBadge
                          role={
                            item.signal.stock_review.review_priority === 'high'
                              ? 'hazard'
                              : 'confirm'
                          }
                        >
                          {stockReviewPriorityLabel[item.signal.stock_review.review_priority]}
                        </StateBadge>
                      ) : null}
                      {!item.patient_linked ? (
                        <StateBadge role="hazard">患者未紐づけ</StateBadge>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={RadioTower}
            title="シグナル候補はありません"
            description="現在の条件で分類候補はありません。本文がない、または候補語に該当しない受信情報はここに表示しません。"
            headingLevel={3}
          />
        )}
      </PageSection>
    </div>
  );
}
