'use client';

import { Calendar, Car, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

export interface DashboardToday {
  visits?: {
    total: number;
    completed: number;
    pending: number;
    in_preparation: number;
    ready: number;
    cancelled: number;
  };
  tasks?: {
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
  reports_backlog?: Array<{
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
  communication_queue?: {
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
  role_focus?: {
    role: string;
    items: Array<{
      label: string;
      count: number;
      action_href: string;
    }>;
  };
}

export type WorkflowDashboard = Record<string, unknown>;

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
              </div>
              <VisitStatusBadge status={visit.status} />
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
    if (item.source_type === 'refill') return 'リフィル';
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

function ReportsBacklogSection({
  reports,
}: {
  reports: NonNullable<DashboardToday['reports_backlog']>;
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

export function DashboardOverview({
  today,
}: {
  today: DashboardToday;
  workflow?: WorkflowDashboard;
}) {
  const visits = today.today_visits ?? [];
  const deadlines = today.medication_deadlines ?? [];
  const reports = today.reports_backlog ?? [];

  return (
    <div className="space-y-8">
      <TodayVisitsSection visits={visits} />
      <MedicationDeadlinesSection items={deadlines} />
      <ReportsBacklogSection reports={reports} />
    </div>
  );
}
