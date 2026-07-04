'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type Row } from '@tanstack/react-table';
import { AlertTriangle, Filter, Play } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { SkeletonRows } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
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
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatDateTimeLabel } from '@/lib/ui/date-format';
import { messageFromError } from '@/lib/utils/error-message';

// --- Types ---

// Structured, pre-redacted error summary. `message` is always the fixed,
// already-sanitized wording returned by the API — never the raw error_log
// text — so this screen can never render token/password/patient-name
// content even if a future bug writes an unsanitized error_log.
type JobErrorSummary = {
  error_name: string;
  occurred_at: string | null;
  message: string;
};

type IntegrationJobRun = {
  id: string;
  job_type: string;
  status: string;
  output: unknown;
  error_summary: JobErrorSummary | null;
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

const JOBS_REFETCH_INTERVAL_MS = 60_000;

// ジョブ実行状態: 待機中=neutral(キュー待ち) / 実行中=info(現在進行) / 完了=done / 失敗=blocked
const STATUS_CONFIG: Record<string, { label: string; role: StatusRole | 'neutral' }> = {
  pending: { label: '待機中', role: 'neutral' },
  running: { label: '実行中', role: 'info' },
  completed: { label: '完了', role: 'done' },
  failed: { label: '失敗', role: 'blocked' },
};

type BulkExportRunSummary = {
  requestedCount: number | null;
  successfulCount: number | null;
  failedCount: number;
};

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getBulkExportRunSummary(
  run: IntegrationJobRun | null,
): BulkExportRunSummary | null {
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
  const successfulText =
    summary.successfulCount == null ? null : `成功 ${summary.successfulCount}件`;
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

function getAttentionReason(entry: JobDefinitionEntry) {
  const summary = getJobBulkExportRunSummary(entry);
  if (entry.latest_run?.status === 'failed') return 'failed';
  if (summary) return 'partial';
  if (entry.latest_run?.status === 'running') return 'running';
  return null;
}

// --- Main ---

export function JobsDashboardContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['integration-jobs', orgId],
    queryFn: async () => {
      const res = await fetch('/api/jobs', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: JobDefinitionEntry[] }>(res, 'ジョブ一覧の取得に失敗しました');
    },
    enabled: !!orgId,
    refetchInterval: JOBS_REFETCH_INTERVAL_MS,
  });

  const rerunMutation = useMutation({
    mutationFn: async ({ endpoint, jobType }: { endpoint: string; jobType: string }) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          (payload as { message?: string }).message ?? `ジョブ "${jobType}" の再実行に失敗しました`,
        );
      }
      return jobType;
    },
    onSuccess: (jobType) => {
      toast.success(`ジョブ "${jobType}" を再実行しました`);
      void queryClient.invalidateQueries({ queryKey: ['integration-jobs', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'ジョブの再実行に失敗しました'));
    },
  });

  const jobs = data?.data ?? [];
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
          if (!cfg) {
            return <span className="text-xs text-muted-foreground">{status}</span>;
          }
          return cfg.role === 'neutral' ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {cfg.label}
            </Badge>
          ) : (
            <StateBadge role={cfg.role} className="text-xs">
              {cfg.label}
            </StateBadge>
          );
        },
        size: 90,
      },
      {
        id: 'started_at',
        header: '開始',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDateTimeLabel(row.original.latest_run?.started_at ?? null, {
              pattern: 'MM/dd HH:mm',
            })}
          </span>
        ),
        size: 110,
      },
      {
        id: 'completed_at',
        header: '完了',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDateTimeLabel(row.original.latest_run?.completed_at ?? null, {
              pattern: 'MM/dd HH:mm',
            })}
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
          const errorSummary = run?.error_summary;
          if (summary) {
            return (
              <span
                className="max-w-[220px] truncate text-xs text-state-confirm"
                title={formatBulkExportSummary(summary)}
              >
                一部失敗 {summary.failedCount}件
              </span>
            );
          }
          if (!errorSummary) return <span className="text-xs text-muted-foreground">—</span>;
          const tooltip = `${errorSummary.error_name} / リトライ ${run?.retry_count}/${run?.max_retries}回`;
          return (
            <span className="max-w-[200px] truncate text-xs text-destructive" title={tooltip}>
              {errorSummary.error_name}
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
            className="!h-11 !min-h-[44px] !min-w-11 px-3 text-xs"
            aria-label={`${row.original.job_type} を再実行`}
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
    [rerunMutation],
  );

  function renderExpandedRow(row: Row<JobDefinitionEntry>) {
    const run = row.original.latest_run;
    const errorSummary = run?.error_summary;
    const bulkExportSummary = getJobBulkExportRunSummary(row.original);
    if (!errorSummary && !bulkExportSummary) return null;
    return (
      <div className="space-y-3 bg-destructive/10 px-4 py-3">
        {bulkExportSummary && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-state-confirm">一括出力の部分失敗</p>
            <p className="text-xs text-state-confirm">
              {formatBulkExportSummary(bulkExportSummary)}
            </p>
            <p className="text-xs text-state-confirm">
              詳細は監査ログと保管元ジョブを確認してください。
            </p>
          </div>
        )}
        {errorSummary && run && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-destructive">エラー概要</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs text-destructive">
              <dt className="text-muted-foreground">種別</dt>
              <dd>{errorSummary.error_name}</dd>
              <dt className="text-muted-foreground">ジョブ</dt>
              <dd className="font-mono">{run.job_type}</dd>
              <dt className="text-muted-foreground">発生時刻</dt>
              <dd className="tabular-nums">
                {formatDateTimeLabel(errorSummary.occurred_at, { pattern: 'MM/dd HH:mm' })}
              </dd>
              <dt className="text-muted-foreground">リトライ</dt>
              <dd className="tabular-nums">
                {run.retry_count}/{run.max_retries}
              </dd>
            </dl>
            <p className="text-xs text-destructive">{errorSummary.message}</p>
            <p className="text-xs text-muted-foreground">
              詳細な生ログが必要な場合は CloudWatch を参照してください（本画面には表示されません）。
            </p>
          </div>
        )}
      </div>
    );
  }

  const failedCount = jobs.filter((e) => e.latest_run?.status === 'failed').length;
  const runningCount = jobs.filter((e) => e.latest_run?.status === 'running').length;
  const partialWarningCount = jobs.filter((e) => Boolean(getJobBulkExportRunSummary(e))).length;
  const attentionJobs = jobs.filter((entry) => getAttentionReason(entry));
  const jobCountsUnavailable = (isLoading || isError) && !data;
  const jobCountsLoadingUnavailable = isLoading && !data;
  const jobCountsErrorUnavailable = isError && !data;

  return (
    <div className="space-y-4 [&_[data-slot=select-trigger]]:!h-11 [&_[data-slot=select-trigger]]:!min-h-[44px] [&_button]:!min-h-[44px] [&_button]:!min-w-11">
      <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
              対応が必要なジョブ
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              失敗・一部失敗・実行中を先に確認し、対象ジョブの近くで再実行します。
            </p>
          </div>
          <Badge variant={attentionJobs.length > 0 ? 'destructive' : 'outline'}>
            {jobCountsUnavailable ? '—' : `${attentionJobs.length}件`}
          </Badge>
        </div>

        {jobCountsLoadingUnavailable ? (
          <div
            role="status"
            aria-label="対応が必要なジョブを読み込み中"
            className="rounded-lg border border-dashed border-border px-3 py-4"
          >
            <SkeletonRows rows={2} cols={1} status={false} />
          </div>
        ) : jobCountsErrorUnavailable ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            ジョブ状態を確認できませんでした。下の一覧で再読み込みしてください。
          </p>
        ) : attentionJobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            今すぐ対応が必要なジョブはありません。
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {attentionJobs.map((entry) => {
              const status = entry.latest_run?.status ?? 'unknown';
              const cfg = STATUS_CONFIG[status];
              const summary = getJobBulkExportRunSummary(entry);
              const reason = getAttentionReason(entry);
              const errorSummary = entry.latest_run?.error_summary;
              const detail =
                reason === 'partial' && summary
                  ? formatBulkExportSummary(summary)
                  : errorSummary
                    ? `${errorSummary.error_name} / ${errorSummary.message}`
                    : entry.schedule_hint;

              return (
                <article
                  key={entry.job_type}
                  className="rounded-lg border border-border/70 bg-muted/20 p-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {cfg?.role && cfg.role !== 'neutral' ? (
                          <StateBadge role={cfg.role}>{cfg.label}</StateBadge>
                        ) : (
                          <Badge variant="outline">{cfg?.label ?? status}</Badge>
                        )}
                        {reason === 'partial' ? (
                          <Badge variant="outline" className="text-state-confirm">
                            一部失敗
                          </Badge>
                        ) : null}
                      </div>
                      <p className="break-all font-mono text-sm font-medium text-foreground">
                        {entry.job_type}
                      </p>
                      <p className="text-xs text-muted-foreground">{entry.schedule_hint}</p>
                      <p
                        className={`line-clamp-2 text-sm ${
                          reason === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                      >
                        {detail}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="!h-11 !min-h-[44px] !min-w-11 shrink-0 px-3 text-xs"
                      aria-label={`${entry.job_type} を再実行`}
                      disabled={rerunMutation.isPending}
                      onClick={() =>
                        rerunMutation.mutate({
                          endpoint: entry.endpoint,
                          jobType: entry.job_type,
                        })
                      }
                    >
                      <Play className="mr-1 size-3" aria-hidden="true" />
                      再実行
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card>
          <CardHeader className="px-3 pt-3 pb-1 sm:px-6 sm:pt-6">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              登録ジョブ数
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">
              {jobCountsUnavailable ? '—' : (data?.data.length ?? '—')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-3 pt-3 pb-1 sm:px-6 sm:pt-6">
            <CardTitle className="text-sm font-medium text-muted-foreground">実行中</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
            <p className="text-xl font-semibold text-tag-info tabular-nums sm:text-2xl">
              {jobCountsUnavailable ? '—' : runningCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-3 pt-3 pb-1 sm:px-6 sm:pt-6">
            <CardTitle className="text-sm font-medium text-muted-foreground">失敗</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
            <p
              className={`text-xl font-semibold tabular-nums sm:text-2xl ${failedCount > 0 ? 'text-destructive' : ''}`}
            >
              {jobCountsUnavailable ? '—' : failedCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-3 pt-3 pb-1 sm:px-6 sm:pt-6">
            <CardTitle className="text-sm font-medium text-muted-foreground">一部失敗</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
            <p
              className={`text-xl font-semibold tabular-nums sm:text-2xl ${partialWarningCount > 0 ? 'text-state-confirm' : ''}`}
            >
              {jobCountsUnavailable ? '—' : partialWarningCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <details className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Filter className="size-4" aria-hidden="true" />
            表示条件を変更
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {filteredJobs.length}件表示中
          </span>
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
      </details>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {jobCountsUnavailable ? '—件' : `${filteredJobs.length}件`}
      </p>

      {/* Table */}
      <div className="[&_button]:!min-h-[44px] [&_button]:!min-w-11">
        <DataTable
          columns={columns}
          data={filteredJobs}
          isLoading={isLoading}
          errorMessage={isError ? 'ジョブ一覧を取得できませんでした' : undefined}
          onRetry={() => void refetch()}
          caption="IntegrationJob 一覧"
          renderExpandedRow={renderExpandedRow}
          getRowId={(row) => row.job_type}
        />
      </div>
    </div>
  );
}
