'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CalendarPlus,
  CalendarDays,
  Car,
  CheckSquare,
  CirclePause,
  Clock,
  FileWarning,
  Hospital,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquareText,
  PhoneOff,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
  Workflow,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { hasPermission } from '@/lib/auth/permission-matrix';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { buildPatientHref } from '@/lib/patient/navigation';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { fetchDashboardCockpit } from '@/app/(dashboard)/dashboard/dashboard-cockpit';
import { PROCESS_STEPS_9 } from '@/lib/prescription/cycle-workspace';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import {
  SCHEDULE_STATUS_LABELS,
  statusBadgeClass,
  timeLabel,
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import type {
  ActionItem,
  PatientStatusIcon,
  PipelineStep,
  QueuePriority,
} from '@/types/dashboard-home';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import { PageSection } from '@/components/layout/page-section';
import type {
  MyDayFocus,
  MyDayTaskFilter,
  MyDayVisitFilter,
} from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';
import {
  InlineFilterButton,
  MyDayNextStepPanel,
  SectionSkeleton,
  UnpreparedVisitLink,
} from './my-day-sections';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StatCard } from '@/components/ui/stat-card';

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

// QueuePriority 写像(PRIORITY_ROLE 準拠): urgent(緊急+至急統合)=blocked, high=confirm, normal=info, low=readonly。
const QUEUE_PRIORITY_ROLE = {
  urgent: 'blocked',
  high: 'confirm',
  normal: 'info',
  low: 'readonly',
} as const;

function toQueuePriority(priority: string): QueuePriority {
  if (priority === 'emergency' || priority === 'urgent') return 'urgent';
  if (priority === 'high') return 'high';
  if (priority === 'low') return 'low';
  return 'normal';
}

function buildCockpitPipeline(data: DashboardCockpitResponse): PipelineStep[] {
  const statusCounts = data.cycle_status_counts ?? {};
  return PROCESS_STEPS_9.map((step) => ({
    key: step.key,
    label: step.label,
    count: step.statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0),
  }));
}

function buildCockpitActions(data: DashboardCockpitResponse): ActionItem[] {
  return (data.audit_queue ?? []).map((item) => ({
    id: item.task_id,
    item_type: 'task',
    task_type: 'dispense_audit',
    queue_label: item.has_narcotic ? '麻薬監査' : '調剤監査',
    title: `${item.patient_name}さんの監査待ち`,
    summary: item.has_narcotic
      ? '麻薬を含む調剤監査を先に確認します'
      : '調剤監査を完了して次工程に進めます',
    priority: toQueuePriority(item.priority),
    due_at: item.due_at,
    action_href: '/audit',
    action_label: '監査を開く',
    owner_name: null,
    patient_name: item.patient_name,
    badges: item.handling_tags,
  }));
}

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

const MY_DAY_SECTION_CLASS_NAME = 'min-w-0 overflow-hidden';

type MyDayContentProps = {
  initialFocus?: MyDayFocus;
  initialVisitFilter?: MyDayVisitFilter;
  initialTaskFilter?: MyDayTaskFilter;
  initialContext?: string | null;
};

export function MyDayContent({
  initialFocus,
  initialVisitFilter = 'all',
  initialTaskFilter = 'all',
  initialContext,
}: MyDayContentProps = {}) {
  const replaceMyDayUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const userId = useAuthStore((s) => s.currentUser.id);
  const viewerRole = useAuthStore((s) => s.currentUser.role);
  const isUserPending = !!orgId && !userId;
  const today = useMemo(() => japanDateKey(), []);
  // Pinned zone の対象日表示(JST基準、SSOT 2.8 Japan date basis)。
  // today は japanDateKey() の JST 'YYYY-MM-DD'。date-fns format はランタイムローカルTZで
  // 解釈するため、UTC instant(...+09:00) を渡すと Asia/Tokyo 以外の環境で前日にずれる。
  // カレンダー日の各成分から new Date(y,m-1,d)(ローカル構築)を作り、format もローカルで
  // 相殺させることで TZ 非依存にする(曜日はカレンダー日で不変)。
  const todayLabel = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    return format(new Date(y, m - 1, d), 'M月d日(EEE)', { locale: ja });
  }, [today]);
  const canViewStatusChanges = viewerRole ? hasPermission(viewerRole, 'canAdmin') : false;

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
    enabled: !!orgId && !!userId,
  });

  // My tasks
  const tasksQuery = useQuery({
    queryKey: ['my-day-tasks', orgId, userId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.set('assigned_to', userId);
      params.set('status', 'open');
      return fetchAllCursorPages<Task>({
        path: '/api/tasks',
        params,
        init: { headers: { 'x-org-id': orgId } },
        errorMessage: 'タスクの取得に失敗しました',
      });
    },
    enabled: !!orgId && !!userId,
  });

  // Pipeline and urgent audit actions from the cockpit BFF.
  const actionsQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchDashboardCockpit(orgId),
    staleTime: 30_000,
    enabled: !!orgId,
  });

  // Status change notifications (recent)
  const statusChangesQuery = useQuery({
    queryKey: ['my-day-status-changes', orgId, today, canViewStatusChanges],
    queryFn: async () => {
      const params = new URLSearchParams({
        action: 'patient_status_change',
        limit: '10',
        date_from: `${today}T00:00:00+09:00`,
      });
      const res = await fetch(`/api/audit-logs?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ステータス変更の取得に失敗しました');
      const json = await res.json();
      return (json.data ?? []) as Array<{
        id: string;
        target_id: string;
        changes: {
          from: PatientStatusIcon;
          from_label: string;
          to: PatientStatusIcon;
          to_label: string;
        };
        created_at: string;
      }>;
    },
    enabled: !!orgId && canViewStatusChanges,
  });

  const todayVisits = visitsQuery.data?.data ?? [];
  // 完了訪問は Scroll zone の折りたたみへ(SSOT 4.1: Primary を汚染しない)。
  const completedVisits = todayVisits.filter((v) => v.schedule_status === 'completed');
  const activeVisits = todayVisits.filter((v) => v.schedule_status !== 'completed');
  const pendingTasks = (tasksQuery.data?.data ?? []).filter(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  const pipeline = actionsQuery.data ? buildCockpitPipeline(actionsQuery.data) : [];
  const urgentActions = (actionsQuery.data ? buildCockpitActions(actionsQuery.data) : []).filter(
    (a) => a.priority === 'urgent' || a.priority === 'high',
  );
  const unpreparedVisits = activeVisits.filter((v) => !v.preparation?.prepared_at);
  const filteredVisits = activeVisits.filter((visit) => {
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
  const statusChanges = canViewStatusChanges ? (statusChangesQuery.data ?? []) : [];

  const totalPipeline = pipeline.reduce((s, p) => s + p.count, 0);
  const nextTask = filteredPendingTasks[0] ?? pendingTasks[0] ?? null;
  const nextTaskPresentation = nextTask ? describeOperationalTask(nextTask) : null;
  // フォールバックは activeVisits に限定する。todayVisits は完了訪問を含み、
  // 完了訪問は Pinned/Scroll の折りたたみへ退避済みなので「次の訪問」に推薦してはならない。
  const nextVisit = filteredVisits[0] ?? activeVisits[0] ?? null;
  const nextVisitWindowLabel = nextVisit
    ? timeLabel(nextVisit.time_window_start, nextVisit.time_window_end)
    : null;
  const hasPrimaryFetchError = actionsQuery.isError || visitsQuery.isError || tasksQuery.isError;
  const nextStep = hasPrimaryFetchError
    ? {
        title: '取得エラーがあります',
        description:
          '今日の訪問、タスク、優先対応の一部を取得できません。空状態とは判断せず、各一覧で確認してください。',
        href: '/workflow',
        ctaLabel: 'ワークフローを確認',
        tone: 'danger' as const,
      }
    : isUserPending
      ? {
          title: '担当者情報を確認中',
          description:
            '自分の担当訪問と未完了タスクだけを表示するため、担当者 ID の同期を待っています。',
          href: '/dashboard',
          ctaLabel: 'ホームを確認',
          tone: 'default' as const,
        }
      : urgentActions.length > 0
        ? {
            title: '緊急・高優先アクションを先に確認',
            description: `${urgentActions.length}件の優先対応があります。患者・期限・キューを確認してから作業に入ります。`,
            href: urgentActions[0]?.action_href ?? '/workflow',
            ctaLabel: urgentActions[0]?.action_label ?? '優先対応を開く',
            tone: 'danger' as const,
          }
        : unpreparedVisits.length > 0
          ? {
              title: '訪問前準備を完了',
              description: `${unpreparedVisits.length}件の訪問で準備が未完了です。訪問前に持参物と連絡事項を確認します。`,
              href: '/schedules',
              ctaLabel: '準備一覧を開く',
              tone: 'warning' as const,
            }
          : nextVisit
            ? {
                title: `${nextVisit.case_.patient.name}さんの訪問を確認`,
                description: `${nextVisitWindowLabel ?? '時間未設定'} / ${
                  VISIT_TYPE_LABELS[nextVisit.visit_type] ?? nextVisit.visit_type
                }。訪問記録から患者文脈と当日の状態を確認します。`,
                href: `/visits/${nextVisit.id}/record`,
                ctaLabel: '訪問記録を開く',
                tone: 'default' as const,
              }
            : nextTask && nextTaskPresentation
              ? {
                  title: nextTask.title,
                  description: `${nextTaskPresentation.queueLabel} / ${nextTaskPresentation.actionLabel}。未完了タスクから今日の作業を進めます。`,
                  href: nextTaskPresentation.actionHref,
                  ctaLabel: nextTaskPresentation.actionLabel,
                  tone: 'default' as const,
                }
              : {
                  title: '今日の確認は落ち着いています',
                  description:
                    '担当訪問と未完了タスクに大きな残りはありません。ホームで全体状況を確認できます。',
                  href: '/dashboard',
                  ctaLabel: 'ホームに戻る',
                  tone: 'default' as const,
                };
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
    <div className="w-full space-y-3 p-3 sm:p-4 lg:space-y-4 lg:p-5" data-testid="my-day-content">
      {contextSummary ? (
        <Alert
          className="border-tag-info/30 bg-tag-info/10 text-tag-info"
          data-testid="my-day-context-banner"
        >
          <AlertCircle className="size-4 text-tag-info" aria-hidden="true" />
          <AlertDescription className="text-tag-info">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      {isUserPending ? (
        <Alert className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm">
          <AlertCircle className="size-4 text-state-confirm" aria-hidden="true" />
          <AlertDescription className="text-state-confirm">
            担当者情報を確認中です。担当者が確定するまで、自分の訪問・タスクだけを取得します。
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Pinned zone: 対象日 + 件数ストリップ(SSOT 4.1 ワークリスト骨格)。スクロールしても消さない。 */}
      <div className="sticky top-0 z-20">
        <div className="border-b border-border/70 bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">本日 {todayLabel}</h2>
            <p className="text-xs text-muted-foreground">担当分の件数サマリー</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="訪問"
              className="min-w-0"
              value={
                visitsQuery.isError ? (
                  '—'
                ) : visitsQuery.isLoading || isUserPending ? (
                  <Skeleton as="span" className="h-7 w-10" />
                ) : (
                  todayVisits.length
                )
              }
            />
            <StatCard
              label="タスク"
              className="min-w-0"
              value={
                tasksQuery.isError ? (
                  '—'
                ) : tasksQuery.isLoading || isUserPending ? (
                  <Skeleton as="span" className="h-7 w-10" />
                ) : (
                  pendingTasks.length
                )
              }
            />
            <StatCard
              label="パイプライン"
              className="min-w-0"
              value={
                actionsQuery.isError ? (
                  '—'
                ) : actionsQuery.isLoading ? (
                  <Skeleton as="span" className="h-7 w-10" />
                ) : (
                  totalPipeline
                )
              }
            />
            <StatCard
              label="緊急"
              className="min-w-0"
              role={
                !actionsQuery.isError && !actionsQuery.isLoading && urgentActions.length > 0
                  ? 'blocked'
                  : undefined
              }
              value={
                actionsQuery.isError ? (
                  '—'
                ) : actionsQuery.isLoading ? (
                  <Skeleton as="span" className="h-7 w-10" />
                ) : (
                  urgentActions.length
                )
              }
            />
          </div>
        </div>
      </div>
      <PageSection
        title="今日の概要"
        description="次にすることを最初に把握します。"
        className={MY_DAY_SECTION_CLASS_NAME}
        contentClassName="space-y-3"
      >
        <MyDayNextStepPanel {...nextStep} />
      </PageSection>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.38fr)] xl:items-start">
        <div className="min-w-0 space-y-4">
          <PageSection
            title="優先対応"
            description="緊急アクションと今日の訪問準備を先に処理するための優先グループです。"
            className={MY_DAY_SECTION_CLASS_NAME}
            contentClassName="space-y-3"
          >
            {actionsQuery.isError ? (
              <ErrorState
                variant="server"
                live="assertive"
                headingLevel={3}
                title="優先アクションを取得できません"
                cause="緊急対応とパイプラインの取得に失敗しました。"
                nextAction="空状態ではない可能性があります。再試行するか、ワークフロー画面で確認してください。"
                onRetry={() => void actionsQuery.refetch()}
                secondaryAction={{
                  label: 'ワークフローを確認',
                  href: '/workflow',
                  variant: 'outline',
                }}
              />
            ) : urgentActions.length > 0 ? (
              <Card className="border-state-blocked/30 bg-state-blocked/5">
                <CardHeader className="pb-2">
                  <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium text-state-blocked">
                    <TriangleAlert className="size-4" aria-hidden="true" />
                    緊急・高優先アクション
                  </h3>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {urgentActions.slice(0, 5).map((item) => (
                    <Link
                      key={item.id}
                      href={item.action_href}
                      className="flex min-h-[44px] items-center justify-between rounded-md border border-state-blocked/30 bg-card p-2.5 transition-colors hover:bg-state-blocked/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.patient_name && `${item.patient_name} / `}
                          {item.queue_label}
                        </p>
                      </div>
                      <StateBadge role={QUEUE_PRIORITY_ROLE[item.priority] ?? 'confirm'}>
                        {item.priority === 'urgent' ? '緊急' : '高'}
                      </StateBadge>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card className={initialFocus === 'visits' ? 'ring-2 ring-primary/25' : undefined}>
              <CardHeader className="pb-2">
                <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
                  <Car className="size-4 text-primary" aria-hidden="true" />
                  今日の訪問
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {isUserPending || visitsQuery.isLoading || visitsQuery.isError
                      ? '…'
                      : `${filteredVisits.length}件`}
                  </Badge>
                </h3>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={initialVisitFilter === 'all'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'visits',
                        visit_filter: null,
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton active={initialVisitFilter === 'all'} label="全て" />
                  </button>
                  <button
                    type="button"
                    aria-pressed={initialVisitFilter === 'unprepared'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'visits',
                        visit_filter: 'unprepared',
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton
                      active={initialVisitFilter === 'unprepared'}
                      label="準備未完了のみ"
                    />
                  </button>
                  <button
                    type="button"
                    aria-pressed={initialVisitFilter === 'in_progress'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'visits',
                        visit_filter: 'in_progress',
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton
                      active={initialVisitFilter === 'in_progress'}
                      label="訪問進行中のみ"
                    />
                  </button>
                </div>
                {visitsQuery.isError ? (
                  <ErrorState
                    variant="server"
                    live="assertive"
                    headingLevel={3}
                    title="本日の訪問を取得できません"
                    cause="担当訪問の取得に失敗しました。"
                    nextAction="訪問なしとは判断せず、再試行するかスケジュール画面で担当予定を確認してください。"
                    onRetry={() => void visitsQuery.refetch()}
                    secondaryAction={{
                      label: 'スケジュールを確認',
                      href: '/schedules',
                      variant: 'outline',
                    }}
                  />
                ) : isUserPending || visitsQuery.isLoading ? (
                  <SectionSkeleton />
                ) : filteredVisits.length === 0 ? (
                  <EmptyState
                    headingLevel={3}
                    title={
                      initialVisitFilter === 'all'
                        ? '本日の訪問はありません'
                        : 'この条件に一致する本日の訪問はありません'
                    }
                    action={{ label: 'スケジュールを確認', href: '/schedules' }}
                  />
                ) : (
                  filteredVisits.map((visit) => {
                    const windowLabel = timeLabel(visit.time_window_start, visit.time_window_end);
                    return (
                      <Link
                        key={visit.id}
                        href={`/visits/${visit.id}/record`}
                        className="flex min-h-[44px] items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{visit.case_.patient.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {windowLabel} /{' '}
                            {VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type}
                          </p>
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${statusBadgeClass(visit.schedule_status)}`}
                          >
                            {SCHEDULE_STATUS_LABELS[visit.schedule_status] ?? visit.schedule_status}
                          </Badge>
                          {!visit.preparation?.prepared_at && (
                            <StateBadge role="confirm" showIcon={false} className="text-xs">
                              準備未
                            </StateBadge>
                          )}
                        </div>
                      </Link>
                    );
                  })
                )}
                {completedVisits.length > 0 ? (
                  <details className="rounded-lg border border-border/70">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
                      完了した訪問 {completedVisits.length}件
                      <span className="text-xs">(開いて確認)</span>
                    </summary>
                    <div className="space-y-1 px-2 pb-2">
                      {completedVisits.map((visit) => (
                        <Link
                          key={visit.id}
                          href={`/visits/${visit.id}/record`}
                          className="flex min-h-11 items-center justify-between rounded-md px-2 text-sm transition-colors hover:bg-muted/50"
                        >
                          <span className="min-w-0 truncate">{visit.case_.patient.name}</span>
                          <span className="ml-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                            {timeLabel(visit.time_window_start, visit.time_window_end)}
                            <StateBadge role="done" showIcon={false} className="text-xs">
                              完了
                            </StateBadge>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </details>
                ) : null}
              </CardContent>
            </Card>

            {unpreparedVisits.length > 0 && <UnpreparedVisitLink count={unpreparedVisits.length} />}
          </PageSection>

          <PageSection
            title="進行中の業務"
            description="パイプラインと未完了タスクを見て、今日の作業順を組み立てるグループです。"
            className={MY_DAY_SECTION_CLASS_NAME}
            contentClassName="space-y-3"
          >
            {actionsQuery.isError ? (
              <ErrorState
                variant="server"
                live="assertive"
                headingLevel={3}
                title="パイプラインを取得できません"
                cause="未解決の業務件数を取得できませんでした。"
                nextAction="空状態ではない可能性があります。再試行するか、ワークフロー画面で確認してください。"
                onRetry={() => void actionsQuery.refetch()}
                secondaryAction={{
                  label: 'ワークフローを確認',
                  href: '/workflow',
                  variant: 'outline',
                }}
              />
            ) : pipeline.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="font-heading text-sm leading-snug font-medium">パイプライン</h3>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {pipeline
                      .filter((p) => p.count > 0)
                      .map((step) => (
                        <div
                          key={step.key}
                          className="flex min-h-[70px] flex-col justify-center rounded-md border p-2 text-center"
                        >
                          <p className="text-lg font-bold text-foreground">{step.count}</p>
                          <p className="text-xs text-muted-foreground">{step.label}</p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card className={initialFocus === 'tasks' ? 'ring-2 ring-primary/25' : undefined}>
              <CardHeader className="pb-2">
                <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
                  <CheckSquare className="size-4 text-primary" aria-hidden="true" />
                  未完了タスク
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {isUserPending || tasksQuery.isLoading || tasksQuery.isError
                      ? '…'
                      : `${filteredPendingTasks.length}件`}
                  </Badge>
                </h3>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={initialTaskFilter === 'all'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'tasks',
                        task_filter: null,
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton active={initialTaskFilter === 'all'} label="全て" />
                  </button>
                  <button
                    type="button"
                    aria-pressed={initialTaskFilter === 'urgent'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'tasks',
                        task_filter: 'urgent',
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton
                      active={initialTaskFilter === 'urgent'}
                      label="高優先のみ"
                    />
                  </button>
                  <button
                    type="button"
                    aria-pressed={initialTaskFilter === 'pending'}
                    onClick={() =>
                      replaceMyDayUrl({
                        focus: 'tasks',
                        task_filter: 'pending',
                        context: initialContext ?? null,
                      })
                    }
                    className="border-0 bg-transparent p-0"
                  >
                    <InlineFilterButton
                      active={initialTaskFilter === 'pending'}
                      label="未着手のみ"
                    />
                  </button>
                </div>
                {tasksQuery.isError ? (
                  <ErrorState
                    variant="server"
                    live="assertive"
                    headingLevel={3}
                    title="未完了タスクを取得できません"
                    cause="担当タスクの取得に失敗しました。"
                    nextAction="タスクなしとは判断せず、再試行するかタスク一覧で確認してください。"
                    onRetry={() => void tasksQuery.refetch()}
                    secondaryAction={{
                      label: 'タスク一覧を確認',
                      href: '/tasks',
                      variant: 'outline',
                    }}
                  />
                ) : isUserPending || tasksQuery.isLoading ? (
                  <SectionSkeleton />
                ) : filteredPendingTasks.length === 0 ? (
                  <EmptyState
                    headingLevel={3}
                    title={
                      initialTaskFilter === 'all'
                        ? '未完了のタスクはありません'
                        : 'この条件に一致する未完了タスクはありません'
                    }
                    action={{ label: 'タスク一覧を確認', href: '/tasks' }}
                  />
                ) : (
                  filteredPendingTasks.slice(0, 8).map((task) => {
                    const presentation = describeOperationalTask(task);
                    return (
                      <Link
                        key={task.id}
                        href={presentation.actionHref}
                        className="flex min-h-[44px] items-center justify-between rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{task.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {presentation.queueLabel} / {presentation.actionLabel}
                          </p>
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          {(task.priority === 'urgent' || task.priority === 'high') && (
                            <StateBadge
                              className="text-xs"
                              role={QUEUE_PRIORITY_ROLE[task.priority] ?? 'confirm'}
                            >
                              {task.priority === 'urgent' ? '緊急' : '高'}
                            </StateBadge>
                          )}
                          <ArrowRight
                            className="size-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </div>
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </PageSection>
        </div>

        <div className="min-w-0 space-y-4">
          <PageSection
            title="補助情報"
            description="患者ステータス変更やショートカットを確認し、必要な別画面へ移動する補助グループです。"
            className={MY_DAY_SECTION_CLASS_NAME}
            contentClassName="space-y-3"
            tone="subtle"
          >
            {canViewStatusChanges && statusChangesQuery.isError ? (
              <ErrorState
                variant="server"
                live="assertive"
                headingLevel={3}
                title="ステータス変更を取得できません"
                cause="患者ステータスの変更履歴を取得できませんでした。"
                nextAction="再試行するか、必要に応じて患者一覧または監査ログで確認してください。"
                onRetry={() => void statusChangesQuery.refetch()}
                secondaryAction={{ label: '患者一覧を確認', href: '/patients', variant: 'outline' }}
              />
            ) : canViewStatusChanges && statusChanges.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-medium">
                    <AlertCircle className="size-4 text-primary" aria-hidden="true" />
                    ステータス変更
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {statusChanges.length}件
                    </Badge>
                  </h3>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {statusChanges.map((change) => {
                    const toCfg =
                      STATUS_ICON_CONFIG[change.changes.to] ?? STATUS_ICON_CONFIG.stable;
                    const ToIcon = STATUS_ICONS[change.changes.to] ?? UserCheck;
                    return (
                      <Link
                        key={change.id}
                        href={buildPatientHref(change.target_id)}
                        className="flex min-h-[44px] items-center gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
                      >
                        <div className={`shrink-0 rounded-full p-1 ${toCfg.color} ${toCfg.bg}`}>
                          <ToIcon className="size-3.5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">ステータス変更を確認</p>
                          <p className="text-xs text-muted-foreground">
                            {change.changes.from_label} → {change.changes.to_label}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/dashboard"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LayoutDashboard className="size-4" aria-hidden="true" />
                ダッシュボード
              </Link>
              <Link
                href="/schedules"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarDays className="size-4" aria-hidden="true" />
                スケジュール
              </Link>
              <Link
                href="/tasks"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ListChecks className="size-4" aria-hidden="true" />
                タスク
              </Link>
              <Link
                href="/workflow"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Workflow className="size-4" aria-hidden="true" />
                ワークフロー
              </Link>
              <Link
                href="/handoff"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageSquareText className="size-4" aria-hidden="true" />
                申し送り
              </Link>
              <Link
                href="/notifications"
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Bell className="size-4" aria-hidden="true" />
                通知
              </Link>
            </div>
          </PageSection>
        </div>
      </div>
    </div>
  );
}
