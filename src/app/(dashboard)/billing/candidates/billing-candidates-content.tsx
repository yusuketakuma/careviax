'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Download, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type BillingCandidate = {
  id: string;
  patient_id: string;
  billing_month: string;
  billing_code: string;
  billing_name: string;
  points: number | null;
  quantity: number;
  status: string;
  exclusion_reason: string | null;
  calculation_breakdown?: {
    calculation_unit?: string;
    rate_percent?: number | null;
    derived_points?: number | null;
  } | null;
  source_snapshot?: {
    billing_scope?: string;
    selection_mode?: string;
    source_note?: string;
    billing_close?: {
      review_state?: 'pending' | 'reviewed';
      resolution_state?: 'unresolved' | 'confirmed' | 'excluded';
      reviewed_at?: string | null;
      reviewed_by?: string | null;
      closed_at?: string | null;
      closed_by?: string | null;
      note?: string | null;
    } | null;
  } | null;
  workflow_state?: {
    review_state?: 'pending' | 'reviewed';
    resolution_state?: 'unresolved' | 'confirmed' | 'excluded';
    reviewed_at?: string | null;
    reviewed_by?: string | null;
    closed_at?: string | null;
    closed_by?: string | null;
    note?: string | null;
  } | null;
};

type BillingCandidateSummary = {
  total: number;
  pending_review: number;
  confirmed: number;
  excluded: number;
  exported: number;
  reviewed: number;
  ready_to_close: number;
  blocked_from_close: number;
  blocker_reasons: Array<{ reason: string; count: number }>;
} | null;

type BillingCandidatesResponse = {
  data: BillingCandidate[];
  hasMore: boolean;
  summary: BillingCandidateSummary;
};

// --- Constants ---

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  candidate: { label: '候補', icon: AlertTriangle, className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  confirmed: { label: '確定', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-200' },
  excluded: { label: '除外', icon: XCircle, className: 'bg-gray-100 text-gray-600 border-gray-200' },
  exported: { label: '締め済み', icon: CheckCircle2, className: 'bg-blue-100 text-blue-800 border-blue-200' },
};

const VALIDATION_OK = ['confirmed', 'exported'];
const VALIDATION_NG = ['excluded'];

function ValidationBadge({ status }: { status: string }) {
  if (VALIDATION_OK.includes(status)) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-700" aria-label="バリデーションOK">
        <CheckCircle2 className="size-3.5" aria-hidden="true" /> OK
      </span>
    );
  }
  if (VALIDATION_NG.includes(status)) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700" aria-label="バリデーションNG">
        <XCircle className="size-3.5" aria-hidden="true" /> NG
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-700" aria-label="要確認">
      <AlertTriangle className="size-3.5" aria-hidden="true" /> 要確認
    </span>
  );
}

function WorkflowBadge({
  workflow,
}: {
  workflow?: BillingCandidate['workflow_state'] | null;
}) {
  const reviewState = workflow?.review_state ?? 'pending';
  const resolutionState = workflow?.resolution_state ?? 'unresolved';

  return (
    <div className="space-y-1 text-xs">
      <Badge variant="outline" className="w-fit">
        {reviewState === 'reviewed' ? 'レビュー済み' : '未レビュー'}
      </Badge>
      <p className="text-muted-foreground">
        {resolutionState === 'confirmed'
          ? '確定'
          : resolutionState === 'excluded'
            ? '除外'
            : '未解決'}
      </p>
    </div>
  );
}

function candidateWorkflow(candidate: BillingCandidate) {
  return candidate.workflow_state ?? candidate.source_snapshot?.billing_close ?? null;
}

// --- Main ---

export function BillingCandidatesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const billingMonthStr = format(currentMonth, 'yyyy-MM-dd');
  const billingMonthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  const { data, isLoading } = useQuery({
    queryKey: ['billing-candidates', orgId, billingMonthStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/billing-candidates?billing_month=${billingMonthStr}&limit=100`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('請求候補の取得に失敗しました');
      return res.json() as Promise<BillingCandidatesResponse>;
    },
    enabled: !!orgId,
  });

  const candidates = data?.data ?? [];
  const summary = data?.summary ?? null;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing-candidates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ billing_month: billingMonthStr }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '請求候補の生成に失敗しました');
      }
      return res.json() as Promise<{ message: string; generated?: number }>;
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      await queryClient.invalidateQueries({
        queryKey: ['billing-candidates', orgId, billingMonthStr],
      });
      await queryClient.invalidateQueries({ queryKey: ['billing-stats', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: {
      id: string;
      action: 'confirm' | 'exclude' | 'reopen';
    }) => {
      const res = await fetch(`/api/billing-candidates/${input.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ action: input.action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '請求候補の更新に失敗しました');
      }
      return res.json() as Promise<{ data: BillingCandidate }>;
    },
    onSuccess: async () => {
      toast.success('請求候補を更新しました');
      await queryClient.invalidateQueries({
        queryKey: ['billing-candidates', orgId, billingMonthStr],
      });
      await queryClient.invalidateQueries({ queryKey: ['billing-stats', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing-candidates/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ billing_month: billingMonthStr }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '月次締めに失敗しました');
      }
      return res.json() as Promise<{ message: string; exported_count?: number }>;
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      await queryClient.invalidateQueries({
        queryKey: ['billing-candidates', orgId, billingMonthStr],
      });
      await queryClient.invalidateQueries({ queryKey: ['billing-stats', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const columns = useMemo<ColumnDef<BillingCandidate>[]>(
    () => [
      {
        accessorKey: 'billing_code',
        header: '請求コード',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.billing_code}</span>
        ),
      },
      {
        accessorKey: 'billing_name',
        header: '算定名称',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.billing_name}</span>
        ),
      },
      {
        accessorKey: 'points',
        header: '算定値',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.points != null
              ? `${row.original.points}${
                  row.original.calculation_breakdown?.calculation_unit === 'unit'
                    ? '単位'
                    : '点'
                }`
              : row.original.calculation_breakdown?.rate_percent != null
                ? `${row.original.calculation_breakdown.rate_percent}%`
                : '—'}
          </span>
        ),
      },
      {
        id: 'ssot',
        header: 'SSOT',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs">
            <Badge variant="outline">
              {row.original.source_snapshot?.billing_scope === 'home_care_ssot' ? '公式' : '任意'}
            </Badge>
            <p className="text-muted-foreground">
              {row.original.source_snapshot?.selection_mode === 'manual' ? '要件確認' : '自動'}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: '状態',
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          if (!cfg) return <span className="text-xs text-muted-foreground">{row.original.status}</span>;
          const Icon = cfg.icon;
          return (
            <Badge variant="outline" className={`flex w-fit items-center gap-1 text-xs ${cfg.className}`}>
              <Icon className="size-3" aria-hidden="true" />
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: 'workflow',
        header: 'レビュー / 締め',
        cell: ({ row }) => <WorkflowBadge workflow={candidateWorkflow(row.original)} />,
      },
      {
        id: 'validation',
        header: 'バリデーション',
        cell: ({ row }) => <ValidationBadge status={row.original.status} />,
      },
      {
        accessorKey: 'exclusion_reason',
        header: '除外理由',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <span>{row.original.exclusion_reason ?? '—'}</span>
            {row.original.source_snapshot?.source_note && (
              <p>{row.original.source_snapshot.source_note}</p>
            )}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const status = row.original.status;
          const workflow = candidateWorkflow(row.original);

          return (
            <div className="flex flex-wrap gap-1">
              {status === 'candidate' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reviewMutation.mutate({ id: row.original.id, action: 'confirm' })}
                    disabled={reviewMutation.isPending}
                  >
                    確定
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reviewMutation.mutate({ id: row.original.id, action: 'exclude' })}
                    disabled={reviewMutation.isPending}
                  >
                    除外
                  </Button>
                </>
              )}
              {status === 'confirmed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reviewMutation.mutate({ id: row.original.id, action: 'reopen' })}
                  disabled={reviewMutation.isPending}
                >
                  差戻し
                </Button>
              )}
              {status === 'excluded' && workflow?.review_state === 'reviewed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reviewMutation.mutate({ id: row.original.id, action: 'reopen' })}
                  disabled={reviewMutation.isPending}
                >
                  再レビュー
                </Button>
              )}
              {status === 'exported' && (
                <span className="text-xs text-muted-foreground">締め済み</span>
              )}
            </div>
          );
        },
      },
    ],
    [reviewMutation]
  );

  function handleExport() {
    const url = `/api/billing-candidates/export?billing_month=${billingMonthStr}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `billing_${billingMonthStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('CSVエクスポートを開始しました');
  }

  const okCount = candidates.filter((c) => VALIDATION_OK.includes(c.status)).length;
  const ngCount = candidates.filter((c) => VALIDATION_NG.includes(c.status)).length;
  const warningCount = candidates.filter((c) => !VALIDATION_OK.includes(c.status) && !VALIDATION_NG.includes(c.status)).length;
  const closeBlocked = summary?.blocked_from_close ?? warningCount;
  const closeReady = summary?.ready_to_close ?? okCount;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">締め準備</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{closeReady}</p>
            <p className="text-xs text-muted-foreground">月次締め可能な候補</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">レビュー待ち</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{closeBlocked}</p>
            <p className="text-xs text-muted-foreground">未確認の候補</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">締め済み</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{summary?.exported ?? candidates.filter((c) => c.status === 'exported').length}</p>
            <p className="text-xs text-muted-foreground">月次締め済み件数</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">レビュー済み</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{summary?.reviewed ?? 0}</p>
            <p className="text-xs text-muted-foreground">workflow で記録済み</p>
          </CardContent>
        </Card>
      </div>

      {summary?.blocker_reasons?.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">締めを止めている主因</p>
          <ul className="mt-1 space-y-1 text-xs">
            {summary.blocker_reasons.map((item) => (
              <li key={item.reason}>
                {item.reason} ({item.count}件)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Month navigation */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="前月"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[120px] text-center text-base font-semibold text-foreground">
            {billingMonthLabel}
          </span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            aria-label="翌月"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            {generateMutation.isPending ? '生成中...' : '候補生成'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending || closeBlocked > 0 || closeReady === 0}
          >
            {closeMutation.isPending ? '締め処理中...' : '月次締め'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={candidates.length === 0}>
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            CSV出力
          </Button>
        </div>
      </div>

      {/* Validation summary */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-700">
          <CheckCircle2 className="size-4" aria-hidden="true" /> OK: {okCount}件
        </span>
        <span className="flex items-center gap-1 text-red-700">
          <XCircle className="size-4" aria-hidden="true" /> NG: {ngCount}件
        </span>
        <span className="flex items-center gap-1 text-yellow-700">
          <AlertTriangle className="size-4" aria-hidden="true" /> 要確認: {warningCount}件
        </span>
      </div>

      {/* Candidates table */}
      <DataTable
        columns={columns}
        data={candidates}
        isLoading={isLoading}
        caption="月次請求候補一覧"
      />

      {!isLoading && candidates.length === 0 && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
          <p className="text-sm text-muted-foreground">
            {billingMonthLabel} の請求候補はありません
          </p>
        </div>
      )}
    </div>
  );
}
