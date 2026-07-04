'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, BarChart3, FileCheck2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatCard } from '@/components/ui/stat-card';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildAdminStaffMetricsApiPath } from '@/lib/staff-metrics/api-paths';

type StaffMetricItem = {
  id: string;
  name: string;
  name_kana: string | null;
  email: string;
  role: string;
  site_name: string | null;
  monthly_visit_count: number;
  assigned_patient_count: number;
  avg_visit_minutes: number | null;
  report_submission_rate: number;
  shift_days: number;
  shift_hours: number;
  workload_balance_delta_percent: number;
  workload_utilization_percent: number | null;
  max_weekly_visits: number | null;
  max_travel_minutes: number | null;
};

type StaffMetricsResponse = {
  data: {
    month: string;
    summary: {
      total_staff: number;
      avg_monthly_visits: number;
      avg_report_submission_rate: number;
      overloaded_count: number;
      underutilized_count: number;
    };
    items: StaffMetricItem[];
  };
};

function balanceBadge(delta: number) {
  if (delta >= 20) {
    return <Badge variant="destructive">高負荷 +{delta}%</Badge>;
  }
  if (delta <= -20) {
    return <Badge variant="secondary">余力あり {delta}%</Badge>;
  }
  return <Badge variant="outline">均衡 {delta > 0 ? `+${delta}` : delta}%</Badge>;
}

export function StaffKpiPanel() {
  const orgId = useOrgId();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['staff-kpi', orgId, month],
    queryFn: async () => {
      const response = await fetch(buildAdminStaffMetricsApiPath(new URLSearchParams({ month })), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<StaffMetricsResponse>(response, 'スタッフKPIの取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const items = data?.data.items ?? [];
  const summary = data?.data.summary;

  const columns = useMemo<ColumnDef<StaffMetricItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '担当者',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.site_name ?? '店舗未設定'} / {row.original.role}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'monthly_visit_count',
        header: '月間訪問数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.monthly_visit_count}件</span>
        ),
      },
      {
        accessorKey: 'assigned_patient_count',
        header: '担当患者数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.assigned_patient_count}名</span>
        ),
      },
      {
        accessorKey: 'avg_visit_minutes',
        header: '平均訪問時間',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.avg_visit_minutes != null ? `${row.original.avg_visit_minutes}分` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'report_submission_rate',
        header: '報告書提出率',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">{row.original.report_submission_rate}%</span>
        ),
      },
      {
        accessorKey: 'shift_days',
        header: '勤務日数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.shift_days}日 / {row.original.shift_hours}h
          </span>
        ),
      },
      {
        accessorKey: 'workload_balance_delta_percent',
        header: 'バランス',
        cell: ({ row }) => balanceBadge(row.original.workload_balance_delta_percent),
      },
      {
        accessorKey: 'workload_utilization_percent',
        header: '稼働率',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.workload_utilization_percent != null
              ? `${row.original.workload_utilization_percent}%`
              : '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4" data-ready={!isLoading} data-testid="staff-kpi-panel">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="staff-kpi-month">対象月</Label>
          <Input
            id="staff-kpi-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            suppressHydrationWarning
            className="w-[220px]"
          />
        </div>
      </div>

      {isError ? (
        // 取得失敗時は KPI を false-zero(0名/0件/0%)・空テーブルにせず、再読み込み導線を示す。
        <ErrorState
          size="inline"
          description="スタッフKPIを取得できませんでした。時間をおいて再読み込みしてください。"
          onRetry={() => void refetch()}
          retryLabel="再読み込み"
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Users className="size-4" aria-hidden="true" />}
              label="対象スタッフ"
              value={summary?.total_staff ?? 0}
              unit="名"
              hint="KPI 集計対象"
            />
            <StatCard
              icon={<BarChart3 className="size-4" aria-hidden="true" />}
              label="平均月間訪問"
              value={summary?.avg_monthly_visits ?? 0}
              unit="件"
              hint="実績ベース"
            />
            <StatCard
              icon={<FileCheck2 className="size-4" aria-hidden="true" />}
              label="平均提出率"
              value={summary?.avg_report_submission_rate ?? 0}
              unit="%"
              hint="CareReport 作成率"
            />
            <StatCard
              icon={<AlertTriangle className="size-4" aria-hidden="true" />}
              label="負荷偏り"
              value={`${summary?.overloaded_count ?? 0} / ${summary?.underutilized_count ?? 0}`}
              hint="高負荷 / 余力あり"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">薬剤師別 KPI</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={columns}
                data={items}
                isLoading={isLoading}
                caption="薬剤師別 KPI 一覧"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
