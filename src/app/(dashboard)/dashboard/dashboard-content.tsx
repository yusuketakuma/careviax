'use client';

import { useQuery } from '@tanstack/react-query';
import type { ElementType } from 'react';
import {
  Calendar,
  Car,
  CheckSquare,
  ClipboardList,
  MessageSquare,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';

interface DashboardToday {
  visits: {
    total: number;
    completed: number;
    pending: number;
    in_preparation: number;
    ready: number;
    cancelled: number;
  };
  tasks: {
    open: number;
  };
  today_visits: Array<{
    id: string;
    patient_name: string;
    address: string;
    scheduled_time: string | null;
    status: string;
    route_order: number | null;
    confirmed: boolean;
    preparation_ready: boolean;
    carry_items_status: string | null;
  }>;
  reports_backlog: Array<{
    id: string;
    patient_name: string;
    report_type: string;
    status: string;
    created_at: string;
    delivery_pending_count: number;
  }>;
  medication_deadlines: Array<{
    id: string;
    patient_name: string;
    due_at: string;
    days_left: number;
    source_type: string;
    split_dispense_total: number | null;
    split_dispense_current: number | null;
  }>;
  communication_queue: {
    summary: {
      pending_count: number;
      overdue_count: number;
      self_reports: number;
      callback_followups: number;
      open_requests: number;
      delivery_backlog: number;
      expiring_external_shares: number;
    };
    items: Array<{
      id: string;
      title: string;
      summary: string;
      channel: string;
      status: string;
      priority: 'urgent' | 'high' | 'normal';
      patient_name: string | null;
    }>;
  };
  role_focus: {
    role: string;
    items: Array<{
      label: string;
      count: number;
      action_href: string;
    }>;
  };
}

class DashboardFetchError extends Error {
  status?: number;
  code?: string;
}

async function fetchTodayStats(orgId: string): Promise<DashboardToday> {
  let res: Response;

  try {
    res = await fetch('/api/dashboard/today', {
      headers: { 'x-org-id': orgId },
    });
  } catch {
    const error = new DashboardFetchError(
      'ネットワークエラーが発生しました。接続を確認してください。'
    );
    error.status = 0;
    throw error;
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as
      | { message?: string; code?: string }
      | null;
    const error = new DashboardFetchError(
      payload?.message ?? 'ダッシュボード情報の取得に失敗しました。'
    );
    error.status = res.status;
    error.code = payload?.code;
    throw error;
  }

  return res.json();
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
}: {
  title: string;
  value: string | number;
  icon: ElementType;
  description: string;
  trend?: 'up' | 'down' | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-foreground">{value}</div>
          {trend === 'up' && (
            <TrendingUp className="h-4 w-4 text-orange-500" aria-label="増加傾向" />
          )}
          {trend === 'down' && (
            <TrendingDown className="h-4 w-4 text-green-500" aria-label="減少傾向" />
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function VisitStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    planned: { label: '予定', variant: 'outline' },
    in_preparation: { label: '準備中', variant: 'secondary' },
    ready: { label: '準備完了', variant: 'default' },
    departed: { label: '出発', variant: 'default' },
    in_progress: { label: '訪問中', variant: 'default' },
    completed: { label: '完了', variant: 'secondary' },
    cancelled: { label: 'キャンセル', variant: 'destructive' },
  };
  const config = map[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function TodayVisitsSection({ visits }: { visits: DashboardToday['today_visits'] }) {
  return (
    <section aria-labelledby="today-visits-heading">
      <h2 id="today-visits-heading" className="mb-3 text-base font-semibold text-foreground">
        本日の訪問（上位5件）
      </h2>
      {visits.length === 0 ? (
        <EmptyState
          icon={Car}
          title="本日の訪問予定はありません"
          description="訪問予定を追加すると、ここに優先順で表示されます。"
          action={{ label: 'スケジュールを開く', href: '/schedules' }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {visits.map((visit) => (
            <li key={visit.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{visit.patient_name}</p>
                <p className="text-xs text-muted-foreground">{visit.address}</p>
                <p className="text-xs text-muted-foreground">
                  {visit.route_order ? `ルート ${visit.route_order} / ` : ''}
                  {visit.confirmed ? '確定済み' : '未確定'}
                  {visit.carry_items_status ? ` / 持参物 ${visit.carry_items_status}` : ''}
                </p>
              </div>
              <VisitStatusBadge status={visit.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportsBacklogSection({
  reports,
}: {
  reports: DashboardToday['reports_backlog'];
}) {
  return (
    <section aria-labelledby="unsent-reports-heading">
      <h2 id="unsent-reports-heading" className="mb-3 text-base font-semibold text-foreground">
        報告送達・下書き待ち
      </h2>
      {reports.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="未送付の報告書はありません"
          description="報告書の下書きや送達待ちが発生すると、ここから確認できます。"
          action={{ label: '報告一覧を開く', href: '/reports' }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {reports.map((report) => (
            <li key={report.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{report.patient_name}</p>
                <p className="text-xs text-muted-foreground">
                  {report.report_type} / {report.status}
                </p>
              </div>
              <Badge variant={report.delivery_pending_count > 0 ? 'destructive' : 'outline'}>
                {report.delivery_pending_count > 0 ? `送達待ち ${report.delivery_pending_count}` : '下書き'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MedicationDeadlinesSection({
  items,
}: {
  items: DashboardToday['medication_deadlines'];
}) {
  const sourceLabel = (item: DashboardToday['medication_deadlines'][number]) => {
    if (item.source_type === 'refill') {
      return 'リフィル';
    }
    if (item.split_dispense_total != null && item.split_dispense_current != null) {
      return `分割調剤 ${item.split_dispense_current}/${item.split_dispense_total}`;
    }
    return item.source_type;
  };

  return (
    <section aria-labelledby="med-records-heading">
      <h2 id="med-records-heading" className="mb-3 text-base font-semibold text-foreground">
        服薬・処方期限接近
      </h2>
      {items.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="直近の期限接近はありません"
          description="服薬や処方期限が近づいた患者が出ると、ここに警告が表示されます。"
          action={{ label: '患者一覧を開く', href: '/patients' }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{item.patient_name}</p>
                <p className="text-xs text-muted-foreground">{sourceLabel(item)}</p>
              </div>
              <Badge variant={item.days_left <= 3 ? 'destructive' : 'outline'}>
                残{item.days_left}日
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CommunicationQueueSection({
  queue,
  roleFocus,
}: {
  queue: DashboardToday['communication_queue'];
  roleFocus: DashboardToday['role_focus'];
}) {
  return (
    <section aria-labelledby="communication-queue-heading">
      <h2 id="communication-queue-heading" className="mb-3 text-base font-semibold text-foreground">
        本日の受信箱
      </h2>
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {roleFocus.items.map((item) => (
            <Badge key={item.label} variant="outline">
              {item.label} {item.count}
            </Badge>
          ))}
        </div>
        {queue.items.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="未処理の連絡はありません"
            description="自己申告や多職種連携依頼が届くと、ここから優先度順に確認できます。"
            action={{ label: '連携一覧を開く', href: '/communications/requests' }}
            className="border-0 px-0 py-4"
          />
        ) : (
          <div className="space-y-3">
            {queue.items.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <Badge variant={item.priority === 'urgent' ? 'destructive' : 'outline'}>
                    {item.channel}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function DashboardContent() {
  const orgId = useOrgId();
  const { data, error, isLoading, isError, refetch } = useQuery<
    DashboardToday,
    DashboardFetchError
  >({
    queryKey: ['dashboard', 'today', orgId],
    queryFn: () => fetchTodayStats(orgId),
    staleTime: 60_000,
    retry: false,
    enabled: !!orgId,
  });

  if (!orgId) {
    return <Loading label="組織情報を読み込み中..." />;
  }

  if (isError) {
    const variant =
      error.status === 401
        ? 'unauthorized'
        : error.status === 403
          ? 'forbidden'
          : error.status === 0
            ? 'network'
            : 'server';

    return (
      <ErrorState
        variant={variant}
        title="ダッシュボードを読み込めませんでした"
        description={error.message}
        action={{ label: '再試行', onClick: () => void refetch() }}
        secondaryAction={{
          label: 'スケジュールへ移動',
          href: '/schedules',
          variant: 'outline',
        }}
      />
    );
  }

  const visitTotal = data?.visits.total ?? 0;
  const visitPending = data?.tasks.open ?? 0;
  const communicationPending = data?.communication_queue.summary.pending_count ?? 0;
  const deadlines = data?.medication_deadlines.length ?? 0;

  const summaryCards = [
    {
      title: '本日の訪問',
      value: isLoading ? '...' : isError ? '-' : `${visitTotal}件`,
      icon: Car,
      description: '予定された訪問件数',
      trend: null,
    },
    {
      title: '未完了タスク',
      value: isLoading ? '...' : isError ? '-' : `${visitPending}件`,
      icon: CheckSquare,
      description: '本日処理したい業務タスク',
      trend: visitPending > 0 ? ('up' as const) : null,
    },
    {
      title: '連絡待ち',
      value: isLoading ? '...' : isError ? '-' : `${communicationPending}件`,
      icon: MessageSquare,
      description: '自己申告・再架電・多職種依頼',
      trend: communicationPending > 0 ? ('up' as const) : null,
    },
    {
      title: '期限接近',
      value: isLoading ? '...' : isError ? '-' : `${deadlines}件`,
      icon: Calendar,
      description: '7日以内の服薬・処方期限',
      trend: null,
    },
  ] as const;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <SummaryCard key={card.title} {...card} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TodayVisitsSection visits={data?.today_visits ?? []} />
        <CommunicationQueueSection
          queue={
            data?.communication_queue ?? {
              summary: {
                pending_count: 0,
                overdue_count: 0,
                self_reports: 0,
                callback_followups: 0,
                open_requests: 0,
                delivery_backlog: 0,
                expiring_external_shares: 0,
              },
              items: [],
            }
          }
          roleFocus={data?.role_focus ?? { role: 'pharmacist', items: [] }}
        />
        <ReportsBacklogSection reports={data?.reports_backlog ?? []} />
        <MedicationDeadlinesSection items={data?.medication_deadlines ?? []} />
      </div>
    </div>
  );
}
