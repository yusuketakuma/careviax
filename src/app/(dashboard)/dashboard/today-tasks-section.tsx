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
  DASHBOARD_TASK_TYPE_TO_TAB,
  type DashboardTaskTabKey,
} from '@/lib/dashboard/home-config';
import {
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import { fetchVisitSchedulesWindow } from '@/app/(dashboard)/schedules/visit-schedule-fetch.helpers';

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TodayTasksSection() {
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
  const filteredItems = sortByPriority(filterByTab(allItems, activeTab));

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
            <EmptyState
              icon={Layers}
              title="対応が必要なタスクはありません"
              description="このカテゴリのタスクが発生すると、ここに優先度順で表示されます。"
              className="border-0 px-0 py-6"
            />
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
