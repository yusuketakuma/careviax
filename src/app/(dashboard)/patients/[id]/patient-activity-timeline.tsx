'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
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

type TimelineEvent = {
  id: string;
  event_type:
    | 'visit_schedule'
    | 'visit_record'
    | 'prescription_intake'
    | 'dispense_result'
    | 'inquiry'
    | 'care_report'
    | 'delivery_record'
    | 'management_plan'
    | 'first_visit_document'
    | 'conference_note'
    | 'billing_candidate'
    | 'operation_history'
    | 'self_report'
    | 'communication'
    | 'external_share';
  category: 'visit' | 'prescription' | 'billing' | 'document' | 'communication';
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
  subject: string;
  category: string;
  relation: string | null;
  status: string;
  reported_by_name: string;
  requested_callback: boolean;
  preferred_contact_time: string | null;
  created_at: string;
  content?: string | null;
};

type TimelineCategory = 'all' | TimelineEvent['category'];
type HomeOperationFocus = 'documents' | 'mcs' | 'prescription' | 'billing' | 'conference';

type TimelineGroup = {
  key: string;
  label: string;
  items: TimelineEvent[];
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
};

const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済み',
  converted_to_task: 'タスク化済み',
  resolved: '解決済み',
  dismissed: '対応不要',
};

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

function previewText(value: string | null | undefined, maxLength = 96) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function workflowHaystack(event: TimelineEvent) {
  return [event.title, event.summary, event.status_label, ...event.metadata]
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

function matchesQuery(event: TimelineEvent, query: string) {
  if (!query) return true;
  const workflowFocus = getHomeOperationFocus(event);

  const haystack = [
    event.title,
    event.summary,
    event.status_label,
    event.actor_name,
    EVENT_META[event.event_type].label,
    CATEGORY_META[event.category].label,
    workflowFocus ? HOME_OPERATION_FOCUS_META[workflowFocus].label : null,
    workflowFocus ? HOME_OPERATION_FOCUS_META[workflowFocus].summaryLabel : null,
    ...event.metadata,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
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

function TimelineEntry({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const meta = EVENT_META[event.event_type];
  const workflowFocus = getHomeOperationFocus(event);
  const Icon = meta.icon;

  return (
    <li className="px-4 py-4">
      <div className="flex gap-3">
        <div className="hidden w-10 flex-col items-center sm:flex">
          <div
            className={cn(
              'flex size-8 items-center justify-center rounded-full border',
              meta.className,
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </div>
          {!isLast ? <div className="mt-2 w-px flex-1 bg-border/70" /> : null}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {formatOccurredAt(event.occurred_at)}
                {event.actor_name ? ` ・ ${event.actor_name}` : ''}
              </p>

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
                {event.summary ? (
                  <p className="text-sm leading-6 text-muted-foreground">{event.summary}</p>
                ) : null}
              </div>
            </div>

            <Button asChild variant="ghost" size="sm">
              <Link href={event.href}>
                {event.action_label}
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          {event.metadata.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {event.metadata.map((item) => (
                <span
                  key={`${event.id}-${item}`}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PatientActivityTimeline({
  timelineEvents,
  selfReports,
}: {
  timelineEvents: TimelineEvent[];
  selfReports: SelfReport[];
}) {
  const [category, setCategory] = useState<TimelineCategory>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredEvents = timelineEvents.filter((event) => {
    if (category !== 'all' && event.category !== category) {
      return false;
    }

    return matchesQuery(event, deferredQuery);
  });

  const timelineGroups = buildGroups(filteredEvents);
  const isFiltered = category !== 'all' || Boolean(deferredQuery);
  const categoryCounts = {
    all: timelineEvents.length,
    visit: timelineEvents.filter((event) => event.category === 'visit').length,
    prescription: timelineEvents.filter((event) => event.category === 'prescription').length,
    billing: timelineEvents.filter((event) => event.category === 'billing').length,
    document: timelineEvents.filter((event) => event.category === 'document').length,
    communication: timelineEvents.filter((event) => event.category === 'communication').length,
  } satisfies Record<TimelineCategory, number>;
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

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_340px]">
      <Card className="border border-border/70">
        <CardHeader className="space-y-4 border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="font-heading text-base leading-snug font-medium">
                患者アクションタイムライン
              </h2>
              <CardDescription>
                訪問、処方、調剤、文書、共有連絡など、薬局側の患者対応を最新順で追えます。
              </CardDescription>
            </div>
            <Badge variant="outline">
              {isFiltered
                ? `表示 ${filteredEvents.length} / 全 ${timelineEvents.length} 件`
                : `最新 ${timelineEvents.length} 件`}
            </Badge>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="patient-activity-search" className="text-xs">
                タイムライン検索
              </Label>
              <Input
                id="patient-activity-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例: MCS、契約、処方せん、集金、カンファレンス"
              />
            </div>

            <div className="flex flex-wrap gap-2" aria-label="タイムライン種別フィルタ">
              {(Object.keys(CATEGORY_META) as TimelineCategory[]).map((key) => {
                const meta = CATEGORY_META[key];
                const isActive = category === key;

                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setCategory(key)}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm transition-colors',
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
            className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              直近のアクティビティを表示しています（全履歴ではありません）。各情報源の最近の記録をまとめた抜粋です。
            </span>
          </p>
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
                className="overflow-hidden rounded-2xl border border-border/70 bg-background"
              >
                <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-4 py-3">
                  <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">{group.items.length}件</span>
                </div>
                <ol className="divide-y divide-border/70">
                  {group.items.map((event, index) => (
                    <TimelineEntry
                      key={event.id}
                      event={event}
                      isLast={index === group.items.length - 1}
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
            <h2 className="font-heading text-base leading-snug font-medium">履歴サマリー</h2>
            <CardDescription>
              最新アクションと種別別の件数を患者別に集約しています。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['visit', 'prescription', 'billing', 'document', 'communication'] as const).map(
                (key) => (
                  <div key={key} className="rounded-xl border border-border/70 bg-muted/10 p-3">
                    <p className="text-xs text-muted-foreground">{CATEGORY_META[key].label}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">
                      {categoryCounts[key]}
                    </p>
                  </div>
                ),
              )}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
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
              <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
                <p className="text-xs font-medium text-muted-foreground">最新アクション</p>
                <p className="mt-2 text-sm font-medium text-foreground">{latestEvent.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatOccurredAtLong(latestEvent.occurred_at)}
                  {latestEvent.actor_name ? ` ・ ${latestEvent.actor_name}` : ''}
                </p>
                {latestEvent.summary ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {latestEvent.summary}
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
                <div key={item.id} className="rounded-xl border border-border/70 bg-muted/10 p-3">
                  <p className="text-sm font-medium text-foreground">{item.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.reported_by_name}
                    {item.relation ? ` (${item.relation})` : ''}
                    {' / '}
                    {item.category}
                    {' / '}
                    {SELF_REPORT_STATUS_LABELS[item.status] ?? item.status}
                  </p>
                  {item.content ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {previewText(item.content)}
                    </p>
                  ) : null}
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
