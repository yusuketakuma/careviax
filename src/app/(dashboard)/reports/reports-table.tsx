'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import Link from 'next/link';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { REPORT_TYPE_LABELS, REPORT_STATUS_CONFIG } from '@/lib/constants/status-labels';

// --- Types ---

type DeliveryRecord = {
  id: string;
  channel: string;
  recipient_name: string;
  status: string;
  sent_at: string | null;
};

type CareReport = {
  id: string;
  patient_id: string;
  report_type: string;
  status: string;
  created_at: string;
  delivery_records: DeliveryRecord[];
};

const ALL_VALUE = '_all';

// --- Main ---

export function ReportsTable() {
  const orgId = useOrgId();
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE);
  const [reportTypeFilter, setReportTypeFilter] = useState<string>(ALL_VALUE);

  const queryParams = new URLSearchParams({ limit: '50' });
  if (statusFilter !== ALL_VALUE) queryParams.set('status', statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['care-reports', orgId, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/care-reports?${queryParams.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('報告書一覧の取得に失敗しました');
      return res.json() as Promise<{ data: CareReport[]; hasMore: boolean }>;
    },
    enabled: !!orgId,
  });

  const reports = useMemo(() => {
    const allReports = data?.data ?? [];
    if (reportTypeFilter === ALL_VALUE) return allReports;
    return allReports.filter((r) => r.report_type === reportTypeFilter);
  }, [data, reportTypeFilter]);

  const columns = useMemo<ColumnDef<CareReport>[]>(
    () => [
      {
        accessorKey: 'report_type',
        header: '報告書タイプ',
        cell: ({ row }) => (
          <Link
            href={`/reports/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {REPORT_TYPE_LABELS[row.original.report_type] ?? row.original.report_type}
          </Link>
        ),
      },
      {
        accessorKey: 'patient_id',
        header: '患者ID',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.patient_id}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'ステータス',
        cell: ({ row }) => {
          const cfg = REPORT_STATUS_CONFIG[row.original.status];
          if (!cfg) {
            return (
              <span className="text-xs text-muted-foreground">{row.original.status}</span>
            );
          }
          return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
        },
      },
      {
        id: 'recipient',
        header: '送付先',
        cell: ({ row }) => {
          const first = row.original.delivery_records[0];
          return (
            <span className="text-sm">
              {first?.recipient_name ?? <span className="text-muted-foreground">—</span>}
            </span>
          );
        },
      },
      {
        accessorKey: 'created_at',
        header: '作成日',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {format(new Date(row.original.created_at), 'yyyy/MM/dd', { locale: ja })}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? ALL_VALUE)}>
          <SelectTrigger className="w-[160px]" aria-label="ステータスフィルタ">
            <SelectValue placeholder="ステータス" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>すべてのステータス</SelectItem>
            {Object.entries(REPORT_STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={reportTypeFilter}
          onValueChange={(v) => setReportTypeFilter(v ?? ALL_VALUE)}
        >
          <SelectTrigger className="w-[200px]" aria-label="報告書タイプフィルタ">
            <SelectValue placeholder="報告書タイプ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>すべてのタイプ</SelectItem>
            {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={reports}
        isLoading={isLoading}
        caption="報告書一覧"
      />

      {!isLoading && reports.length === 0 && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
          <p className="text-sm text-muted-foreground">報告書がありません</p>
        </div>
      )}
    </div>
  );
}
