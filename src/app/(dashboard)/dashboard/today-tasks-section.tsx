'use client';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Layers,
  ListChecks,
  MapPin,
  Package,
  Pill,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { HelpPopover } from '@/components/ui/help-popover';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { ActionItemRow, fetchActions } from './actions-section';
import type {
  ActionItem,
  PipelineStep,
  QueuePriority,
} from '@/types/dashboard-home';
import {
  DASHBOARD_TASK_TABS,
  DASHBOARD_TAB_FALLBACK_ACTIONS,
  DASHBOARD_TASK_TYPE_TO_TAB,
  type DashboardTaskTabKey,
} from '@/lib/dashboard/home-config';
import {
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import { fetchVisitSchedulesWindow } from '@/app/(dashboard)/schedules/visit-schedule-fetch.helpers';
import { type DashboardFocusRole } from './dashboard-role-focus';

// ---------------------------------------------------------------------------
// Tab categories — maps to PIPELINE_STEPS keys in the actions API
// ---------------------------------------------------------------------------

const TAB_ICONS = {
  all: Layers,
  intake: ListChecks,
  dispensing: Pill,
  dispense_audit: ShieldCheck,
  medication_set: Package,
  set_audit: ClipboardCheck,
  visit_planning: CalendarDays,
  visit: MapPin,
  reporting: FileText,
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchTodayVisits(
  orgId: string,
  today: string
): Promise<VisitSchedule[]> {
  return fetchVisitSchedulesWindow<VisitSchedule>({
    orgId,
    dateFrom: today,
    dateTo: today,
    statusScope: 'active',
  });
}

function visitToActionItem(schedule: VisitSchedule): ActionItem {
  const visitLabel =
    VISIT_TYPE_LABELS[schedule.visit_type] ?? schedule.visit_type;
  return {
    id: schedule.id,
    item_type: 'visit',
    task_type: 'visit_schedule',
    queue_label: visitLabel,
    title: `${schedule.case_.patient.name} ${visitLabel}`,
    summary: '',
    priority: (schedule.priority === 'emergency' ? 'urgent' : schedule.priority) as QueuePriority,
    due_at: schedule.scheduled_date,
    action_href: `/visits/${schedule.id}/record`,
    action_label: '訪問記録',
    owner_name: null,
    patient_name: schedule.case_.patient.name,
    badges: [],
  };
}

// ---------------------------------------------------------------------------
// Helper: compute tab badge count from pipeline data
// ---------------------------------------------------------------------------

function getTabCount(
  tab: (typeof DASHBOARD_TASK_TABS)[number],
  pipeline: PipelineStep[],
  todayVisitCount: number
): number {
  if (tab.key === 'all') {
    return (
      pipeline.reduce((s, p) => s + p.count, 0) + todayVisitCount
    );
  }
  if (tab.key === 'visit') {
    const pipelineCount = tab.pipelineKeys
      ? tab.pipelineKeys.reduce(
          (s, k) => s + (pipeline.find((p) => p.key === k)?.count ?? 0),
          0
        )
      : 0;
    return pipelineCount + todayVisitCount;
  }
  if (tab.pipelineKeys) {
    return tab.pipelineKeys.reduce(
      (s, k) => s + (pipeline.find((p) => p.key === k)?.count ?? 0),
      0
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Helper: filter items by selected tab
// ---------------------------------------------------------------------------

function filterByTab(
  items: ActionItem[],
  tab: DashboardTaskTabKey
): ActionItem[] {
  if (tab === 'all') return items;
  return items.filter((item) => {
    if (item.task_type) {
      return (DASHBOARD_TASK_TYPE_TO_TAB[item.task_type] ?? null) === tab;
    }
    // fallback: route by item_type when task_type is null (e.g. communication queue)
    if (item.item_type === 'self_report') return tab === 'reporting';
    if (item.item_type === 'visit') return tab === 'visit';
    return false;
  });
}

// ---------------------------------------------------------------------------
// Helper: sort by priority
// ---------------------------------------------------------------------------

function priorityRank(p: string): number {
  switch (p) {
    case 'urgent':
    case 'emergency':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    default:
      return 3;
  }
}

function sortByPriority(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const d = priorityRank(a.priority) - priorityRank(b.priority);
    if (d !== 0) return d;
    if (a.due_at && b.due_at)
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    if (a.due_at) return -1;
    if (b.due_at) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TodayTasksSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="タスク読み込み中">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex gap-1 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-20 shrink-0 rounded-md" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function FocusSnapshotCard({
  title,
  description,
  value,
  icon: Icon,
  tone = 'default',
}: {
  title: string;
  description: string;
  value: number;
  icon: typeof AlertTriangle;
  tone?: 'default' | 'urgent' | 'highlight';
}) {
  return (
    <div
      className={[
        'rounded-xl border p-3',
        tone === 'urgent'
          ? 'border-red-200 bg-red-50/80'
          : tone === 'highlight'
            ? 'border-primary/30 bg-primary/5'
          : 'border-border/70 bg-muted/20',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <HelpPopover title={title} description={description} />
        </div>
        <Icon
          className={[
            'size-4',
            tone === 'urgent'
              ? 'text-red-600'
              : tone === 'highlight'
                ? 'text-primary'
                : 'text-muted-foreground',
          ].join(' ')}
          aria-hidden="true"
        />
      </div>
      <p
        className={[
          'mt-2 text-2xl font-semibold',
          tone === 'urgent'
            ? 'text-red-700'
            : tone === 'highlight'
              ? 'text-primary'
              : 'text-foreground',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TodayTasksSection({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  const orgId = useOrgId();
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState<DashboardTaskTabKey>('all');
  const isBootstrappingOrg = !orgId;

  useEffect(() => {
    const scheduleNextRollover = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 0, 0);
      const delay = nextMidnight.getTime() - now.getTime();

      return window.setTimeout(() => {
        setToday(format(new Date(), 'yyyy-MM-dd'));
      }, delay);
    };

    const timeoutId = scheduleNextRollover();
    return () => window.clearTimeout(timeoutId);
  }, [today]);

  const actionsQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'actions', orgId],
    queryFn: () => fetchActions(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const schedulesQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'today-visits', orgId, today],
    queryFn: () => fetchTodayVisits(orgId, today),
    staleTime: 60_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['workflow_refresh'],
  });

  // Loading: wait for actions (primary), schedules can load independently
  if (isBootstrappingOrg || actionsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <TodayTasksSkeleton />
        </CardContent>
      </Card>
    );
  }

  // Both failed
  if (actionsQuery.isError && schedulesQuery.isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <ErrorState
            variant="server"
            title="タスクを取得できません"
            description="アクションと訪問予定の取得に失敗しました。再試行してください。"
            detail={
              actionsQuery.error instanceof Error
                ? actionsQuery.error.message
                : undefined
            }
            action={{
              label: '再試行',
              onClick: () => {
                void actionsQuery.refetch();
                void schedulesQuery.refetch();
              },
            }}
          />
        </CardContent>
      </Card>
    );
  }

  // Actions failed but schedules OK — show partial
  if (actionsQuery.isError) {
    const visitItems = (schedulesQuery.data ?? []).map(visitToActionItem);

    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              アクションの取得に失敗したため、訪問予定のみ表示しています。アクションデータを再取得してください。
            </AlertDescription>
          </Alert>

          {schedulesQuery.isLoading ? (
            <TodayTasksSkeleton />
          ) : visitItems.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="本日の訪問予定はありません"
              description="訪問予定がある場合は、ここに表示されます。"
              className="border-0 px-0 py-6"
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border" role="list">
              {sortByPriority(visitItems).map((item) => (
                <ActionItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void actionsQuery.refetch()}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              再試行
              <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pipeline = actionsQuery.data?.pipeline ?? [];
  const actionItems = actionsQuery.data?.actions ?? [];
  const todayVisits = (schedulesQuery.data ?? []).map(visitToActionItem);
  const allItems = [...actionItems, ...todayVisits];
  const urgentCount = allItems.filter(
    (item) => item.priority === 'urgent' || item.priority === 'high'
  ).length;
  const clerkStartCount =
    getTabCount(
      DASHBOARD_TASK_TABS.find((tab) => tab.key === 'intake') ?? DASHBOARD_TASK_TABS[0],
      pipeline,
      todayVisits.length
    ) +
    getTabCount(
      DASHBOARD_TASK_TABS.find((tab) => tab.key === 'visit_planning') ?? DASHBOARD_TASK_TABS[0],
      pipeline,
      todayVisits.length
    );
  const pharmacistStartCount = [
    'dispensing',
    'dispense_audit',
    'medication_set',
    'set_audit',
    'visit',
    'reporting',
  ].reduce((sum, key) => {
    const tab = DASHBOARD_TASK_TABS.find((entry) => entry.key === key);
    if (!tab) return sum;
    return sum + getTabCount(tab, pipeline, todayVisits.length);
  }, 0);
  const filteredItems = sortByPriority(filterByTab(allItems, activeTab));
  const activeTabConfig =
    DASHBOARD_TASK_TABS.find((tab) => tab.key === activeTab) ?? DASHBOARD_TASK_TABS[0];
  const activeTabCount = getTabCount(activeTabConfig, pipeline, todayVisits.length);
  const activeTabFallbackAction =
    activeTab === 'all' ? null : DASHBOARD_TAB_FALLBACK_ACTIONS[activeTab];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {schedulesQuery.isError && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              訪問予定の取得に失敗したため、訪問タスクは一時的に除外しています。再試行してください。
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-task-overview">
          <FocusSnapshotCard
            title="最優先"
            description="緊急と高優先の案件です。最初に着手してください。"
            value={urgentCount}
            icon={AlertTriangle}
            tone={urgentCount > 0 ? 'urgent' : 'default'}
          />
          <FocusSnapshotCard
            title="事務開始"
            description={
              focusRole === 'clerk'
                ? 'あなたの開始位置です。受付と日程調整から先に確認します。'
                : '受付と日程調整から先に見る件数です。'
            }
            value={clerkStartCount}
            icon={ListChecks}
            tone={focusRole === 'clerk' ? 'highlight' : 'default'}
          />
          <FocusSnapshotCard
            title="薬剤師開始"
            description={
              focusRole === 'pharmacist'
                ? 'あなたの開始位置です。調剤、監査、訪問、報告を優先します。'
                : '調剤、監査、訪問、報告までの主作業件数です。'
            }
            value={pharmacistStartCount}
            icon={Pill}
            tone={focusRole === 'pharmacist' ? 'highlight' : 'default'}
          />
          <FocusSnapshotCard
            title="今日の訪問"
            description={
              focusRole === 'common'
                ? '全員共通で確認する本日の訪問予定です。'
                : '本日中に実行または確認が必要な訪問予定です。'
            }
            value={todayVisits.length}
            icon={MapPin}
            tone={focusRole === 'common' ? 'highlight' : 'default'}
          />
        </div>

        {/* Tab bar */}
        <div
          className="flex overflow-x-auto scrollbar-hide gap-1 rounded-lg border bg-muted p-1"
          role="tablist"
          aria-label="今日のタスク カテゴリ切替"
        >
          {DASHBOARD_TASK_TABS.map((tab) => {
            const count = getTabCount(tab, pipeline, todayVisits.length);
            const isActive = activeTab === tab.key;
            const Icon = TAB_ICONS[tab.key];
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`tab-${tab.key}`}
                aria-selected={isActive}
                aria-controls="today-tasks-panel"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  'shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium min-h-[44px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
                {count > 0 && (
                  <span
                    className={[
                      'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted-foreground/10 text-muted-foreground',
                    ].join(' ')}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Task list */}
        <div
          id="today-tasks-panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
        >
          {filteredItems.length === 0 ? (
            activeTab !== 'all' && activeTabCount > 0 && activeTabFallbackAction ? (
              <EmptyState
                icon={Layers}
                title={`${activeTabConfig.label} に要対応があります`}
                description="優先度順の上位アクションには含まれていないため、この工程画面から直接確認してください。"
                action={activeTabFallbackAction}
                className="border-0 px-0 py-6"
              />
            ) : (
              <EmptyState
                icon={Layers}
                title="対応が必要なタスクはありません"
                description="このカテゴリのタスクが発生すると、ここに優先度順で表示されます。"
                className="border-0 px-0 py-6"
              />
            )
          ) : (
            <ul className="divide-y divide-border rounded-lg border" role="list">
              {filteredItems.map((item) => (
                <ActionItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
