'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  AlertCircle,
  ArrowRight,
  CalendarPlus,
  Car,
  CheckSquare,
  CirclePause,
  ClipboardList,
  Clock,
  FileWarning,
  Hospital,
  LogOut,
  PhoneOff,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { fetchActions, PRIORITY_STYLES } from '@/app/(dashboard)/dashboard/actions-section';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import {
  SCHEDULE_STATUS_LABELS,
  statusBadgeClass,
  timeLabel,
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import type { PatientStatusIcon } from '@/types/dashboard-home';
import { SectionIntro } from '@/components/ui/section-intro';
import type { MyDayFocus, MyDayTaskFilter, MyDayVisitFilter } from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

type Task = {
  id: string;
  task_type: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  sla_due_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

const STATUS_ICONS: Record<PatientStatusIcon, typeof Star> = {
  stable: UserCheck,
  new: Sparkles,
  first_visit_soon: CalendarPlus,
  attention: Star,
  urgent: TriangleAlert,
  overdue_visit: Clock,
  report_pending: FileWarning,
  medication_change: RefreshCw,
  hospitalized: Hospital,
  discharged: LogOut,
  no_contact: PhoneOff,
  paused: CirclePause,
};

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

type MyDayContentProps = {
  initialFocus?: MyDayFocus;
  initialVisitFilter?: MyDayVisitFilter;
  initialTaskFilter?: MyDayTaskFilter;
  initialContext?: string | null;
};

function InlineFilterButton({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span
      className={[
        'inline-flex min-h-[32px] items-center rounded-full border px-3 py-1 text-xs font-medium',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/70 bg-background text-muted-foreground',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

export function MyDayContent({
  initialFocus,
  initialVisitFilter = 'all',
  initialTaskFilter = 'all',
  initialContext,
}: MyDayContentProps = {}) {
  const replaceMyDayUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const userId = useAuthStore((s) => s.currentUser.id);
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // My visits today
  const visitsQuery = useQuery({
    queryKey: ['my-day-visits', orgId, userId, today],
    queryFn: async () => {
      const params = new URLSearchParams({ date_from: today, date_to: today });
      if (userId) params.set('pharmacist_id', userId);
      const res = await fetch(`/api/visit-schedules?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問スケジュールの取得に失敗しました');
      return res.json() as Promise<{ data: VisitSchedule[] }>;
    },
    enabled: !!orgId,
  });

  // My tasks
  const tasksQuery = useQuery({
    queryKey: ['my-day-tasks', orgId, userId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.set('assigned_to', userId);
      const res = await fetch(`/api/tasks?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('タスクの取得に失敗しました');
      return res.json() as Promise<{ data: Task[] }>;
    },
    enabled: !!orgId,
  });

  // Pipeline actions (from dashboard)
  const actionsQuery = useQuery({
    queryKey: ['dashboard', 'actions', orgId],
    queryFn: () => fetchActions(orgId),
    staleTime: 30_000,
    enabled: !!orgId,
  });

  // Status change notifications (recent)
  const statusChangesQuery = useQuery({
    queryKey: ['my-day-status-changes', orgId, today],
    queryFn: async () => {
      const res = await fetch(
        `/api/audit-logs?action=patient_status_change&limit=10&date_from=${today}`,
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as Array<{
        id: string;
        target_id: string;
        changes: {
          patient_name: string;
          from: PatientStatusIcon;
          from_label: string;
          to: PatientStatusIcon;
          to_label: string;
        };
        created_at: string;
      }>;
    },
    enabled: !!orgId,
  });

  const todayVisits = visitsQuery.data?.data ?? [];
  const pendingTasks = (tasksQuery.data?.data ?? []).filter(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  const pipeline = actionsQuery.data?.pipeline ?? [];
  const urgentActions = (actionsQuery.data?.actions ?? []).filter(
    (a) => a.priority === 'urgent' || a.priority === 'high',
  );
  const unpreparedVisits = todayVisits.filter((v) => !v.preparation?.prepared_at);
  const filteredVisits = todayVisits.filter((visit) => {
    if (initialVisitFilter === 'unprepared') return !visit.preparation?.prepared_at;
    if (initialVisitFilter === 'in_progress') {
      return visit.schedule_status === 'departed' || visit.schedule_status === 'in_progress';
    }
    return true;
  });
  const filteredPendingTasks = pendingTasks.filter((task) => {
    if (initialTaskFilter === 'urgent') {
      return task.priority === 'urgent' || task.priority === 'high';
    }
    if (initialTaskFilter === 'pending') {
      return task.status === 'pending';
    }
    return true;
  });
  const statusChanges = statusChangesQuery.data ?? [];

  const totalPipeline = pipeline.reduce((s, p) => s + p.count, 0);
  const contextSummary =
    initialContext === 'dashboard_home'
      ? initialFocus === 'visits'
        ? 'ホームから担当訪問にフォーカスして開いています。'
        : initialFocus === 'tasks'
          ? 'ホームから未完了タスクにフォーカスして開いています。'
          : initialFocus === 'urgent'
            ? 'ホームから優先対応にフォーカスして開いています。'
            : 'ホームから今日の業務にフォーカスして開いています。'
      : null;

  return (
    <div className="space-y-4 p-4 max-w-lg mx-auto">
      {contextSummary ? (
        <Alert className="border-sky-200 bg-sky-50 text-sky-900" data-testid="my-day-context-banner">
          <AlertCircle className="size-4 text-sky-700" aria-hidden="true" />
          <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <SectionIntro
        title="今日の概要"
        description="今日の訪問、タスク、パイプライン、緊急件数を最初に把握する導入グループです。"
      />
      <div className="grid grid-cols-4 gap-2">
        <QuickStat label="訪問" value={todayVisits.length} loading={visitsQuery.isLoading} />
        <QuickStat label="タスク" value={pendingTasks.length} loading={tasksQuery.isLoading} />
        <QuickStat label="パイプライン" value={totalPipeline} loading={actionsQuery.isLoading} />
        <QuickStat
          label="緊急"
          value={urgentActions.length}
          loading={actionsQuery.isLoading}
          urgent={urgentActions.length > 0}
        />
      </div>

      <SectionIntro
        title="優先対応"
        description="緊急アクションと今日の訪問準備を先に処理するための優先グループです。"
      />
      {urgentActions.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-700">
              <TriangleAlert className="size-4" aria-hidden="true" />
              緊急・高優先アクション
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {urgentActions.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                href={item.action_href}
                className="flex items-center justify-between rounded-md border border-red-200 bg-white p-2.5 transition-colors hover:bg-red-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.patient_name && `${item.patient_name} / `}
                    {item.queue_label}
                  </p>
                </div>
                <Badge variant="outline" className={PRIORITY_STYLES[item.priority] ?? ''}>
                  {item.priority === 'urgent' ? '緊急' : '高'}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className={initialFocus === 'visits' ? 'ring-2 ring-primary/25' : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Car className="size-4 text-primary" aria-hidden="true" />
            今日の訪問
            <Badge variant="secondary" className="ml-auto text-xs">
              {visitsQuery.isLoading ? '…' : `${filteredVisits.length}件`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'visits', visit_filter: null, context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialVisitFilter === 'all'} label="全て" />
            </button>
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'visits', visit_filter: 'unprepared', context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialVisitFilter === 'unprepared'} label="準備未完了のみ" />
            </button>
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'visits', visit_filter: 'in_progress', context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialVisitFilter === 'in_progress'} label="訪問進行中のみ" />
            </button>
          </div>
          {visitsQuery.isLoading ? (
            <SectionSkeleton />
          ) : filteredVisits.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">本日の訪問はありません</p>
          ) : (
            filteredVisits.map((visit) => {
              const windowLabel = timeLabel(visit.time_window_start, visit.time_window_end);
              return (
                <Link
                  key={visit.id}
                  href={`/visits/${visit.id}/record`}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{visit.case_.patient.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {windowLabel} / {VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${statusBadgeClass(visit.schedule_status)}`}
                    >
                      {SCHEDULE_STATUS_LABELS[visit.schedule_status] ?? visit.schedule_status}
                    </Badge>
                    {!visit.preparation?.prepared_at && (
                      <Badge
                        variant="outline"
                        className="border-orange-300 text-[10px] text-orange-600"
                      >
                        準備未
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      {unpreparedVisits.length > 0 && (
        <Link
          href="/schedules"
          className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100"
        >
          <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
          <span>訪問前準備が未完了 {unpreparedVisits.length}件</span>
          <ArrowRight className="ml-auto size-4" aria-hidden="true" />
        </Link>
      )}

      <SectionIntro
        title="進行中の業務"
        description="パイプラインと未完了タスクを見て、今日の作業順を組み立てるグループです。"
      />
      {pipeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">パイプライン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {pipeline
                .filter((p) => p.count > 0)
                .map((step) => (
                  <div key={step.key} className="rounded-md border p-2 text-center">
                    <p className="text-lg font-bold text-foreground">{step.count}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{step.label}</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={initialFocus === 'tasks' ? 'ring-2 ring-primary/25' : undefined}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckSquare className="size-4 text-primary" aria-hidden="true" />
            未完了タスク
            <Badge variant="secondary" className="ml-auto text-xs">
              {tasksQuery.isLoading ? '…' : `${filteredPendingTasks.length}件`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'tasks', task_filter: null, context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialTaskFilter === 'all'} label="全て" />
            </button>
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'tasks', task_filter: 'urgent', context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialTaskFilter === 'urgent'} label="高優先のみ" />
            </button>
            <button
              type="button"
              onClick={() =>
                replaceMyDayUrl({ focus: 'tasks', task_filter: 'pending', context: initialContext ?? null })
              }
              className="border-0 bg-transparent p-0"
            >
              <InlineFilterButton active={initialTaskFilter === 'pending'} label="未着手のみ" />
            </button>
          </div>
          {tasksQuery.isLoading ? (
            <SectionSkeleton />
          ) : filteredPendingTasks.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              未完了のタスクはありません
            </p>
          ) : (
            filteredPendingTasks.slice(0, 8).map((task) => {
              const presentation = describeOperationalTask(task);
              return (
                <Link
                  key={task.id}
                  href={presentation.actionHref}
                  className="flex items-center justify-between rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {presentation.queueLabel} / {presentation.actionLabel}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    {(task.priority === 'urgent' || task.priority === 'high') && (
                      <Badge
                        variant={task.priority === 'urgent' ? 'destructive' : 'secondary'}
                        className="text-[10px]"
                      >
                        {task.priority === 'urgent' ? '緊急' : '高'}
                      </Badge>
                    )}
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      <SectionIntro
        title="補助情報"
        description="患者ステータス変更やショートカットを確認し、必要な別画面へ移動する補助グループです。"
      />
      {statusChanges.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 text-primary" aria-hidden="true" />
              ステータス変更
              <Badge variant="secondary" className="ml-auto text-xs">
                {statusChanges.length}件
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {statusChanges.map((change) => {
              const toCfg = STATUS_ICON_CONFIG[change.changes.to] ?? STATUS_ICON_CONFIG.stable;
              const ToIcon = STATUS_ICONS[change.changes.to] ?? UserCheck;
              return (
                <Link
                  key={change.id}
                  href={`/patients/${change.target_id}`}
                  className="flex items-center gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className={`shrink-0 rounded-full p-1 ${toCfg.color} ${toCfg.bg}`}>
                    <ToIcon className="size-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{change.changes.patient_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {change.changes.from_label} → {change.changes.to_label}
                    </p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Link
          href="/dashboard"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          ダッシュボード
        </Link>
        <Link
          href="/schedules"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          スケジュール
        </Link>
        <Link
          href="/tasks"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          タスク
        </Link>
        <Link
          href="/workflow"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          ワークフロー
        </Link>
        <Link
          href="/handoff"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          申し送り
        </Link>
        <Link
          href="/notifications"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          通知
        </Link>
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  loading,
  urgent,
}: {
  label: string;
  value: number;
  loading: boolean;
  urgent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 text-center ${urgent ? 'border-red-200 bg-red-50' : ''}`}
    >
      <p className={`text-xl font-bold ${urgent ? 'text-red-600' : 'text-foreground'}`}>
        {loading ? '…' : value}
      </p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
