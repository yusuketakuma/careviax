'use client';

import { useQuery } from '@tanstack/react-query';
import { Car, CheckSquare, MessageSquare, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// --- Types ---

interface DashboardToday {
  visits: {
    total: number;
    completed: number;
    pending: number;
    in_preparation: number;
    ready: number;
    cancelled: number;
  };
}

interface VisitItem {
  id: string;
  patientName: string;
  address: string;
  scheduledTime: string | null;
  status: string;
}

interface ReportItem {
  id: string;
  patientName: string;
  visitDate: string;
  reportType: string;
}

interface MedicationDeadlineItem {
  id: string;
  patientName: string;
  endDate: string;
  daysLeft: number;
}

// --- Fetchers ---

async function fetchTodayStats(): Promise<DashboardToday> {
  const res = await fetch('/api/dashboard/today');
  if (!res.ok) throw new Error('Failed to fetch today stats');
  return res.json();
}

// --- Summary Cards ---

function SummaryCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
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

// --- Status Badge ---

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

// --- Section: Today's Visits ---

function TodayVisitsSection() {
  // Placeholder list — replaced by real API when visits list endpoint is available
  const visits: VisitItem[] = [];

  return (
    <section aria-labelledby="today-visits-heading">
      <h2
        id="today-visits-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        本日の訪問（上位5件）
      </h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">本日の訪問予定はありません。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {visits.map((v) => (
            <li key={v.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{v.patientName}</p>
                <p className="text-xs text-muted-foreground">{v.address}</p>
                {v.scheduledTime && (
                  <p className="text-xs text-muted-foreground">{v.scheduledTime}</p>
                )}
              </div>
              <VisitStatusBadge status={v.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Section: Unsent Reports ---

function UnsentReportsSection() {
  const reports: ReportItem[] = [];

  return (
    <section aria-labelledby="unsent-reports-heading">
      <h2
        id="unsent-reports-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        未送付報告書（上位5件）
      </h2>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">未送付の報告書はありません。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{r.patientName}</p>
                <p className="text-xs text-muted-foreground">
                  {r.reportType} — {r.visitDate}
                </p>
              </div>
              <Badge variant="destructive">未送付</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Section: Medication Records Pending ---

function MedicationRecordsPendingSection() {
  const items: MedicationDeadlineItem[] = [];

  return (
    <section aria-labelledby="med-records-heading">
      <h2
        id="med-records-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        薬歴未記入（上位5件）
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">未記入の薬歴はありません。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border" role="list">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{item.patientName}</p>
                <p className="text-xs text-muted-foreground">服用終了: {item.endDate}</p>
              </div>
              <Badge variant={item.daysLeft <= 3 ? 'destructive' : 'outline'}>
                残{item.daysLeft}日
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Main Component ---

export function DashboardContent() {
  const { data, isLoading, isError } = useQuery<DashboardToday>({
    queryKey: ['dashboard', 'today'],
    queryFn: fetchTodayStats,
    staleTime: 60_000,
    retry: false,
  });

  const visitTotal = data?.visits.total ?? 0;
  const visitPending = data?.visits.pending ?? 0;

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
      description: '対応が必要なタスク',
      trend: visitPending > 0 ? ('up' as const) : null,
    },
    {
      title: '返信待ち',
      value: '0件',
      icon: MessageSquare,
      description: '未読メッセージ・返信待ち',
      trend: null,
    },
    {
      title: '服用最終日接近',
      value: '0件',
      icon: Calendar,
      description: '7日以内に服用終了の患者',
      trend: null,
    },
  ] as const;

  return (
    <div className="p-6 space-y-8">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <SummaryCard key={card.title} {...card} />
        ))}
      </div>

      {/* Lower sections */}
      <div className="grid gap-6 lg:grid-cols-3">
        <TodayVisitsSection />
        <UnsentReportsSection />
        <MedicationRecordsPendingSection />
      </div>
    </div>
  );
}
