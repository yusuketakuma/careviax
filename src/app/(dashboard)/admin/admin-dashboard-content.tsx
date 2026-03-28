'use client';

import { useState, type ElementType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileClock,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';

type OverdueDashboard = {
  summary: {
    unrecorded_visits: number;
    unsent_reports: number;
    overdue_tasks: number;
    total: number;
  };
  unrecorded_visits: Array<{
    id: string;
    patient_id: string;
    patient_name: string;
    scheduled_date: string;
    schedule_status: string;
  }>;
  unsent_reports: Array<{
    id: string;
    patient_id: string;
    patient_name: string;
    report_type: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  overdue_tasks: Array<{
    id: string;
    task_type: string;
    title: string;
    priority: string;
    due_date: string | null;
    sla_due_at: string | null;
  }>;
};

type MonthlyStats = {
  month: string;
  summary: {
    total_patients: number;
    over_limit_count: number;
    within_limit_count: number;
    under_limit_count: number;
  };
  patient_stats: Array<{
    patient_id: string;
    patient_name: string;
    insurance_basis: 'medical' | 'care' | 'both';
    visit_count: number;
    monthly_limit: number;
    status: 'over_limit' | 'within_limit' | 'under_limit';
  }>;
};

type WorkflowDashboard = {
  workflow_exceptions: {
    open: number;
    items: Array<{
      id: string;
      exception_type: string;
      description: string;
      severity: 'critical' | 'warning' | 'info';
      patient_name: string | null;
      created_at: string;
    }>;
  };
};

class AdminDashboardFetchError extends Error {
  status?: number;
  code?: string;
}

function createMonthCursor() {
  return startOfMonth(new Date());
}

function monthParam(value: Date) {
  return format(value, 'yyyy-MM');
}

function formatDateLabel(value: string) {
  return format(parseISO(value), 'M月d日', { locale: ja });
}

function formatMonthLabel(value: string) {
  return format(parseISO(`${value}-01T00:00:00`), 'yyyy年M月', { locale: ja });
}

function formatDaysElapsed(value: string) {
  return Math.max(0, differenceInCalendarDays(new Date(), parseISO(value)));
}

function insuranceBasisLabel(value: MonthlyStats['patient_stats'][number]['insurance_basis']) {
  switch (value) {
    case 'medical':
      return '医療';
    case 'care':
      return '介護';
    default:
      return '医療+介護';
  }
}

function monthlyStatusMeta(value: MonthlyStats['patient_stats'][number]['status']) {
  switch (value) {
    case 'over_limit':
      return { label: '上限超過', variant: 'destructive' as const };
    case 'within_limit':
      return { label: '上限到達', variant: 'default' as const };
    default:
      return { label: '不足', variant: 'secondary' as const };
  }
}

function priorityVariant(value: string) {
  if (value === 'urgent' || value === 'high') return 'destructive' as const;
  if (value === 'medium') return 'default' as const;
  return 'outline' as const;
}

function workflowExceptionSeverityMeta(
  value: WorkflowDashboard['workflow_exceptions']['items'][number]['severity']
) {
  switch (value) {
    case 'critical':
      return { label: '重大', variant: 'destructive' as const };
    case 'warning':
      return { label: '警告', variant: 'default' as const };
    default:
      return { label: '参考', variant: 'secondary' as const };
  }
}

async function fetchJson<T>(url: string, orgId: string, fallbackMessage: string): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, {
      headers: { 'x-org-id': orgId },
    });
  } catch {
    const error = new AdminDashboardFetchError(
      'ネットワークエラーが発生しました。接続を確認してください。'
    );
    error.status = 0;
    throw error;
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { message?: string; code?: string }
      | null;
    const error = new AdminDashboardFetchError(payload?.message ?? fallbackMessage);
    error.status = res.status;
    error.code = payload?.code;
    throw error;
  }

  return res.json() as Promise<T>;
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: number;
  description: string;
  icon: ElementType;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-full border border-border bg-background p-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const percentage = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone =
    percentage >= 100 ? 'bg-emerald-500' : percentage >= 50 ? 'bg-blue-500' : 'bg-amber-400';

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-valuemin={0}
    >
      <div className={`h-full ${tone} transition-all`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

function MonthlyProgressSection({
  month,
  summary,
  items,
  onPreviousMonth,
  onNextMonth,
}: {
  month: string;
  summary: MonthlyStats['summary'];
  items: MonthlyStats['patient_stats'];
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-base">月間訪問回数進捗</CardTitle>
          <CardDescription>
            患者別・保険種別ごとの訪問回数と上限到達状況を確認します。
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <Button type="button" variant="outline" size="sm" onClick={onPreviousMonth}>
            <ChevronLeft className="mr-1 size-4" aria-hidden="true" />
            前月
          </Button>
          <Badge variant="outline" className="px-3 py-1 text-xs font-medium">
            {formatMonthLabel(month)}
          </Badge>
          <Button type="button" variant="outline" size="sm" onClick={onNextMonth}>
            翌月
            <ChevronRight className="ml-1 size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
            <p className="text-xs text-muted-foreground">対象患者</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {summary.total_patients}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-700">不足</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
              {summary.under_limit_count}
            </p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-xs text-red-700">上限超過</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-red-900">
              {summary.over_limit_count}
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="当月の訪問実績はありません"
            description="訪問記録が登録されると、患者ごとの進捗がここに表示されます。"
            action={{ label: '訪問記録へ移動', href: '/visits' }}
            className="min-h-[220px]"
          />
        ) : (
          <ul className="space-y-3" role="list">
            {items.map((item) => {
              const status = monthlyStatusMeta(item.status);
              return (
                <li
                  key={`${item.patient_id}:${item.insurance_basis}`}
                  className="rounded-2xl border border-border/70 bg-background px-4 py-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{item.patient_name}</p>
                        <Badge variant="outline">{insuranceBasisLabel(item.insurance_basis)}</Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.visit_count} / {item.monthly_limit} 回
                      </p>
                    </div>
                    <div className="min-w-32 text-left sm:text-right">
                      <p className="text-xs text-muted-foreground">到達率</p>
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {item.monthly_limit > 0
                          ? Math.round((item.visit_count / item.monthly_limit) * 100)
                          : 0}
                        %
                      </p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={item.visit_count} max={item.monthly_limit} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnrecordedVisitsSection({
  visits,
}: {
  visits: OverdueDashboard['unrecorded_visits'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">未記録訪問</CardTitle>
        <CardDescription>訪問完了前後の記録漏れを優先確認します。</CardDescription>
      </CardHeader>
      <CardContent>
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">未記録の訪問はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {visits.map((visit) => (
              <li key={visit.id} className="space-y-1 py-3">
                <p className="text-sm font-medium text-foreground">{visit.patient_name}</p>
                <p className="text-xs text-muted-foreground">
                  訪問日 {formatDateLabel(visit.scheduled_date)}
                </p>
                <Badge variant="outline">{visit.schedule_status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UnsentReportsSection({
  reports,
}: {
  reports: OverdueDashboard['unsent_reports'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">未送付報告書</CardTitle>
        <CardDescription>送達待ち、失敗、返信待ちの報告書を確認します。</CardDescription>
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">未送付の報告書はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {reports.map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{report.patient_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.report_type} / 更新 {formatDateLabel(report.updated_at)}
                  </p>
                </div>
                <Badge
                  variant={
                    report.status === 'failed' || report.status === 'response_waiting'
                      ? 'destructive'
                      : 'outline'
                  }
                >
                  {formatDaysElapsed(report.updated_at)}日経過
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OverdueTasksSection({
  tasks,
}: {
  tasks: OverdueDashboard['overdue_tasks'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">期限超過タスク</CardTitle>
        <CardDescription>SLA または期限を過ぎた業務タスクです。</CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">期限超過のタスクはありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {tasks.map((task) => (
              <li key={task.id} className="space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{task.title}</p>
                  <Badge variant={priorityVariant(task.priority)}>{task.priority}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{task.task_type}</p>
                <p className="text-xs text-muted-foreground">
                  期限 {task.sla_due_at ? formatDateLabel(task.sla_due_at) : task.due_date ? formatDateLabel(task.due_date) : '未設定'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowExceptionsSection({
  exceptions,
}: {
  exceptions: WorkflowDashboard['workflow_exceptions']['items'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ワークフロー例外</CardTitle>
        <CardDescription>未解消の例外と患者影響を一覧します。</CardDescription>
      </CardHeader>
      <CardContent>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">未解消の例外はありません。</p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {exceptions.map((exception) => {
              const severity = workflowExceptionSeverityMeta(exception.severity);
              return (
                <li key={exception.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {exception.patient_name ?? '患者未紐付け'}
                      </p>
                      <p className="text-xs text-muted-foreground">{exception.description}</p>
                    </div>
                    <Badge variant={severity.variant}>{severity.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{exception.exception_type}</p>
                  <p className="text-xs text-muted-foreground">
                    発生 {formatDateLabel(exception.created_at)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminDashboardContent() {
  const orgId = useOrgId();
  const [selectedMonth, setSelectedMonth] = useState(createMonthCursor);
  const currentMonth = monthParam(selectedMonth);

  const overdueQuery = useQuery<OverdueDashboard, AdminDashboardFetchError>({
    queryKey: ['dashboard', 'overdue', orgId],
    queryFn: () =>
      fetchJson<OverdueDashboard>(
        '/api/dashboard/overdue',
        orgId,
        '期限超過ダッシュボードの取得に失敗しました。'
      ),
    staleTime: 60_000,
    retry: false,
    enabled: !!orgId,
  });

  const monthlyStatsQuery = useQuery<MonthlyStats, AdminDashboardFetchError>({
    queryKey: ['dashboard', 'monthly-stats', orgId, currentMonth],
    queryFn: () =>
      fetchJson<MonthlyStats>(
        `/api/dashboard/monthly-stats?month=${currentMonth}`,
        orgId,
        '月間訪問回数進捗の取得に失敗しました。'
      ),
    staleTime: 60_000,
    retry: false,
    enabled: !!orgId,
  });

  const workflowQuery = useQuery<{ data: WorkflowDashboard }, AdminDashboardFetchError>({
    queryKey: ['dashboard', 'workflow', orgId],
    queryFn: () =>
      fetchJson<{ data: WorkflowDashboard }>(
        '/api/dashboard/workflow',
        orgId,
        'ワークフロー例外の取得に失敗しました。'
      ),
    staleTime: 60_000,
    retry: false,
    enabled: !!orgId,
  });

  const firstError =
    overdueQuery.error ?? monthlyStatsQuery.error ?? workflowQuery.error ?? null;

  if (!orgId) {
    return <Loading label="組織情報を読み込み中..." />;
  }

  if (
    (overdueQuery.isLoading && !overdueQuery.data) ||
    (monthlyStatsQuery.isLoading && !monthlyStatsQuery.data) ||
    (workflowQuery.isLoading && !workflowQuery.data)
  ) {
    return <Loading label="管理者ダッシュボードを読み込み中..." />;
  }

  if (firstError) {
    const variant =
      firstError.status === 401
        ? 'unauthorized'
        : firstError.status === 403
          ? 'forbidden'
          : firstError.status === 0
            ? 'network'
            : 'server';

    return (
      <ErrorState
        variant={variant}
        title="管理者ダッシュボードを読み込めませんでした"
        description={firstError.message}
        action={{
          label: '再試行',
          onClick: () => {
            void overdueQuery.refetch();
            void monthlyStatsQuery.refetch();
            void workflowQuery.refetch();
          },
        }}
        secondaryAction={{
          label: 'ホームへ移動',
          href: '/dashboard',
          variant: 'outline',
        }}
      />
    );
  }

  const overdue = overdueQuery.data;
  const monthlyStats = monthlyStatsQuery.data;
  const workflow = workflowQuery.data?.data;

  const summaryCards = [
    {
      title: '未記録訪問',
      value: overdue?.summary.unrecorded_visits ?? 0,
      description: '訪問記録の未登録件数',
      icon: ClipboardList,
    },
    {
      title: '未送付報告',
      value: overdue?.summary.unsent_reports ?? 0,
      description: '送達待ち・失敗・返信待ち',
      icon: FileClock,
    },
    {
      title: '月間超過患者',
      value: monthlyStats?.summary.over_limit_count ?? 0,
      description: '上限回数を超えた患者',
      icon: CalendarRange,
    },
    {
      title: '未解消例外',
      value: workflow?.workflow_exceptions.open ?? 0,
      description: 'ワークフロー例外の残件',
      icon: ShieldAlert,
    },
  ] as const;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <SummaryCard key={card.title} {...card} />
        ))}
      </div>

      <MonthlyProgressSection
        month={monthlyStats?.month ?? currentMonth}
        summary={
          monthlyStats?.summary ?? {
            total_patients: 0,
            over_limit_count: 0,
            within_limit_count: 0,
            under_limit_count: 0,
          }
        }
        items={monthlyStats?.patient_stats ?? []}
        onPreviousMonth={() => setSelectedMonth((value) => addMonths(value, -1))}
        onNextMonth={() => setSelectedMonth((value) => addMonths(value, 1))}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <UnrecordedVisitsSection visits={overdue?.unrecorded_visits ?? []} />
        <UnsentReportsSection reports={overdue?.unsent_reports ?? []} />
        <OverdueTasksSection tasks={overdue?.overdue_tasks ?? []} />
        <WorkflowExceptionsSection
          exceptions={workflow?.workflow_exceptions.items ?? []}
        />
      </div>

      {(overdue?.summary.total ?? 0) === 0 &&
      (workflow?.workflow_exceptions.open ?? 0) === 0 &&
      (monthlyStats?.summary.over_limit_count ?? 0) === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="現時点で重大な滞留はありません"
          description="未記録訪問、未送付報告、期限超過タスク、例外が発生するとここに表示されます。"
          action={{ label: 'ワークフローを開く', href: '/workflow' }}
        />
      ) : null}
    </div>
  );
}
