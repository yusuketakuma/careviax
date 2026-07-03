'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageSection } from '@/components/layout/page-section';
import { ActionRail } from '@/components/ui/action-rail';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import {
  BILLING_VALIDATION_LAYER_KEYS,
  collectBillingValidationMessages,
  readBillingValidationLayers,
  summarizeBillingValidationLayers,
  type BillingValidationLayerSnapshot,
} from '@/lib/billing/validation-layers';
import type { StatusRoleOrNeutral } from '@/lib/constants/status-labels';

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
  updated_at: string;
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
    validation_layers?: BillingValidationLayerSnapshot | null;
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

type BillingDomain = 'home_care' | 'pca_rental';

type CandidateValidationLayers = BillingValidationLayerSnapshot;

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

type BillingExportPreviewResponse = {
  data: {
    billing_month: string | null;
    billing_domain: BillingDomain;
    total_count: number;
    exportable_count: number;
    total_points: number;
    total_amount_yen: number;
    status_counts: Record<string, number>;
    insurance_type_counts: {
      medical: number;
      care: number;
      self: number;
    };
    exclusion_reasons: Array<{ reason: string; count: number }>;
    generated_at: string;
  };
};

type BillingCandidatesContentProps = {
  initialBillingMonth?: string | null;
  initialPatientId?: string | null;
  initialCandidateId?: string | null;
  initialWorkflowFrom?: string | null;
  initialVisitRecordId?: string | null;
};

// --- Constants ---

// VisitBillingStatus 写像: candidate=neutral(状態色なし), confirmed/exported(締め済)=done, excluded=readonly。
const STATUS_CONFIG: Record<string, { label: string; role: StatusRoleOrNeutral }> = {
  candidate: { label: '候補', role: 'neutral' },
  confirmed: { label: '確定', role: 'done' },
  excluded: { label: '除外', role: 'readonly' },
  exported: { label: '締め済み', role: 'done' },
};

const VALIDATION_OK = ['confirmed', 'exported'];
const VALIDATION_NG = ['excluded'];
const BILLING_CLOSE_DISABLED_REASON_ID = 'billing-candidates-close-disabled-reason';
const BILLING_CSV_EXPORT_DISABLED_REASON_ID = 'billing-candidates-csv-export-disabled-reason';
const BILLING_DOMAIN_OPTIONS: Array<{ value: BillingDomain; label: string; shortLabel: string }> = [
  { value: 'home_care', label: '医療・介護請求', shortLabel: '医療・介護' },
  { value: 'pca_rental', label: 'PCAレンタル請求', shortLabel: 'PCAレンタル' },
];

export function getBillingCloseDisabledReason({
  closeBlocked,
  closeReady,
  patientIdFilter,
}: {
  closeBlocked: number;
  closeReady: number;
  patientIdFilter: string | null;
}) {
  if (patientIdFilter) return '患者で絞り込み中は月次締めを実行できません。';
  if (closeReady === 0) return '月次締めできる候補がありません。';
  if (closeBlocked > 0) return 'レビュー待ちまたは根拠不足の候補があります。';
  return null;
}

export function getBillingCsvExportDisabledReason({
  exportableCount,
  isPreviewLoading,
}: {
  exportableCount: number;
  isPreviewLoading: boolean;
}) {
  if (isPreviewLoading) return '出力前確認を読み込んでいます。';
  if (exportableCount <= 0) return 'CSV出力できる確定または締め済み候補がありません。';
  return null;
}

function ValidationBadge({
  status,
  layers,
}: {
  status: string;
  layers?: CandidateValidationLayers | null;
}) {
  const validationSummary = summarizeBillingValidationLayers(layers);

  if (validationSummary.state === 'blocked') {
    return (
      <span
        className="flex items-center gap-1 text-xs text-state-blocked"
        aria-label="バリデーションNG"
      >
        <XCircle className="size-3.5" aria-hidden="true" /> NG
      </span>
    );
  }
  if (validationSummary.state === 'manual_review') {
    return (
      <span className="flex items-center gap-1 text-xs text-state-confirm" aria-label="要確認">
        <AlertTriangle className="size-3.5" aria-hidden="true" /> 要確認
      </span>
    );
  }
  if (VALIDATION_OK.includes(status)) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-state-done"
        aria-label="バリデーションOK"
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" /> OK
      </span>
    );
  }
  if (VALIDATION_NG.includes(status)) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-state-blocked"
        aria-label="バリデーションNG"
      >
        <XCircle className="size-3.5" aria-hidden="true" /> NG
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-state-confirm" aria-label="要確認">
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

function candidateValidationLayers(candidate: BillingCandidate) {
  return readBillingValidationLayers(candidate.source_snapshot);
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
  lines.push(...collectBillingValidationMessages(readBillingValidationLayers(source)));
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
  initialCandidateId,
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
  const [billingDomain, setBillingDomain] = useState<BillingDomain>('home_care');
  const patientIdFilter = initialPatientId?.trim() || null;
  const targetCandidateId = initialCandidateId?.trim() || null;
  const visitRecordIdFilter = initialVisitRecordId?.trim() || null;
  const isVisitRecordContext =
    initialWorkflowFrom === 'visit_record' && Boolean(visitRecordIdFilter);
  const visitRecordBackHref = visitRecordIdFilter
    ? `/visits/${encodeURIComponent(visitRecordIdFilter)}`
    : null;

  const billingMonthStr = format(currentMonth, 'yyyy-MM-dd');
  const billingMonthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['billing-candidates', orgId, billingMonthStr, patientIdFilter, billingDomain],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        billing_month: billingMonthStr,
        billing_domain: billingDomain,
        limit: '50',
      });
      if (patientIdFilter) params.set('patient_id', patientIdFilter);
      if (pageParam) params.set('cursor', pageParam);
      const res = await fetch(`/api/billing-candidates?${params}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('請求候補の取得に失敗しました');
      return res.json() as Promise<BillingCandidatesResponse>;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: !!orgId,
  });

  const exportPreviewQuery = useQuery({
    queryKey: [
      'billing-candidates-export-preview',
      orgId,
      billingMonthStr,
      patientIdFilter,
      billingDomain,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        billing_month: billingMonthStr,
        billing_domain: billingDomain,
        preview: '1',
      });
      if (patientIdFilter) params.set('patient_id', patientIdFilter);
      const res = await fetch(`/api/billing-candidates/export?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('請求CSVの出力前確認に失敗しました');
      return res.json() as Promise<BillingExportPreviewResponse>;
    },
    enabled: !!orgId,
  });

  const candidates = data?.pages.flatMap((p) => p.data) ?? [];
  const summary = data?.pages[0]?.summary ?? null;
  const exportPreview = exportPreviewQuery.data?.data ?? null;
  const targetCandidateIndex = targetCandidateId
    ? candidates.findIndex((candidate) => candidate.id === targetCandidateId)
    : -1;
  const targetCandidate = targetCandidateIndex >= 0 ? candidates[targetCandidateIndex] : null;

  useEffect(() => {
    if (!targetCandidateId || isLoading) return;
    const targetElement = document.getElementById('billing-target-candidate');
    targetElement?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [isLoading, targetCandidateId, targetCandidate]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/billing-candidates', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ billing_month: billingMonthStr, billing_domain: billingDomain }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '請求候補の生成に失敗しました');
      }
      return res.json() as Promise<{ message: string; generated?: number }>;
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ['billing-candidates', orgId] });
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
      expectedUpdatedAt: string;
    }) => {
      const res = await fetch(`/api/billing-candidates/${input.id}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          action: input.action,
          expected_updated_at: input.expectedUpdatedAt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '請求候補の更新に失敗しました');
      }
      return res.json() as Promise<{ data: BillingCandidate }>;
    },
    onSuccess: async () => {
      toast.success('請求候補を更新しました');
      await queryClient.invalidateQueries({ queryKey: ['billing-candidates', orgId] });
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
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ billing_month: billingMonthStr, billing_domain: billingDomain }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '月次締めに失敗しました');
      }
      return res.json() as Promise<{
        message: string;
        exported_count?: number;
        billing_domain?: BillingDomain;
      }>;
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      await queryClient.invalidateQueries({ queryKey: ['billing-candidates', orgId] });
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
          if (cfg.role === 'neutral') {
            return (
              <Badge variant="outline" className="w-fit text-xs">
                {cfg.label}
              </Badge>
            );
          }
          return (
            <StateBadge role={cfg.role} className="w-fit text-xs">
              {cfg.label}
            </StateBadge>
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
            layers={candidateValidationLayers(row.original)}
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
                      reviewMutation.mutate({
                        id: row.original.id,
                        action: 'confirm',
                        expectedUpdatedAt: row.original.updated_at,
                      })
                    }
                    disabled={reviewMutation.isPending}
                  >
                    確定
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      reviewMutation.mutate({
                        id: row.original.id,
                        action: 'exclude',
                        expectedUpdatedAt: row.original.updated_at,
                      })
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
                  onClick={() =>
                    reviewMutation.mutate({
                      id: row.original.id,
                      action: 'reopen',
                      expectedUpdatedAt: row.original.updated_at,
                    })
                  }
                  disabled={reviewMutation.isPending}
                >
                  差戻し
                </Button>
              )}
              {status === 'excluded' && workflow?.review_state === 'reviewed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    reviewMutation.mutate({
                      id: row.original.id,
                      action: 'reopen',
                      expectedUpdatedAt: row.original.updated_at,
                    })
                  }
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
      params.set('billing_domain', billingDomain);
      if (patientIdFilter) params.set('patient_id', patientIdFilter);
      const response = await fetch(`/api/billing-candidates/export?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message ?? 'CSVエクスポートに失敗しました');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `billing_${billingDomain}_${billingMonthStr}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('CSVをダウンロードしました');
    } catch (error) {
      toast.error(messageFromError(error, 'CSVエクスポートに失敗しました'));
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
  const exportableCount =
    exportPreview?.exportable_count ??
    candidates.filter((c) => VALIDATION_OK.includes(c.status)).length;
  const closeDisabledReason = getBillingCloseDisabledReason({
    closeBlocked,
    closeReady,
    patientIdFilter,
  });
  const csvExportDisabledReason = getBillingCsvExportDisabledReason({
    exportableCount,
    isPreviewLoading: exportPreviewQuery.isLoading,
  });
  const canExportCsv = !isExporting && !csvExportDisabledReason;

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

      {targetCandidateId ? (
        <div
          id="billing-target-candidate"
          className="rounded-md border-l-4 border-border/70 border-l-tag-info bg-card px-4 py-3 text-sm text-tag-info"
          data-testid="billing-target-candidate"
        >
          <p className="font-medium">{targetCandidate ? '対象候補を選択中' : '対象候補を検索中'}</p>
          {targetCandidate ? (
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <p>
                <span className="text-tag-info/80">候補ID:</span>{' '}
                <span className="font-mono">{targetCandidate.id}</span>
              </p>
              <p>
                <span className="text-tag-info/80">算定:</span> {targetCandidate.billing_name}
              </p>
              <p>
                <span className="text-tag-info/80">請求先:</span>{' '}
                {candidateBillingTargetLabel(targetCandidate)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs">
              候補ID {targetCandidateId}{' '}
              は現在の月・患者・請求区分の表示範囲にまだ見つかりません。月、患者、請求区分を確認するか、追加読み込みしてください。
            </p>
          )}
        </div>
      ) : null}

      {patientIdFilter ? (
        <div className="rounded-md border-l-4 border-border/70 border-l-tag-info bg-card px-4 py-3 text-sm text-tag-info">
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
        <div className="rounded-md border border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-foreground">
          <p className="font-medium text-state-confirm">締めを止めている主因</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
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
          <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 p-1">
            {BILLING_DOMAIN_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={billingDomain === option.value ? 'default' : 'ghost'}
                onClick={() => setBillingDomain(option.value)}
                aria-pressed={billingDomain === option.value}
                className="px-2 text-xs"
              >
                {option.shortLabel}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            {generateMutation.isPending
              ? '生成中...'
              : `${BILLING_DOMAIN_OPTIONS.find((option) => option.value === billingDomain)?.shortLabel}候補生成`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => closeMutation.mutate()}
            aria-describedby={closeDisabledReason ? BILLING_CLOSE_DISABLED_REASON_ID : undefined}
            disabled={closeMutation.isPending || Boolean(closeDisabledReason)}
          >
            {closeMutation.isPending
              ? '締め処理中...'
              : `${BILLING_DOMAIN_OPTIONS.find((option) => option.value === billingDomain)?.shortLabel}月次締め`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleExport()}
            aria-describedby={
              csvExportDisabledReason ? BILLING_CSV_EXPORT_DISABLED_REASON_ID : undefined
            }
            disabled={!canExportCsv}
          >
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
            {isExporting ? '出力中...' : 'CSV出力'}
          </Button>
          {closeDisabledReason ? (
            <p
              id={BILLING_CLOSE_DISABLED_REASON_ID}
              className="basis-full text-xs text-muted-foreground"
            >
              {closeDisabledReason}
            </p>
          ) : null}
          {csvExportDisabledReason ? (
            <p
              id={BILLING_CSV_EXPORT_DISABLED_REASON_ID}
              className="basis-full text-xs text-muted-foreground"
            >
              {csvExportDisabledReason}
            </p>
          ) : null}
        </ActionRail>

        <div
          className="rounded-md border border-border/70 bg-muted/20 px-4 py-3"
          data-testid="billing-export-preview"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">出力前確認</h3>
              <p className="text-xs text-muted-foreground">
                CSVに含まれる確定・締め済み候補を全件集計します。
              </p>
            </div>
            <Badge variant="outline">{exportPreviewQuery.isFetching ? '確認中' : 'CSV対象'}</Badge>
          </div>
          {exportPreviewQuery.isError ? (
            <p className="mt-2 text-xs text-destructive">出力前確認を取得できませんでした。</p>
          ) : (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">出力対象</p>
                <p className="font-semibold tabular-nums">{exportableCount}件</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">合計点数</p>
                <p className="font-semibold tabular-nums">
                  {(exportPreview?.total_points ?? 0).toLocaleString('ja-JP')}点
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">金額候補</p>
                <p className="font-semibold tabular-nums">
                  {(exportPreview?.total_amount_yen ?? 0).toLocaleString('ja-JP')}円
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">未出力候補</p>
                <p className="font-semibold tabular-nums">
                  {(
                    (exportPreview?.status_counts.candidate ?? 0) +
                    (exportPreview?.status_counts.excluded ?? 0)
                  ).toLocaleString('ja-JP')}
                  件
                </p>
              </div>
            </div>
          )}
          {exportPreview?.exclusion_reasons.length ? (
            <div className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">除外理由</p>
              <ul className="mt-1 space-y-1">
                {exportPreview.exclusion_reasons.slice(0, 3).map((item) => (
                  <li key={item.reason}>
                    {item.reason} ({item.count}件)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

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
        emptyMessage={`${billingMonthLabel} の請求候補はありません`}
        selectedRowIndex={targetCandidateIndex >= 0 ? targetCandidateIndex : undefined}
        enableRowSelection
        getRowA11yLabel={(candidate) => `${candidate.billing_name}（${candidate.billing_code}）`}
        toolbar={{
          enableGlobalFilter: true,
          globalFilterPlaceholder: '請求コード・算定名称で絞り込み',
          enableColumnVisibility: true,
          enableExport: true,
          enablePrint: true,
          exportFileName: `billing-candidates-${billingDomain}-${billingMonthStr}.csv`,
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
        errorMessage={
          isError
            ? error instanceof Error
              ? error.message
              : '請求候補の取得に失敗しました'
            : undefined
        }
        onRetry={() => void refetch()}
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
                    {(() => {
                      const validationLayers = candidateValidationLayers(candidate);
                      if (!validationLayers) {
                        return <p className="text-muted-foreground">バリデーション情報なし</p>;
                      }
                      return (
                        <>
                          {BILLING_VALIDATION_LAYER_KEYS.map((key) => {
                            const layer = validationLayers?.[key];
                            if (!layer) return null;

                            return (
                              <div key={key}>
                                <p className="font-medium text-foreground">
                                  {layer.label ?? key}
                                  {key === 'rule_engine' && layer.version
                                    ? ` / ${layer.version}`
                                    : ''}
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
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />

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
