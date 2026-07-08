'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Info,
  MessageSquareWarning,
  Package,
  Phone,
  Pill,
  Share2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type {
  PatientMovementCategory,
  PatientMovementEventType,
} from '@/types/patient-movement-timeline';

type TimelineEvent = {
  id: string;
  event_type: PatientMovementEventType;
  category: PatientMovementCategory;
  occurred_at: string;
  title: string;
  summary: string | null;
  href: string;
  action_label: string;
  status: string | null;
  status_label: string | null;
  actor_name: string | null;
  metadata: string[];
};

type SelfReport = {
  id: string;
  category: string;
  relation: string | null;
  status: string;
  requested_callback: boolean;
  preferred_contact_time: string | null;
  created_at: string;
  content?: string | null;
};

type TimelineCategory = 'all' | TimelineEvent['category'];
type TimelineDateScope = 'all' | 'today' | 'yesterday' | '7d' | '30d';
type TimelineFocusFilter =
  | 'all'
  | 'unprocessed'
  | 'review_required'
  | 'medication_stock'
  | 'safety'
  | 'today';
type HomeOperationFocus = 'documents' | 'mcs' | 'prescription' | 'billing' | 'conference';

type TimelineGroup = {
  key: string;
  label: string;
  items: TimelineEvent[];
};

export type PatientMovementTimelineProps = {
  timelineEvents: TimelineEvent[];
  selfReports: SelfReport[];
  isPartial?: boolean;
  fullLimit?: number;
  isLoadingFull?: boolean;
  partialFailures?: { source: string; message: string }[];
  onLoadFull?: () => void;
};

// 種別・系列軸の色は状態色ではない（design-language L180）。
// 系列には globals.css の --chart-1..5（Tailwind の bg-/text-/border-chart-N）を使い、
// 個別の bg-sky-50 等の state 色ベタ書きは使わない（L170）。色は単独の signal にせず
// アイコン + ラベルと併用する。tint は STATUS_TOKENS と同じ /15・/25 の不透明度修飾で揃える。
type ChartSeries = 1 | 2 | 3 | 4 | 5;

const CHART_SERIES_CHIP: Record<ChartSeries, string> = {
  1: 'border-chart-1/25 bg-chart-1/15 text-foreground',
  2: 'border-chart-2/25 bg-chart-2/15 text-foreground',
  3: 'border-chart-3/25 bg-chart-3/15 text-foreground',
  4: 'border-chart-4/25 bg-chart-4/15 text-foreground',
  5: 'border-chart-5/25 bg-chart-5/15 text-foreground',
};

const CHART_SERIES_COUNT: Record<ChartSeries, string> = {
  1: 'bg-chart-1/25 text-foreground',
  2: 'bg-chart-2/25 text-foreground',
  3: 'bg-chart-3/25 text-foreground',
  4: 'bg-chart-4/25 text-foreground',
  5: 'bg-chart-5/25 text-foreground',
};

const CATEGORY_META: Record<
  TimelineCategory,
  { label: string; className: string; countClassName: string }
> = {
  all: {
    label: 'すべて',
    className: 'border-border/80 bg-background text-foreground',
    countClassName: 'bg-muted text-muted-foreground',
  },
  visit: {
    label: '訪問',
    className: CHART_SERIES_CHIP[1],
    countClassName: CHART_SERIES_COUNT[1],
  },
  prescription: {
    label: '処方・調剤',
    className: CHART_SERIES_CHIP[2],
    countClassName: CHART_SERIES_COUNT[2],
  },
  billing: {
    label: '請求・集金',
    className: CHART_SERIES_CHIP[5],
    countClassName: CHART_SERIES_COUNT[5],
  },
  document: {
    label: '文書',
    className: CHART_SERIES_CHIP[3],
    countClassName: CHART_SERIES_COUNT[3],
  },
  communication: {
    label: '共有・連絡',
    className: CHART_SERIES_CHIP[4],
    countClassName: CHART_SERIES_COUNT[4],
  },
  medication_stock: {
    label: '残数・薬剤',
    className: CHART_SERIES_CHIP[2],
    countClassName: CHART_SERIES_COUNT[2],
  },
  interprofessional: {
    label: '他職種受信',
    className: CHART_SERIES_CHIP[4],
    countClassName: CHART_SERIES_COUNT[4],
  },
  task: {
    label: 'タスク',
    className: CHART_SERIES_CHIP[1],
    countClassName: CHART_SERIES_COUNT[1],
  },
  safety: {
    label: '安全',
    className: CHART_SERIES_CHIP[5],
    countClassName: CHART_SERIES_COUNT[5],
  },
  system: {
    label: 'システム',
    className: CHART_SERIES_CHIP[3],
    countClassName: CHART_SERIES_COUNT[3],
  },
};

const HOME_OPERATION_FOCUS_META: Record<
  HomeOperationFocus,
  { label: string; className: string; summaryLabel: string }
> = {
  documents: {
    label: '契約・同意',
    className: CHART_SERIES_CHIP[3],
    summaryLabel: '契約・同意・書類',
  },
  mcs: {
    label: 'MCS',
    className: CHART_SERIES_CHIP[4],
    summaryLabel: 'MCS・外部連携',
  },
  prescription: {
    label: '処方せん',
    className: CHART_SERIES_CHIP[2],
    summaryLabel: '処方せん管理',
  },
  billing: {
    label: '請求・集金',
    className: CHART_SERIES_CHIP[5],
    summaryLabel: '請求・集金管理',
  },
  conference: {
    label: 'カンファレンス',
    className: CHART_SERIES_CHIP[1],
    summaryLabel: 'カンファレンス',
  },
};

const EVENT_META: Record<
  TimelineEvent['event_type'],
  { label: string; icon: typeof Activity; className: string }
> = {
  visit_event: {
    label: '訪問',
    icon: CalendarDays,
    className: CHART_SERIES_CHIP[1],
  },
  visit_schedule: {
    label: '訪問予定',
    icon: CalendarDays,
    className: CHART_SERIES_CHIP[1],
  },
  visit_record: {
    label: '訪問記録',
    icon: ClipboardList,
    className: CHART_SERIES_CHIP[1],
  },
  prescription_event: {
    label: '処方',
    icon: Pill,
    className: CHART_SERIES_CHIP[2],
  },
  prescription_intake: {
    label: '処方受付',
    icon: Pill,
    className: CHART_SERIES_CHIP[2],
  },
  dispense_result: {
    label: '調剤',
    icon: Package,
    className: CHART_SERIES_CHIP[2],
  },
  inquiry: {
    label: '疑義照会',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[2],
  },
  care_report: {
    label: '報告書',
    icon: FileText,
    className: CHART_SERIES_CHIP[3],
  },
  delivery_record: {
    label: '送付',
    icon: ArrowUpRight,
    className: CHART_SERIES_CHIP[3],
  },
  document_registered: {
    label: '文書登録',
    icon: FileText,
    className: CHART_SERIES_CHIP[3],
  },
  management_plan: {
    label: '計画書',
    icon: FileText,
    className: CHART_SERIES_CHIP[3],
  },
  first_visit_document: {
    label: '初回文書',
    icon: FileText,
    className: CHART_SERIES_CHIP[3],
  },
  conference_note: {
    label: '会議',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[1],
  },
  billing_candidate: {
    label: '算定',
    icon: CircleDollarSign,
    className: CHART_SERIES_CHIP[3],
  },
  operation_history: {
    label: '変更履歴',
    icon: Activity,
    className: CHART_SERIES_CHIP[3],
  },
  self_report: {
    label: '自己申告',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[4],
  },
  communication: {
    label: '連絡',
    icon: Phone,
    className: CHART_SERIES_CHIP[5],
  },
  external_share: {
    label: '外部共有',
    icon: Share2,
    className: CHART_SERIES_CHIP[5],
  },
  inbound_communication: {
    label: '他職種受信',
    icon: Phone,
    className: CHART_SERIES_CHIP[4],
  },
  inbound_mcs: {
    label: 'MCS受信',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[4],
  },
  inbound_phone: {
    label: '電話受信',
    icon: Phone,
    className: CHART_SERIES_CHIP[4],
  },
  inbound_fax: {
    label: 'FAX受信',
    icon: FileText,
    className: CHART_SERIES_CHIP[4],
  },
  inbound_email: {
    label: 'メール受信',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[4],
  },
  inbound_medication_stock_signal: {
    label: '残数報告',
    icon: Pill,
    className: CHART_SERIES_CHIP[2],
  },
  medication_stock_event: {
    label: '残数管理',
    icon: Package,
    className: CHART_SERIES_CHIP[2],
  },
  medication_stock_snapshot: {
    label: '残数更新',
    icon: Package,
    className: CHART_SERIES_CHIP[2],
  },
  medication_equivalence_review: {
    label: '名寄せ確認',
    icon: Pill,
    className: CHART_SERIES_CHIP[2],
  },
  interprofessional_note: {
    label: '他職種メモ',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[4],
  },
  care_team_update: {
    label: 'ケアチーム',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[4],
  },
  safety_signal: {
    label: '安全',
    icon: MessageSquareWarning,
    className: CHART_SERIES_CHIP[5],
  },
  task_created: {
    label: 'タスク作成',
    icon: ClipboardList,
    className: CHART_SERIES_CHIP[1],
  },
  task_resolved: {
    label: 'タスク完了',
    icon: CheckCircle2,
    className: CHART_SERIES_CHIP[1],
  },
  support_session: {
    label: 'サポート',
    icon: Activity,
    className: CHART_SERIES_CHIP[3],
  },
};

const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済み',
  converted_to_task: 'タスク化済み',
  resolved: '解決済み',
  dismissed: '対応不要',
};

const DATE_SCOPE_LABELS: Record<TimelineDateScope, string> = {
  all: 'すべて',
  today: '今日',
  yesterday: '昨日',
  '7d': '7日',
  '30d': '30日',
};

const FOCUS_FILTER_LABELS: Record<TimelineFocusFilter, string> = {
  all: '読込済み',
  unprocessed: '未処理',
  review_required: '薬剤師確認待ち',
  medication_stock: '残数関連',
  safety: '安全関連',
  today: '今日の動き',
};

function getSafeTimelineHref(href: string) {
  const trimmed = href.trim();
  const lowerHref = trimmed.toLowerCase();

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (
    lowerHref === '/api' ||
    lowerHref.startsWith('/api/') ||
    lowerHref.startsWith('/api?') ||
    lowerHref.startsWith('/api#')
  ) {
    return null;
  }
  if (/^\/patients\/[^/?#]+\/timeline(?:[/?#]|$)/i.test(trimmed)) return null;
  return trimmed;
}

function formatGroupLabel(value: string) {
  const date = new Date(value);

  if (isToday(date)) return '今日';
  if (isYesterday(date)) return '昨日';
  return format(date, 'yyyy年M月d日', { locale: ja });
}

function formatOccurredAt(value: string) {
  return format(new Date(value), 'HH:mm', { locale: ja });
}

function formatOccurredAtLong(value: string) {
  return format(new Date(value), 'yyyy/MM/dd HH:mm', { locale: ja });
}

function workflowHaystack(event: TimelineEvent) {
  const metadata = isOccurrenceOnlyCategory(event) ? [] : event.metadata;
  return [event.title, safeEventSummary(event), event.status_label, ...metadata]
    .filter(Boolean)
    .join(' ');
}

function getHomeOperationFocus(event: TimelineEvent): HomeOperationFocus | null {
  const haystack = workflowHaystack(event);
  if (haystack.includes('MCS')) return 'mcs';
  if (event.event_type === 'conference_note' || haystack.includes('カンファレンス')) {
    return 'conference';
  }
  if (event.category === 'billing') return 'billing';
  if (event.category === 'prescription') return 'prescription';
  if (event.category === 'document') return 'documents';
  return null;
}

function isOccurrenceOnlyCategory(event: TimelineEvent) {
  return (
    event.category === 'prescription' || event.category === 'visit' || event.category === 'document'
  );
}

function safeEventSummary(event: TimelineEvent) {
  if (event.category === 'prescription') {
    return '処方登録または処方変更がありました。内容は処方詳細で確認してください。';
  }
  if (event.category === 'visit') {
    return '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。';
  }
  if (event.category === 'document') {
    return '文書登録または文書状態の更新がありました。本文は詳細画面で確認してください。';
  }
  return event.summary;
}

function isUnprocessedEvent(event: TimelineEvent) {
  const stateText = [event.status, event.status_label, event.title].filter(Boolean).join(' ');
  if (event.category === 'safety') return true;
  if (stateText.includes('未処理') || stateText.includes('未対応')) return true;
  if (stateText.includes('確認待ち') || stateText.includes('要確認')) return true;
  return (
    event.category === 'interprofessional' &&
    !['resolved', 'completed', 'done', 'closed', 'cancelled'].includes(event.status ?? '')
  );
}

function isReviewRequiredEvent(event: TimelineEvent) {
  return [event.status, event.status_label, event.title].filter(Boolean).join(' ').includes('確認');
}

function matchesDateScope(event: TimelineEvent, dateScope: TimelineDateScope) {
  if (dateScope === 'all') return true;

  const eventDate = new Date(event.occurred_at);
  if (dateScope === 'today') return isToday(eventDate);
  if (dateScope === 'yesterday') return isYesterday(eventDate);

  const now = new Date();
  const days = dateScope === '7d' ? 7 : 30;
  const start = new Date(now);
  start.setDate(now.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return eventDate >= start && eventDate <= now;
}

function matchesFocusFilter(event: TimelineEvent, focusFilter: TimelineFocusFilter) {
  if (focusFilter === 'all') return true;
  if (focusFilter === 'unprocessed') return isUnprocessedEvent(event);
  if (focusFilter === 'review_required') return isReviewRequiredEvent(event);
  if (focusFilter === 'medication_stock') return event.category === 'medication_stock';
  if (focusFilter === 'safety') return event.category === 'safety';
  if (focusFilter === 'today') return isToday(new Date(event.occurred_at));
  return true;
}

function matchesQuery(event: TimelineEvent, query: string) {
  if (!query) return true;
  const workflowFocus = getHomeOperationFocus(event);

  const haystack = [
    event.title,
    safeEventSummary(event),
    event.status_label,
    event.actor_name,
    EVENT_META[event.event_type].label,
    CATEGORY_META[event.category].label,
    workflowFocus ? HOME_OPERATION_FOCUS_META[workflowFocus].label : null,
    workflowFocus ? HOME_OPERATION_FOCUS_META[workflowFocus].summaryLabel : null,
    ...(isOccurrenceOnlyCategory(event) ? [] : event.metadata),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function summarizeDay(events: TimelineEvent[]) {
  return {
    visit: events.filter((event) => event.category === 'visit').length,
    prescription: events.filter((event) => event.category === 'prescription').length,
    interprofessional: events.filter((event) => event.category === 'interprofessional').length,
    medicationStock: events.filter((event) => event.category === 'medication_stock').length,
    document: events.filter((event) => event.category === 'document').length,
    task: events.filter((event) => event.category === 'task').length,
    safety: events.filter((event) => event.category === 'safety').length,
    unprocessed: events.filter(isUnprocessedEvent).length,
  };
}

function buildGroups(events: TimelineEvent[]) {
  const groups: TimelineGroup[] = [];

  for (const event of events) {
    const key = format(new Date(event.occurred_at), 'yyyy-MM-dd');
    const lastGroup = groups[groups.length - 1];

    if (!lastGroup || lastGroup.key !== key) {
      groups.push({
        key,
        label: formatGroupLabel(event.occurred_at),
        items: [event],
      });
      continue;
    }

    lastGroup.items.push(event);
  }

  return groups;
}

function DaySummary({ events }: { events: TimelineEvent[] }) {
  const summary = summarizeDay(events);
  const items = [
    ['訪問', summary.visit],
    ['処方・調剤', summary.prescription],
    ['他職種受信', summary.interprofessional],
    ['残数', summary.medicationStock],
    ['文書', summary.document],
    ['タスク', summary.task],
    ['安全', summary.safety],
  ].filter((item): item is [string, number] => Number(item[1]) > 0);

  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="この日の内訳">
      {items.length > 0 ? (
        items.map(([label, count]) => (
          <span
            key={String(label)}
            className="rounded-md border border-border/60 bg-background px-2 py-1"
          >
            {label} {count}件
          </span>
        ))
      ) : (
        <span>この日の表示対象イベントはありません。</span>
      )}
      {summary.unprocessed > 0 ? (
        <span className="rounded-md border border-state-confirm/30 bg-state-confirm/10 px-2 py-1 text-state-confirm">
          未処理 {summary.unprocessed}件
        </span>
      ) : null}
    </div>
  );
}

function TimelineDetailAction({
  event,
  className,
  size,
  selected = false,
}: {
  event: TimelineEvent;
  className?: string;
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
  selected?: boolean;
}) {
  const safeHref = getSafeTimelineHref(event.href);

  if (!safeHref) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size ?? undefined}
        className={cn('min-h-11', className)}
        disabled
        aria-label={`${event.title}の詳細導線を確認できません`}
      >
        詳細導線未設定
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      size={size ?? undefined}
      className={cn('min-h-11', selected ? 'justify-between' : null, className)}
    >
      <Link
        href={safeHref}
        aria-label={selected ? `選択中イベントの詳細を開く: ${event.action_label}` : undefined}
      >
        {event.action_label}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </Button>
  );
}

function SelectedEventPreview({ event }: { event: TimelineEvent }) {
  const meta = EVENT_META[event.event_type];
  const workflowFocus = getHomeOperationFocus(event);
  const Icon = meta.icon;
  const summary = safeEventSummary(event);
  const metadata = isOccurrenceOnlyCategory(event) ? [] : event.metadata.slice(0, 4);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border bg-background',
            meta.className,
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={meta.className}>
              {meta.label}
            </Badge>
            <Badge variant="outline" className={CATEGORY_META[event.category].className}>
              {CATEGORY_META[event.category].label}
            </Badge>
            {workflowFocus ? (
              <Badge
                variant="outline"
                className={HOME_OPERATION_FOCUS_META[workflowFocus].className}
              >
                {HOME_OPERATION_FOCUS_META[workflowFocus].label}
              </Badge>
            ) : null}
          </div>
          <h3 className="text-sm font-semibold leading-6 text-foreground">{event.title}</h3>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatOccurredAtLong(event.occurred_at)}
          </p>
        </div>
      </div>

      {summary ? <p className="text-sm leading-6 text-muted-foreground">{summary}</p> : null}

      <dl className="grid gap-2 text-sm">
        {event.actor_name ? (
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">担当</dt>
            <dd className="min-w-0 text-foreground">{event.actor_name}</dd>
          </div>
        ) : null}
        {event.status_label ? (
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
            <dt className="text-muted-foreground">状態</dt>
            <dd className="min-w-0 text-foreground">{event.status_label}</dd>
          </div>
        ) : null}
      </dl>

      {metadata.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {metadata.map((item) => (
            <span
              key={`${event.id}-preview-${item}`}
              className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <TimelineDetailAction event={event} className="w-full" selected />
    </div>
  );
}

function TimelineEntry({
  event,
  isLast,
  isSelected,
  onPreview,
}: {
  event: TimelineEvent;
  isLast: boolean;
  isSelected: boolean;
  onPreview: (eventId: string) => void;
}) {
  const meta = EVENT_META[event.event_type];
  const workflowFocus = getHomeOperationFocus(event);
  const Icon = meta.icon;
  const summary = safeEventSummary(event);
  const metadata = isOccurrenceOnlyCategory(event) ? [] : event.metadata;

  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="grid gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
        <time
          dateTime={event.occurred_at}
          className="pt-1 text-sm font-medium tabular-nums text-foreground sm:text-right"
        >
          {formatOccurredAt(event.occurred_at)}
        </time>

        <div className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex size-8 items-center justify-center rounded-full border bg-background',
                meta.className,
              )}
              aria-hidden="true"
            >
              <Icon className="size-4" />
            </div>
            {!isLast ? <div className="mt-2 w-px flex-1 bg-border/70" /> : null}
          </div>

          <article
            className={cn(
              'min-w-0 rounded-lg border bg-card px-3 py-3',
              isSelected ? 'border-primary/50 ring-2 ring-primary/15' : 'border-border/70',
            )}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={meta.className}>
                    {meta.label}
                  </Badge>
                  {workflowFocus ? (
                    <Badge
                      variant="outline"
                      className={HOME_OPERATION_FOCUS_META[workflowFocus].className}
                    >
                      {HOME_OPERATION_FOCUS_META[workflowFocus].label}
                    </Badge>
                  ) : null}
                  {event.status_label ? (
                    <Badge variant="secondary">{event.status_label}</Badge>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-foreground">{event.title}</h3>
                  {summary ? (
                    <p className="text-sm leading-6 text-muted-foreground">{summary}</p>
                  ) : null}
                  {event.actor_name ? (
                    <p className="text-xs text-muted-foreground">{event.actor_name}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  aria-label={`${event.title}の概要を表示`}
                  aria-pressed={isSelected}
                  onClick={() => onPreview(event.id)}
                >
                  概要
                </Button>
                <TimelineDetailAction event={event} size="sm" />
              </div>
            </div>

            {metadata.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {metadata.map((item) => (
                  <span
                    key={`${event.id}-${item}`}
                    className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </div>
    </li>
  );
}

export function PatientMovementTimeline({
  timelineEvents,
  selfReports,
  isPartial = false,
  fullLimit = 40,
  isLoadingFull = false,
  partialFailures = [],
  onLoadFull,
}: PatientMovementTimelineProps) {
  const [category, setCategory] = useState<TimelineCategory>('all');
  const [dateScope, setDateScope] = useState<TimelineDateScope>('all');
  const [focusFilter, setFocusFilter] = useState<TimelineFocusFilter>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    timelineEvents[0]?.id ?? null,
  );
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredEvents = timelineEvents.filter((event) => {
    if (category !== 'all' && event.category !== category) {
      return false;
    }
    if (!matchesDateScope(event, dateScope)) {
      return false;
    }
    if (!matchesFocusFilter(event, focusFilter)) {
      return false;
    }

    return matchesQuery(event, deferredQuery);
  });

  const timelineGroups = buildGroups(filteredEvents);
  const isFiltered =
    category !== 'all' || dateScope !== 'all' || focusFilter !== 'all' || Boolean(deferredQuery);
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ?? filteredEvents[0] ?? null;
  const categoryCounts = Object.fromEntries(
    (Object.keys(CATEGORY_META) as TimelineCategory[]).map((key) => [
      key,
      key === 'all'
        ? timelineEvents.length
        : timelineEvents.filter((event) => event.category === key).length,
    ]),
  ) as Record<TimelineCategory, number>;
  const homeOperationCounts = {
    documents: timelineEvents.filter((event) => getHomeOperationFocus(event) === 'documents')
      .length,
    mcs: timelineEvents.filter((event) => getHomeOperationFocus(event) === 'mcs').length,
    prescription: timelineEvents.filter((event) => getHomeOperationFocus(event) === 'prescription')
      .length,
    billing: timelineEvents.filter((event) => getHomeOperationFocus(event) === 'billing').length,
    conference: timelineEvents.filter((event) => getHomeOperationFocus(event) === 'conference')
      .length,
  } satisfies Record<HomeOperationFocus, number>;
  const latestEvent = filteredEvents[0] ?? null;
  const recentSelfReports = selfReports.slice(0, 3);
  const movementSummaryCards = [
    {
      key: 'inbound',
      label: '未処理の受信',
      value: timelineEvents.filter(
        (event) =>
          event.category === 'interprofessional' &&
          !['resolved', 'completed', 'done'].includes(event.status ?? ''),
      ).length,
      className: CHART_SERIES_CHIP[4],
    },
    {
      key: 'review',
      label: '薬剤師確認待ち',
      value: timelineEvents.filter((event) =>
        [event.status, event.status_label, event.title].filter(Boolean).join(' ').includes('確認'),
      ).length,
      className: CHART_SERIES_CHIP[5],
    },
    {
      key: 'rx_visit',
      label: '処方・訪問',
      value: categoryCounts.prescription + categoryCounts.visit,
      className: CHART_SERIES_CHIP[2],
    },
    {
      key: 'document',
      label: '文書登録',
      value: categoryCounts.document,
      className: CHART_SERIES_CHIP[3],
    },
  ];
  const focusFilterCounts: Record<TimelineFocusFilter, number> = {
    all: timelineEvents.length,
    unprocessed: timelineEvents.filter(isUnprocessedEvent).length,
    review_required: timelineEvents.filter(isReviewRequiredEvent).length,
    medication_stock: categoryCounts.medication_stock,
    safety: categoryCounts.safety,
    today: timelineEvents.filter((event) => isToday(new Date(event.occurred_at))).length,
  };
  const loadedCountBadge = isFiltered
    ? `読込済み ${timelineEvents.length} 件中 ${filteredEvents.length} 件表示`
    : isPartial
      ? `直近 ${timelineEvents.length} 件表示`
      : `読込済み ${timelineEvents.length} 件表示`;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_320px]">
      <Card className="border border-border/70">
        <CardHeader className="space-y-4 border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="font-heading text-base leading-snug font-medium">患者の動き</h2>
              <CardDescription>
                処方、訪問、文書登録、連絡の発生を時系列で確認し、詳細は正本画面で開きます。
              </CardDescription>
            </div>
            <Badge variant="outline">{loadedCountBadge}</Badge>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="患者の動きサマリー">
            {movementSummaryCards.map((item) => (
              <div key={item.key} className={cn('rounded-lg border px-3 py-2', item.className)}>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
                  {item.value}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">件</span>
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">日付範囲</Label>
              <div className="flex flex-wrap gap-2" aria-label="日付範囲フィルタ">
                {(Object.keys(DATE_SCOPE_LABELS) as TimelineDateScope[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={dateScope === key}
                    onClick={() => setDateScope(key)}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors',
                      dateScope === key
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {DATE_SCOPE_LABELS[key]}
                  </button>
                ))}
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-11 items-center rounded-full border border-border/50 bg-muted/30 px-3 text-sm text-muted-foreground"
                >
                  日付選択
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="patient-activity-search" className="text-xs">
                タイムライン検索
              </Label>
              <Input
                id="patient-activity-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例: MCS、電話、処方、訪問、文書登録、残数、確認待ち"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">確認フィルタ</Label>
              <div className="flex flex-wrap gap-2" aria-label="確認フィルタ">
                {(Object.keys(FOCUS_FILTER_LABELS) as TimelineFocusFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={`確認フィルタ: ${FOCUS_FILTER_LABELS[key]}`}
                    aria-pressed={focusFilter === key}
                    onClick={() => setFocusFilter(key)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors',
                      focusFilter === key
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    <span>{FOCUS_FILTER_LABELS[key]}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-xs',
                        focusFilter === key
                          ? 'bg-primary/15 text-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {focusFilterCounts[key]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2" aria-label="タイムライン種別フィルタ">
              {(Object.keys(CATEGORY_META) as TimelineCategory[]).map((key) => {
                const meta = CATEGORY_META[key];
                const isActive = category === key;

                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`種別: ${meta.label}`}
                    aria-pressed={isActive}
                    onClick={() => setCategory(key)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition-colors',
                      isActive
                        ? meta.className
                        : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    <span>{meta.label}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[11px]',
                        isActive ? meta.countClassName : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {categoryCounts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <p
            data-testid="timeline-completeness-note"
            className="flex flex-wrap items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {isPartial
                ? '直近5件の患者の動きを先に表示しています。追加履歴は必要な時だけ読み込みます。'
                : `患者の動きを最大${fullLimit}件まで読み込んでいます。検索と種別フィルタで絞り込めます。`}
            </span>
            {isPartial && onLoadFull ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 bg-background"
                disabled={isLoadingFull}
                onClick={onLoadFull}
              >
                {isLoadingFull
                  ? '履歴を追加読み込み中'
                  : `履歴を追加読み込み（最大${fullLimit}件）`}
              </Button>
            ) : null}
          </p>
          {partialFailures.length > 0 ? (
            <div
              role="status"
              className="rounded-lg border border-border/70 border-l-4 border-l-state-confirm bg-card px-3 py-2 text-xs leading-5 text-muted-foreground"
              data-testid="timeline-partial-failures"
            >
              <p className="font-medium text-state-confirm">
                一部の履歴ソースを取得できませんでした。
              </p>
              <ul className="mt-1 list-inside list-disc">
                {partialFailures.map((failure) => (
                  <li key={`${failure.source}:${failure.message}`}>
                    {failure.source}: {failure.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {timelineGroups.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="表示できるアクションがありません"
              description={
                deferredQuery
                  ? '検索条件かフィルタを緩めると、該当するアクションを表示できます。'
                  : '患者に対する薬局アクションが記録されると、ここに時系列で表示されます。'
              }
            />
          ) : (
            timelineGroups.map((group) => (
              <section
                key={group.key}
                data-testid={`movement-day-card-${group.key}`}
                aria-labelledby={`movement-day-heading-${group.key}`}
                className="overflow-hidden rounded-lg border border-border/70 bg-card"
              >
                <div className="grid gap-3 border-b border-border/70 bg-muted/20 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="space-y-1">
                    <h3
                      id={`movement-day-heading-${group.key}`}
                      className="flex items-center gap-2 text-sm font-semibold text-foreground"
                    >
                      <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                      {group.label}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      この日の表示中 {group.items.length}件
                    </p>
                  </div>
                  <DaySummary events={group.items} />
                </div>
                <ol>
                  {group.items.map((event, index) => (
                    <TimelineEntry
                      key={event.id}
                      event={event}
                      isLast={index === group.items.length - 1}
                      isSelected={selectedEvent?.id === event.id}
                      onPreview={setSelectedEventId}
                    />
                  ))}
                </ol>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border border-border/70">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">選択中のイベント</h2>
            <CardDescription>
              一覧では原文や処方・訪問・文書本文を出さず、正本画面で確認します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedEvent ? (
              <SelectedEventPreview event={selectedEvent} />
            ) : (
              <p className="text-sm text-muted-foreground">
                条件に合うイベントがありません。フィルタを緩めてください。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/70">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">タイムライン要約</h2>
            <CardDescription>
              発生したイベントの内訳と直近の確認先を集約しています。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  'visit',
                  'prescription',
                  'document',
                  'interprofessional',
                  'medication_stock',
                  'safety',
                ] as const
              ).map((key) => (
                <div key={key} className="rounded-md border border-border/70 bg-muted/10 p-3">
                  <p className="text-xs text-muted-foreground">{CATEGORY_META[key].label}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {categoryCounts[key]}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-border/70 bg-muted/10 p-3">
              <p className="text-xs font-medium text-muted-foreground">在宅運用履歴</p>
              <div className="mt-3 grid gap-2">
                {(['documents', 'mcs', 'prescription', 'billing', 'conference'] as const).map(
                  (key) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 text-muted-foreground">
                        {HOME_OPERATION_FOCUS_META[key].summaryLabel}
                      </span>
                      <span className="font-medium text-foreground">
                        {homeOperationCounts[key]}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>

            {latestEvent ? (
              <div className="rounded-md border border-border/70 bg-muted/10 p-4">
                <p className="text-xs font-medium text-muted-foreground">最新アクション</p>
                <p className="mt-2 text-sm font-medium text-foreground">{latestEvent.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatOccurredAtLong(latestEvent.occurred_at)}
                  {latestEvent.actor_name ? ` ・ ${latestEvent.actor_name}` : ''}
                </p>
                {safeEventSummary(latestEvent) ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {safeEventSummary(latestEvent)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border border-border/70">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">患者からの更新</h2>
            <CardDescription>
              自己申告など患者起点の更新を補助情報として並べています。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentSelfReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">患者起点の更新はありません。</p>
            ) : (
              recentSelfReports.map((item) => (
                <div key={item.id} className="rounded-md border border-border/70 bg-muted/10 p-3">
                  <p className="text-sm font-medium text-foreground">自己申告あり</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.category}
                    {item.relation ? ` / 関係 ${item.relation}` : ''}
                    {' / '}
                    {SELF_REPORT_STATUS_LABELS[item.status] ?? item.status}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {item.requested_callback ? <span>折返し希望</span> : null}
                    {item.preferred_contact_time ? (
                      <span>希望時間 {item.preferred_contact_time}</span>
                    ) : null}
                    <span>{formatOccurredAtLong(item.created_at)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
