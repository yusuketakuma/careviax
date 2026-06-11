'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { Filter, Play } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatDateTimeLabel } from '@/lib/ui/date-format';

// --- Types ---

type IntegrationJobRun = {
  id: string;
  job_type: string;
  status: string;
  output: unknown;
  error_log: string | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type JobDefinitionEntry = {
  job_type: string;
  schedule_hint: string;
  endpoint: string;
  latest_run: IntegrationJobRun | null;
  latest_export_run?: IntegrationJobRun | null;
};

// --- Constants ---

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'pending', label: '待機中' },
  { value: 'running', label: '実行中' },
  { value: 'completed', label: '完了' },
  { value: 'failed', label: '失敗' },
];

const SOURCE_FILTER_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'daily', label: '毎朝 (daily)' },
  { value: 'evening', label: '毎夕 (evening)' },
  { value: 'monthly', label: '毎月 (monthly)' },
  { value: 'drug', label: '薬剤マスタ (drug)' },
  { value: 'pmda', label: 'PMDA' },
  { value: 'medication-history', label: '薬歴エクスポート' },
  { value: 'next-day', label: '翌営業日 (next-day)' },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:   { label: '待機中', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  running:   { label: '実行中', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  completed: { label: '完了',   className: 'bg-green-100 text-green-800 border-green-200' },
  failed:    { label: '失敗',   className: 'bg-red-100 text-red-800 border-red-200' },
};

type BulkExportRunSummary = {
  requestedCount: number | null;
  successfulCount: number | null;
  failedCount: number;
};

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getBulkExportRunSummary(run: IntegrationJobRun | null): BulkExportRunSummary | null {
  if (!run || !run.job_type.startsWith('medication-history-bulk-export')) return null;
  if (!run.output || typeof run.output !== 'object' || Array.isArray(run.output)) return null;

  const output = run.output as Record<string, unknown>;
  const failedCount = readNumber(output.failedCount);
  if (!failedCount || failedCount <= 0) return null;

  return {
    requestedCount: readNumber(output.requestedCount),
    successfulCount: readNumber(output.patientCount) ?? readNumber(output.successfulCount),
    failedCount,
  };
}

function getJobBulkExportRunSummary(entry: JobDefinitionEntry) {
  return getBulkExportRunSummary(entry.latest_export_run ?? entry.latest_run);
}

function formatBulkExportSummary(summary: BulkExportRunSummary) {
  const successfulText = summary.successfulCount == null ? null : `成功 ${summary.successfulCount}件`;
  const totalText = summary.requestedCount == null ? null : `対象 ${summary.requestedCount}件`;
  return [totalText, successfulText, `失敗 ${summary.failedCount}件`].filter(Boolean).join(' / ');
}

function matchesSourceFilter(jobType: string, source: string): boolean {
  if (!source) return true;
  if (source === 'daily') return jobType.startsWith('daily');
  if (source === 'evening') return jobType.startsWith('evening');
  if (source === 'monthly') return jobType === 'monthly';
  if (source === 'drug') return jobType.startsWith('drug');
  if (source === 'pmda') return jobType.startsWith('pmda');
  if (source === 'medication-history') return jobType.startsWith('medication-history');
  if (source === 'next-day') return jobType.startsWith('next-day');
  return true;
}

// --- Main ---

export function JobsDashboardContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['integration-jobs', orgId],
    queryFn: async () => {
      const res = await fetch('/api/jobs', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ジョブ一覧の取得に失敗しました');
      return res.json() as Promise<{ data: JobDefinitionEntry[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 15_000,
  });

  const rerunMutation = useMutation({
    mutationFn: async ({ endpoint, jobType }: { endpoint: string; jobType: string }) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ?? `ジョブ "${jobType}" の再実行に失敗しました`
        );
      }
      return jobType;
    },
    onSuccess: (jobType) => {
      toast.success(`ジョブ "${jobType}" を再実行しました`);
      void queryClient.invalidateQueries({ queryKey: ['integration-jobs', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'ジョブの再実行に失敗しました');
    },
  });

  const filteredJobs = useMemo(() => {
    const jobs = data?.data ?? [];
    return jobs.filter((entry) => {
      if (!matchesSourceFilter(entry.job_type, sourceFilter)) return false;
      if (statusFilter && entry.latest_run?.status !== statusFilter) return false;
      return true;
    });
  }, [data, statusFilter, sourceFilter]);

  const columns = useMemo<ColumnDef<JobDefinitionEntry>[]>(
    () => [
      {
        accessorKey: 'job_type',
        header: 'ジョブ種別',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-mono text-xs font-medium">{row.original.job_type}</p>
            <p className="text-xs text-muted-foreground">{row.original.schedule_hint}</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: '状態',
        cell: ({ row }) => {
          const status = row.original.latest_run?.status;
          if (!status) {
            return <span className="text-xs text-muted-foreground">未実行</span>;
          }
          const cfg = STATUS_CONFIG[status];
          return cfg ? (
            <Badge variant="outline" className={`text-xs ${cfg.className}`}>
              {cfg.label}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{status}</span>
          );
        },
        size: 90,
      },
      {
        id: 'started_at',
        header: '開始',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDateTimeLabel(row.original.latest_run?.started_at ?? null, { pattern: 'MM/dd HH:mm' })}
          </span>
        ),
        size: 110,
      },
      {
        id: 'completed_at',
        header: '完了',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDateTimeLabel(row.original.latest_run?.completed_at ?? null, { pattern: 'MM/dd HH:mm' })}
          </span>
        ),
        size: 110,
      },
      {
        id: 'retry',
        header: 'リトライ',
        cell: ({ row }) => {
          const run = row.original.latest_run;
          if (!run) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span className="text-xs tabular-nums text-muted-foreground">
              {run.retry_count}/{run.max_retries}
            </span>
          );
        },
        size: 70,
      },
      {
        id: 'error',
        header: '警告/エラー',
        cell: ({ row }) => {
          const run = row.original.latest_run;
          const summary = getJobBulkExportRunSummary(row.original);
          const err = run?.error_log;
          if (summary) {
            return (
              <span
                className="max-w-[220px] truncate text-xs text-amber-700"
                title={formatBulkExportSummary(summary)}
              >
                一部失敗 {summary.failedCount}件
              </span>
            );
          }
          if (!err) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span className="max-w-[200px] truncate text-xs text-red-600" title={err}>
              {err}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={rerunMutation.isPending}
            onClick={() =>
              rerunMutation.mutate({
                endpoint: row.original.endpoint,
                jobType: row.original.job_type,
              })
            }
          >
            <Play className="mr-1 size-3" aria-hidden="true" />
            再実行
          </Button>
        ),
        size: 90,
      },
    ],
    [rerunMutation]
  );

  function renderExpandedRow(row: Row<JobDefinitionEntry>) {
    const run = row.original.latest_run;
    const bulkExportSummary = getJobBulkExportRunSummary(row.original);
    if (!run?.error_log && !bulkExportSummary) return null;
    return (
      <div className="space-y-3 bg-red-50 px-4 py-3">
        {bulkExportSummary && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-800">一括出力の部分失敗</p>
            <p className="text-xs text-amber-800">{formatBulkExportSummary(bulkExportSummary)}</p>
            <p className="text-xs text-amber-900">詳細は監査ログと保管元ジョブを確認してください。</p>
          </div>
        )}
        {run?.error_log && (
          <div>
            <p className="mb-1 text-xs font-semibold text-red-700">エラーログ</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-red-800">
              {run.error_log}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const failedCount = (data?.data ?? []).filter((e) => e.latest_run?.status === 'failed').length;
  const runningCount = (data?.data ?? []).filter((e) => e.latest_run?.status === 'running').length;
  const partialWarningCount = (data?.data ?? []).filter((e) =>
    Boolean(getJobBulkExportRunSummary(e))
  ).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">登録ジョブ数</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{data?.data.length ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">実行中</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-yellow-600">{isLoading ? '—' : runningCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">失敗</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${failedCount > 0 ? 'text-red-600' : ''}`}>
              {isLoading ? '—' : failedCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">一部失敗</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${partialWarningCount > 0 ? 'text-amber-700' : ''}`}>
              {isLoading ? '—' : partialWarningCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4" aria-hidden="true" />
            フィルタ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="source-filter">ソース種別</Label>
              <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v ?? '')}>
                <SelectTrigger id="source-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status-filter">状態</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? '')}>
                <SelectTrigger id="status-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Count */}
      <p className="text-sm text-muted-foreground">{filteredJobs.length}件</p>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filteredJobs}
        isLoading={isLoading}
        caption="IntegrationJob 一覧"
        renderExpandedRow={renderExpandedRow}
        getRowId={(row) => row.job_type}
      />
    </div>
  );
}
