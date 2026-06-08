'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, subMonths, addMonths } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type BillingCandidate = {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  billing_domain?: 'home_care' | 'pca_rental' | string | null;
  billing_target_type?: 'patient' | 'institution' | string | null;
  billing_target_id?: string | null;
  billing_target_name?: string | null;
  billing_target_label?: string | null;
  billing_month: string;
  billing_code: string;
  billing_name: string;
  points: number | null;
  quantity: number;
  status: string;
  exclusion_reason: string | null;
  effective_revision_code?: string | null;
  site_config_revision_code?: string | null;
  site_config_status?: string | null;
  calculation_breakdown?: {
    calculation_unit?: string;
    amount_yen?: number | null;
    rate_percent?: number | null;
    derived_points?: number | null;
  } | null;
  source_snapshot?: {
    billing_scope?: string;
    selection_mode?: string;
    source_note?: string;
    ruleset_version?: string;
    revision_code?: string;
    site_config_revision_code?: string;
    site_config_status?: string;
    source_type?: string;
    source_entity_id?: string;
    conference_note_id?: string;
    billing_fee_type?: string;
    duplicate_interaction_fee_type?: string;
    billing_assignment?: {
      building_id?: string | null;
      unit_name?: string | null;
      assignment_scope?: 'building' | 'unit' | 'patient';
      building_patient_count?: number | null;
      unit_patient_count?: number | null;
    } | null;
    billing_close?: {
      review_state?: 'pending' | 'reviewed';
      resolution_state?: 'unresolved' | 'confirmed' | 'excluded';
      reviewed_at?: string | null;
      reviewed_by?: string | null;
      closed_at?: string | null;
      closed_by?: string | null;
      note?: string | null;
    } | null;
    validation_layers?: {
      evidence?: {
        label?: string;
        state?: 'passed' | 'manual_review' | 'blocked';
        message?: string;
      } | null;
      rule_engine?: {
        label?: string;
        state?: 'passed' | 'manual_review' | 'blocked';
        message?: string;
        version?: string;
      } | null;
      close_review?: {
        label?: string;
        state?: 'passed' | 'manual_review' | 'blocked';
        message?: string;
      } | null;
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

type CandidateValidationLayers = NonNullable<
  NonNullable<BillingCandidate['source_snapshot']>['validation_layers']
>;

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
  nextCursor?: string;
  summary: BillingCandidateSummary;
};

type BillingCandidatesContentProps = {
  initialBillingMonth?: string | null;
  initialPatientId?: string | null;
  initialWorkflowFrom?: string | null;
  initialVisitRecordId?: string | null;
};

// --- Constants ---

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> =
  {
    candidate: {
      label: '候補',
      icon: AlertTriangle,
      className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    },
    confirmed: {
      label: '確定',
      icon: CheckCircle2,
      className: 'bg-green-100 text-green-800 border-green-200',
    },
    excluded: {
      label: '除外',
      icon: XCircle,
      className: 'bg-gray-100 text-gray-600 border-gray-200',
    },
    exported: {
      label: '締め済み',
      icon: CheckCircle2,
      className: 'bg-blue-100 text-blue-800 border-blue-200',
    },
  };

const VALIDATION_OK = ['confirmed', 'exported'];
const VALIDATION_NG = ['excluded'];

function ValidationBadge({
  status,
  layers,
}: {
  status: string;
  layers?: CandidateValidationLayers | null;
}) {
  const layerStates = layers
    ? [layers.evidence?.state, layers.rule_engine?.state, layers.close_review?.state].filter(
        (value): value is 'passed' | 'manual_review' | 'blocked' => value != null,
      )
    : [];

  if (layerStates.includes('blocked')) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700" aria-label="バリデーションNG">
        <XCircle className="size-3.5" aria-hidden="true" /> NG
      </span>
    );
  }
  if (layerStates.includes('manual_review')) {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-700" aria-label="要確認">
        <AlertTriangle className="size-3.5" aria-hidden="true" /> 要確認
      </span>
    );
  }
  if (VALIDATION_OK.includes(status)) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-green-700"
        aria-label="バリデーションOK"
      >
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

function WorkflowBadge({ workflow }: { workflow?: BillingCandidate['workflow_state'] | null }) {
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

function candidateEvidenceSummary(candidate: BillingCandidate) {
  const source = candidate.source_snapshot;
  const lines: string[] = [];

  if (source?.source_type === 'conference_note' || source?.conference_note_id) {
    lines.push('会議記録由来');
  }
  if (source?.source_note) {
    lines.push(source.source_note);
  }
  if (source?.ruleset_version) {
    lines.push(`ルール ${source.ruleset_version}`);
  }
  if (source?.validation_layers?.evidence?.message) {
    lines.push(source.validation_layers.evidence.message);
  }
  if (source?.validation_layers?.rule_engine?.message) {
    lines.push(source.validation_layers.rule_engine.message);
  }
  if (candidate.calculation_breakdown?.derived_points != null) {
    lines.push(`算出 ${candidate.calculation_breakdown.derived_points}点`);
  }

  return lines.length > 0 ? lines : ['候補生成時の根拠を確認してください'];
}

function candidateBillingTargetLabel(candidate: BillingCandidate) {
  return (
    candidate.billing_target_label ??
    candidate.billing_target_name ??
    candidate.patient_name ??
    candidate.patient_id ??
    '請求先未設定'
  );
}

function parseInitialBillingMonth(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

// --- Main ---

export function BillingCandidatesContent({
  initialBillingMonth,
  initialPatientId,
  initialWorkflowFrom,
  initialVisitRecordId,
}: BillingCandidatesContentProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const initialMonth = parseInitialBillingMonth(initialBillingMonth);
    if (initialMonth) return initialMonth;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const patientIdFilter = initialPatientId?.trim() || null;
  const visitRecordIdFilter = initialVisitRecordId?.trim() || null;
  const isVisitRecordContext =
    initialWorkflowFrom === 'visit_record' && Boolean(visitRecordIdFilter);
  const visitRecordBackHref = visitRecordIdFilter
    ? `/visits/${encodeURIComponent(visitRecordIdFilter)}`
    : null;

  const billingMonthStr = format(currentMonth, 'yyyy-MM-dd');
  const billingMonthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['billing-candidates', orgId, billingMonthStr, patientIdFilter],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ billing_month: billingMonthStr, limit: '50' });
      if (patientIdFilter) params.set('patient_id', patientIdFilter);
      if (pageParam) params.set('cursor', pageParam);
      const res = await fetch(`/api/billing-candidates?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('請求候補の取得に失敗しました');
      return res.json() as Promise<BillingCandidatesResponse>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!orgId,
  });

  const candidates = data?.pages.flatMap((p) => p.data) ?? [];
  const summary = data?.pages[0]?.summary ?? null;

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
        queryKey: ['billing-candidates', orgId, billingMonthStr, patientIdFilter],
      });
      await queryClient.invalidateQueries({ queryKey: ['billing-stats', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: { id: string; action: 'confirm' | 'exclude' | 'reopen' }) => {
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
        queryKey: ['billing-candidates', orgId, billingMonthStr, patientIdFilter],
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
        queryKey: ['billing-candidates', orgId, billingMonthStr, patientIdFilter],
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
        meta: {
          label: '請求コード',
          mobileLabel: 'コード',
        },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.billing_code}</span>,
      },
      {
        accessorKey: 'billing_name',
        header: '算定名称',
        meta: {
          label: '算定名称',
          mobileLabel: '名称',
        },
        cell: ({ row }) => <span className="text-sm">{row.original.billing_name}</span>,
      },
      {
        accessorKey: 'billing_target_label',
        header: '請求先',
        meta: {
          label: '請求先',
          mobileLabel: '請求先',
        },
        cell: ({ row }) => (
          <span className="text-sm">{candidateBillingTargetLabel(row.original)}</span>
        ),
      },
      {
        accessorKey: 'billing_domain',
        header: '区分',
        meta: {
          label: '区分',
          mobileHidden: true,
        },
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.billing_domain === 'pca_rental' ? 'PCAレンタル' : '医療・介護'}
          </Badge>
        ),
      },
      {
        accessorKey: 'points',
        header: '算定値',
        meta: {
          label: '算定値',
          mobileLabel: '値',
        },
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.points != null
              ? `${row.original.points}${
                  row.original.calculation_breakdown?.calculation_unit === 'unit' ? '単位' : '点'
                }`
              : row.original.calculation_breakdown?.amount_yen != null
                ? `${row.original.calculation_breakdown.amount_yen.toLocaleString('ja-JP')}円`
                : row.original.calculation_breakdown?.rate_percent != null
                  ? `${row.original.calculation_breakdown.rate_percent}%`
                  : '—'}
          </span>
        ),
      },
      {
        id: 'ssot',
        header: 'SSOT',
        meta: {
          label: 'SSOT',
          tabletHidden: true,
          mobileHidden: true,
        },
        cell: ({ row }) => (
          <div className="space-y-1 text-xs">
            <Badge variant="outline">
              {row.original.source_snapshot?.billing_scope === 'home_care_ssot' ? '公式' : '任意'}
            </Badge>
            <p className="text-muted-foreground">
              {row.original.source_snapshot?.selection_mode === 'manual' ? '要件確認' : '自動'}
            </p>
            <p className="text-muted-foreground">
              改定{' '}
              {row.original.effective_revision_code ??
                row.original.source_snapshot?.revision_code ??
                '—'}
            </p>
            {(row.original.site_config_status ??
            row.original.source_snapshot?.site_config_status) ? (
              <p className="text-muted-foreground">
                設定{' '}
                {row.original.site_config_status ??
                  row.original.source_snapshot?.site_config_status}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: '状態',
        meta: {
          label: '状態',
        },
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          if (!cfg)
            return <span className="text-xs text-muted-foreground">{row.original.status}</span>;
          const Icon = cfg.icon;
          return (
            <Badge
              variant="outline"
              className={`flex w-fit items-center gap-1 text-xs ${cfg.className}`}
            >
              <Icon className="size-3" aria-hidden="true" />
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: 'workflow',
        header: 'レビュー / 締め',
        meta: {
          label: 'レビュー / 締め',
          tabletHidden: true,
        },
        cell: ({ row }) => <WorkflowBadge workflow={candidateWorkflow(row.original)} />,
      },
      {
        id: 'validation',
        header: 'バリデーション',
        meta: {
          label: 'バリデーション',
          mobileHidden: true,
        },
        cell: ({ row }) => (
          <ValidationBadge
            status={row.original.status}
            layers={row.original.source_snapshot?.validation_layers ?? null}
          />
        ),
      },
      {
        accessorKey: 'exclusion_reason',
        header: '根拠 / 除外理由',
        meta: {
          label: '根拠 / 除外理由',
          tabletHidden: true,
          mobileHidden: true,
          exportValue: (candidate: BillingCandidate) =>
            candidate.exclusion_reason ?? candidate.source_snapshot?.source_note ?? '',
        },
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <span>{row.original.exclusion_reason ?? '—'}</span>
            <div className="space-y-0.5">
              {candidateEvidenceSummary(row.original)
                .slice(0, 3)
                .map((line) => (
                  <p key={`${row.original.id}-${line}`}>{line}</p>
                ))}
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: '操作',
        meta: {
          label: '操作',
          mobileHidden: true,
        },
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
                    onClick={() =>
                      reviewMutation.mutate({ id: row.original.id, action: 'confirm' })
                    }
                    disabled={reviewMutation.isPending}
                  >
                    確定
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      reviewMutation.mutate({ id: row.original.id, action: 'exclude' })
                    }
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
    [reviewMutation],
  );

  async function handleExport() {
    if (!orgId) return;

    setIsExporting(true);
    try {
      const params = new URLSearchParams({ billing_month: billingMonthStr });
      if (patientIdFilter) params.set('patient_id', patientIdFilter);
      const response = await fetch(`/api/billing-candidates/export?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message ?? 'CSVエクスポートに失敗しました');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `billing_${billingMonthStr}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('CSVをダウンロードしました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'CSVエクスポートに失敗しました');
    } finally {
      setIsExporting(false);
    }
  }

  const okCount = candidates.filter((c) => VALIDATION_OK.includes(c.status)).length;
  const ngCount = candidates.filter((c) => VALIDATION_NG.includes(c.status)).length;
  const warningCount = candidates.filter(
    (c) => !VALIDATION_OK.includes(c.status) && !VALIDATION_NG.includes(c.status),
  ).length;
  const closeBlocked = summary?.blocked_from_close ?? warningCount;
  const closeReady = summary?.ready_to_close ?? okCount;

  return (
    <div className="space-y-4">
      {isVisitRecordContext ? (
        <PageSection
          title="訪問記録から確認中"
          description="対象患者と訪問月で請求候補を絞り込み、訪問後ワークフローから算定根拠を確認しています。"
          actions={
            visitRecordBackHref ? (
              <Link
                href={visitRecordBackHref}
                className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                訪問記録へ戻る
              </Link>
            ) : null
          }
          tone="subtle"
        />
      ) : null}

      {patientIdFilter ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">患者で絞り込み中</p>
          <p className="mt-1 text-xs">
            患者ID {patientIdFilter} の候補だけを表示しています。月次締めは全体確認が必要なため、
            請求ダッシュボードから実行してください。
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Card size="sm">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-medium text-muted-foreground">締め準備</h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{closeReady}</p>
            <p className="text-xs text-muted-foreground">月次締め可能な候補</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-medium text-muted-foreground">レビュー待ち / 根拠不足</h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{closeBlocked}</p>
            <p className="text-xs text-muted-foreground">未確認候補と請求根拠不足</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-medium text-muted-foreground">締め済み</h3>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">
              {summary?.exported ?? candidates.filter((c) => c.status === 'exported').length}
            </p>
            <p className="text-xs text-muted-foreground">月次締め済み件数</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-medium text-muted-foreground">レビュー済み</h3>
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

      <PageSection
        title="月次操作"
        description="対象月を切り替え、候補生成、月次締め、CSV出力を実行します。"
        actions={
          <ActionRail>
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
          </ActionRail>
        }
        contentClassName="space-y-3"
      >
        <ActionRail align="start">
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
            disabled={
              closeMutation.isPending || closeBlocked > 0 || closeReady === 0 || !!patientIdFilter
            }
          >
            {closeMutation.isPending ? '締め処理中...' : '月次締め'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleExport()}
            disabled={candidates.length === 0 || isExporting}
          >
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            {isExporting ? '出力中...' : 'CSV出力'}
          </Button>
        </ActionRail>

        <FilterSummaryBar
          items={[
            { label: 'OK', value: `${okCount}件` },
            { label: 'NG', value: `${ngCount}件`, tone: ngCount > 0 ? 'danger' : 'default' },
            {
              label: '要確認',
              value: `${warningCount}件`,
              tone: warningCount > 0 ? 'warning' : 'default',
            },
          ]}
        />
      </PageSection>

      {/* Candidates table */}
      <DataTable
        columns={columns}
        data={candidates}
        isLoading={isLoading}
        caption="月次請求候補一覧"
        enableRowSelection
        toolbar={{
          enableGlobalFilter: true,
          globalFilterPlaceholder: '請求コード・算定名称で絞り込み',
          enableColumnVisibility: true,
          enableExport: true,
          enablePrint: true,
          exportFileName: `billing-candidates-${billingMonthStr}.csv`,
          filterFields: [
            {
              columnId: 'billing_code',
              label: '請求コード',
              placeholder: '請求コードで絞り込み',
            },
            {
              columnId: 'status',
              label: '状態',
              placeholder: '状態で絞り込み',
            },
          ],
        }}
        renderExpandedRow={(row) => {
          const candidate = row.original;
          const workflow = candidateWorkflow(candidate);
          return (
            <div className="grid gap-4 text-sm text-foreground md:grid-cols-2">
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    請求先ID
                  </p>
                  <p className="font-mono text-xs">
                    {candidate.billing_target_id ?? candidate.patient_id ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    建物 / ユニット割当
                  </p>
                  <p>
                    {candidate.source_snapshot?.billing_assignment?.building_id ?? '建物未設定'}
                    {candidate.source_snapshot?.billing_assignment?.unit_name
                      ? ` / ${candidate.source_snapshot.billing_assignment.unit_name}`
                      : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.source_snapshot?.billing_assignment?.assignment_scope === 'building'
                      ? `単一建物判定 (${candidate.source_snapshot.billing_assignment.building_patient_count ?? '—'}人)`
                      : candidate.source_snapshot?.billing_assignment?.assignment_scope === 'unit'
                        ? `ユニット判定 (${candidate.source_snapshot.billing_assignment.unit_patient_count ?? '—'}人)`
                        : '患者単位判定'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    除外理由
                  </p>
                  <p>{candidate.exclusion_reason ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    ソースメモ
                  </p>
                  <p>{candidate.source_snapshot?.source_note ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    ルールセット
                  </p>
                  <p>{candidate.source_snapshot?.ruleset_version ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    改定 / 薬局設定
                  </p>
                  <p>
                    {candidate.effective_revision_code ??
                      candidate.source_snapshot?.revision_code ??
                      '—'}
                    {(candidate.site_config_revision_code ??
                    candidate.source_snapshot?.site_config_revision_code)
                      ? ` / 設定 ${candidate.site_config_revision_code ?? candidate.source_snapshot?.site_config_revision_code}`
                      : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.site_config_status ??
                      candidate.source_snapshot?.site_config_status ??
                      '—'}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    レビュー状態
                  </p>
                  <p>
                    {workflow?.review_state === 'reviewed' ? 'レビュー済み' : '未レビュー'} /{' '}
                    {workflow?.resolution_state === 'confirmed'
                      ? '確定'
                      : workflow?.resolution_state === 'excluded'
                        ? '除外'
                        : '未解決'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    計算内訳
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-5 text-foreground">
                    {JSON.stringify(candidate.calculation_breakdown ?? {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    3層バリデーション
                  </p>
                  <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                    {candidate.source_snapshot?.validation_layers ? (
                      <>
                        {(['evidence', 'rule_engine', 'close_review'] as const).map((key) => {
                          const layer = candidate.source_snapshot?.validation_layers?.[key];
                          if (!layer) return null;
                          const layerVersion =
                            key === 'rule_engine'
                              ? candidate.source_snapshot?.validation_layers?.rule_engine?.version
                              : undefined;

                          return (
                            <div key={key}>
                              <p className="font-medium text-foreground">
                                {layer.label ?? key}
                                {key === 'rule_engine' && layerVersion ? ` / ${layerVersion}` : ''}
                              </p>
                              <p className="text-muted-foreground">
                                {layer.state === 'passed'
                                  ? 'OK'
                                  : layer.state === 'blocked'
                                    ? 'ブロック'
                                    : '要確認'}
                                {' · '}
                                {layer.message ?? '—'}
                              </p>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p className="text-muted-foreground">バリデーション情報なし</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />

      {!isLoading && candidates.length === 0 && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
          <p className="text-sm text-muted-foreground">
            {billingMonthLabel} の請求候補はありません
          </p>
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? '読み込み中...' : 'さらに読み込む'}
          </Button>
        </div>
      )}
    </div>
  );
}
