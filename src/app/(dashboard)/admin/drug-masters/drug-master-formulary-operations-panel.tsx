'use client';

import type { Dispatch, SetStateAction } from 'react';
import {
  Building2,
  ClipboardCheck,
  Copy,
  Download,
  FileWarning,
  History,
  ListChecks,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type buildBulkPreviewViewModel,
  type buildFormularyOperationsViewModel,
  formatBulkPreviewStatusLabel,
  formatFormularyRequestActionLabel,
  formatMasterChangeTypeLabel,
  type ImpactQueueKey,
} from './drug-master-formulary-view-model';
import {
  EXPORT_PURPOSE_LABELS,
  formatFormularyTemplateSummary,
} from './drug-master-content-format';
import type {
  BulkPreviewResponse,
  FormularyChangeRequestItem,
  FormularyChangeRequestListResponse,
  FormularyCopyPreviewResponse,
  FormularyExportPurpose,
  FormularyImpactResponse,
  FormularyRecentChange,
  FormularyRequestDecisionTarget,
  FormularyStockSummaryRow,
  FormularyTemplateItem,
  FormularyTemplatePreviewResponse,
  FormularyUsageMismatchResponse,
  PharmacySiteOption,
} from './drug-master-content-types';

type QueryStatusLike = {
  isError: boolean;
  refetch: () => unknown;
};

type VariableMutationStatusLike<TVariables> = {
  isPending: boolean;
  variables: TVariables | null | undefined;
};

type ActionMutationLike = {
  isPending: boolean;
  mutate: () => void;
};

type MutationLike<TVariables> = {
  isPending: boolean;
  mutate: (variables: TVariables) => void;
};

type PendingStatusLike = {
  isPending: boolean;
};

type MutableRef<T> = {
  current: T;
};

type DryRunVariables = {
  dryRun: boolean;
};

type StockRequestDecisionVariables = {
  request_id: string;
  decision: 'approve' | 'reject';
  decision_note?: string | null;
};

type FormularyOperationsViewModel = ReturnType<
  typeof buildFormularyOperationsViewModel<
    FormularyStockSummaryRow,
    FormularyRecentChange,
    NonNullable<FormularyImpactResponse['master_change_report']>,
    NonNullable<FormularyImpactResponse['follow_up_summary']>
  >
>;

type BulkPreviewViewModel = ReturnType<
  typeof buildBulkPreviewViewModel<
    BulkPreviewResponse['preview']['summary'],
    BulkPreviewResponse['preview']['rows'][number]
  >
>;

export type FormularyOperationsPanelProps = {
  formularyOps: FormularyOperationsViewModel;
  bulkPreviewVm: BulkPreviewViewModel;
  formularyReviewQuery: QueryStatusLike;
  formularyMissingReorderQuery: QueryStatusLike;
  formularyImpactQuery: QueryStatusLike;
  formularyUsageMismatchQuery: QueryStatusLike;
  formularyRequestsQuery: QueryStatusLike;
  formularyTemplatesQuery: QueryStatusLike;
  pendingFormularyRequests: FormularyChangeRequestItem[];
  formularyRequestSummary: FormularyChangeRequestListResponse['summary'] | undefined;
  formularyUsageMismatch: FormularyUsageMismatchResponse | undefined;
  sites: PharmacySiteOption[];
  copySourceSites: PharmacySiteOption[];
  formularyTemplates: FormularyTemplateItem[];
  selectedTemplate: FormularyTemplateItem | null;
  copySourceSiteId: string;
  copyOverwrite: boolean;
  copyPreview: FormularyCopyPreviewResponse | null;
  templateName: string;
  templateSearchQuery: string;
  selectedTemplateId: string;
  templatePreview: FormularyTemplatePreviewResponse | null;
  bulkCsv: string;
  exportPurpose: FormularyExportPurpose;
  bulkPreviewExpanded: boolean;
  stockRequestDecisionMutation: VariableMutationStatusLike<StockRequestDecisionVariables>;
  safetyFollowUpMutation: ActionMutationLike;
  copyFormularyMutation: VariableMutationStatusLike<DryRunVariables> &
    MutationLike<DryRunVariables>;
  createTemplateMutation: ActionMutationLike;
  applyTemplateMutation: MutationLike<DryRunVariables> & PendingStatusLike;
  deleteTemplateMutation: PendingStatusLike;
  bulkPreviewMutation: ActionMutationLike;
  bulkImportMutation: ActionMutationLike;
  templateMutation: ActionMutationLike;
  exportMutation: ActionMutationLike;
  reviewMutation: ActionMutationLike;
  copySourceSiteIdRef: MutableRef<string>;
  overwriteRef: MutableRef<boolean>;
  effectiveSelectedSiteId: string;
  setImpactQueue: (queue: ImpactQueueKey) => void;
  openDrugDetail: (drugId: string | null) => void;
  setFormularyRequestDecisionTarget: (target: FormularyRequestDecisionTarget) => void;
  setCopySourceSiteId: (value: string) => void;
  setCopyOverwrite: (value: boolean) => void;
  setCopyPreview: (value: FormularyCopyPreviewResponse | null) => void;
  setTemplateName: (value: string) => void;
  setTemplateSearchQuery: (value: string) => void;
  applySelectedTemplateId: (value: string) => void;
  setTemplatePreview: (value: FormularyTemplatePreviewResponse | null) => void;
  setDeleteTemplateConfirmOpen: (value: boolean) => void;
  applyBulkCsv: (value: string) => void;
  setBulkPreview: (value: BulkPreviewResponse | null) => void;
  setBulkPreviewExpanded: Dispatch<SetStateAction<boolean>>;
  setExportPurpose: (value: FormularyExportPurpose) => void;
  copyCandidateYjCode: (yjCode: string) => Promise<void>;
};

export function FormularyOperationsPanel({
  formularyOps,
  bulkPreviewVm,
  formularyReviewQuery,
  formularyMissingReorderQuery,
  formularyImpactQuery,
  formularyUsageMismatchQuery,
  formularyRequestsQuery,
  formularyTemplatesQuery,
  pendingFormularyRequests,
  formularyRequestSummary,
  formularyUsageMismatch,
  sites,
  copySourceSites,
  formularyTemplates,
  selectedTemplate,
  copySourceSiteId,
  copyOverwrite,
  copyPreview,
  templateName,
  templateSearchQuery,
  selectedTemplateId,
  templatePreview,
  bulkCsv,
  exportPurpose,
  bulkPreviewExpanded,
  stockRequestDecisionMutation,
  safetyFollowUpMutation,
  copyFormularyMutation,
  createTemplateMutation,
  applyTemplateMutation,
  deleteTemplateMutation,
  bulkPreviewMutation,
  bulkImportMutation,
  templateMutation,
  exportMutation,
  reviewMutation,
  copySourceSiteIdRef,
  overwriteRef,
  effectiveSelectedSiteId,
  setImpactQueue,
  openDrugDetail,
  setFormularyRequestDecisionTarget,
  setCopySourceSiteId,
  setCopyOverwrite,
  setCopyPreview,
  setTemplateName,
  setTemplateSearchQuery,
  applySelectedTemplateId,
  setTemplatePreview,
  setDeleteTemplateConfirmOpen,
  applyBulkCsv,
  setBulkPreview,
  setBulkPreviewExpanded,
  setExportPurpose,
  copyCandidateYjCode,
}: FormularyOperationsPanelProps) {
  const {
    reviewDueCount,
    missingReorderCount,
    safetyFlaggedCount,
    highRiskAdoptedCount,
    lasaRiskAdoptedCount,
    controlledAdoptedCount,
    transitionalExpiryCount,
    transitionalExpiryWithin30Count,
    transitionalExpiryWithin60Count,
    transitionalExpiryWithin90Count,
    actionRequiredCount,
    recentMasterChangeCount,
    followUpSummary,
    frequentUnstockedMismatchCount,
    unusedStockedMismatchCount,
    recentChangesByYjCode,
    impactQueueRows,
    masterChangeReport,
    impactQueueTotalCount,
  } = formularyOps;
  const {
    bulkPreviewSummary,
    bulkPreviewBlockingCount,
    bulkPreviewRowsForDisplay,
    visibleBulkPreviewRows,
    canApplyBulkPreview,
  } = bulkPreviewVm;
  const selectedExportPurposeLabel = EXPORT_PURPOSE_LABELS[exportPurpose];

  return (
    <>
      <div className="grid gap-3 md:grid-cols-6">
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('review_due')}
        >
          <p className="text-xs text-muted-foreground">レビュー期限超過</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyReviewQuery.isError ? '取得失敗' : reviewDueCount.toLocaleString()}
          </p>
        </button>
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('missing_reorder_point')}
        >
          <p className="text-xs text-muted-foreground">在庫下限未設定</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyMissingReorderQuery.isError
              ? '取得失敗'
              : missingReorderCount.toLocaleString()}
          </p>
        </button>
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('safety_flagged')}
        >
          <p className="text-xs text-muted-foreground">安全属性あり</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyImpactQuery.isError ? '取得失敗' : safetyFlaggedCount.toLocaleString()}
          </p>
        </button>
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('transitional_expiry')}
        >
          <p className="text-xs text-muted-foreground">経過措置90日以内</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyImpactQuery.isError ? '取得失敗' : transitionalExpiryCount.toLocaleString()}
          </p>
        </button>
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('action_required')}
        >
          <p className="text-xs text-muted-foreground">要対応</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyImpactQuery.isError ? '取得失敗' : actionRequiredCount.toLocaleString()}
          </p>
        </button>
        <button
          type="button"
          className="rounded-md border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          onClick={() => setImpactQueue('recently_changed')}
        >
          <p className="text-xs text-muted-foreground">30日以内差分</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formularyImpactQuery.isError ? '取得失敗' : recentMasterChangeCount.toLocaleString()}
          </p>
        </button>
      </div>
      {(formularyReviewQuery.isError || formularyMissingReorderQuery.isError) && (
        <div className="grid gap-3 md:grid-cols-2">
          {formularyReviewQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="レビュー期限超過を読み込めませんでした"
              description="採用薬レビュー対象を表示できていません。0件ではなく取得エラーです。再読み込みしてください。"
              onRetry={() => void formularyReviewQuery.refetch()}
              retryLabel="再読み込み"
              className="px-4 py-6"
            />
          ) : null}
          {formularyMissingReorderQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="在庫下限未設定を読み込めませんでした"
              description="在庫下限未設定の採用品を表示できていません。0件ではなく取得エラーです。再読み込みしてください。"
              onRetry={() => void formularyMissingReorderQuery.refetch()}
              retryLabel="再読み込み"
              className="px-4 py-6"
            />
          ) : null}
        </div>
      )}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ClipboardCheck className="size-4" aria-hidden="true" />
            採用品変更申請
          </h2>
          <Badge
            variant={
              formularyRequestsQuery.isError
                ? 'destructive'
                : (formularyRequestSummary?.overdue_count ?? 0) > 0
                  ? 'destructive'
                  : pendingFormularyRequests.length > 0
                    ? 'secondary'
                    : 'outline'
            }
          >
            {formularyRequestsQuery.isError ? (
              '取得失敗'
            ) : (
              <>
                未承認{' '}
                {(
                  formularyRequestSummary?.total_count ?? pendingFormularyRequests.length
                ).toLocaleString()}
                件
              </>
            )}
          </Badge>
        </div>
        {formularyRequestsQuery.isError ? (
          <div className="mt-3">
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="採用品変更申請を読み込めませんでした"
              description="未承認申請を表示できていません。「申請なし」ではなく取得エラーです。再読み込みしてください。"
              onRetry={() => void formularyRequestsQuery.refetch()}
              retryLabel="再読み込み"
              className="px-4 py-6"
            />
          </div>
        ) : (
          <>
            {formularyRequestSummary && formularyRequestSummary.total_count > 0 && (
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">未承認</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formularyRequestSummary.total_count.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">7日超過</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formularyRequestSummary.overdue_count.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">最古申請</p>
                  <p className="mt-1 text-sm font-medium">
                    {formularyRequestSummary.oldest_pending_created_at
                      ? new Date(
                          formularyRequestSummary.oldest_pending_created_at,
                        ).toLocaleDateString('ja-JP')
                      : '—'}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {pendingFormularyRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">未承認の変更申請はありません。</p>
              ) : (
                pendingFormularyRequests.slice(0, 3).map((request) => (
                  <div
                    key={request.id}
                    className="rounded-md border border-border/60 bg-background px-3 py-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openDrugDetail(request.drug_master_id)}
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {formatFormularyRequestActionLabel(request.action_type)}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {new Date(request.created_at).toLocaleDateString('ja-JP')}
                          {request.reason ? ` / ${request.reason}` : ''}
                        </span>
                      </button>
                      <div className="flex flex-wrap gap-2">
                        <LoadingButton
                          type="button"
                          size="sm"
                          loading={
                            stockRequestDecisionMutation.isPending &&
                            stockRequestDecisionMutation.variables?.request_id === request.id &&
                            stockRequestDecisionMutation.variables?.decision === 'approve'
                          }
                          loadingLabel="承認中"
                          onClick={() =>
                            setFormularyRequestDecisionTarget({
                              request,
                              decision: 'approve',
                            })
                          }
                        >
                          承認
                        </LoadingButton>
                        <LoadingButton
                          type="button"
                          size="sm"
                          variant="outline"
                          loading={
                            stockRequestDecisionMutation.isPending &&
                            stockRequestDecisionMutation.variables?.request_id === request.id &&
                            stockRequestDecisionMutation.variables?.decision === 'reject'
                          }
                          loadingLabel="却下中"
                          onClick={() =>
                            setFormularyRequestDecisionTarget({
                              request,
                              decision: 'reject',
                            })
                          }
                        >
                          却下
                        </LoadingButton>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileWarning className="size-4" aria-hidden="true" />
            処方・採用品不一致
          </h2>
          <Badge
            variant={
              formularyUsageMismatchQuery.isError
                ? 'destructive'
                : frequentUnstockedMismatchCount + unusedStockedMismatchCount > 0
                  ? 'secondary'
                  : 'outline'
            }
          >
            {formularyUsageMismatchQuery.isError
              ? '取得失敗'
              : `要確認 ${(
                  frequentUnstockedMismatchCount + unusedStockedMismatchCount
                ).toLocaleString()}件`}
          </Badge>
        </div>
        {formularyUsageMismatchQuery.isError ? (
          <div className="mt-3">
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="処方・採用品不一致を読み込めませんでした"
              description="処方頻度と採用品状態の突合結果を表示できていません。候補なしではなく取得エラーです。"
              onRetry={() => void formularyUsageMismatchQuery.refetch()}
              retryLabel="再読み込み"
              className="px-4 py-6"
            />
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">90日QR処方行</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {(formularyUsageMismatch?.totals.medication_line_count ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">頻出だが未採用</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {frequentUnstockedMismatchCount.toLocaleString()}
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                <p className="text-xs text-muted-foreground">採用品だが未使用</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {unusedStockedMismatchCount.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">採用検討候補</p>
                {(formularyUsageMismatch?.frequent_unstocked ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    頻出している未採用品はありません。
                  </p>
                ) : (
                  formularyUsageMismatch?.frequent_unstocked.slice(0, 3).map((item) => (
                    <button
                      key={`${item.drug_code ?? item.drug_name}-${item.last_seen_at}`}
                      type="button"
                      className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() => {
                        if (!item.matched_drug) return;
                        openDrugDetail(item.matched_drug.id);
                      }}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        {item.drug_name ?? item.matched_drug?.drug_name ?? '名称未取得'}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {item.drug_code && <span className="font-mono">{item.drug_code}</span>}
                        <span>{item.count.toLocaleString()}回</span>
                        <span>最終 {new Date(item.last_seen_at).toLocaleDateString('ja-JP')}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">整理検討候補</p>
                {(formularyUsageMismatch?.unused_stocked ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    直近QR処方で未使用の採用品はありません。
                  </p>
                ) : (
                  formularyUsageMismatch?.unused_stocked.slice(0, 3).map((stock) => (
                    <button
                      key={stock.id}
                      type="button"
                      className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() => openDrugDetail(stock.drug_master_id)}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        {stock.drug_master.drug_name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{stock.drug_master.yj_code}</span>
                        {stock.reorder_point != null && (
                          <span>発注点 {stock.reorder_point.toLocaleString()}</span>
                        )}
                        <span>更新 {new Date(stock.updated_at).toLocaleDateString('ja-JP')}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            {formularyUsageMismatch?.totals.unmatched_drug_count ? (
              <p className="mt-3 text-xs text-muted-foreground">
                マスター未照合の処方候補{' '}
                {formularyUsageMismatch.totals.unmatched_drug_count.toLocaleString()}件は、
                名称またはYJコードの確認が必要です。
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListChecks className="size-4" aria-hidden="true" />
            影響レビューキュー
          </h2>
          <Badge
            variant={formularyImpactQuery.isError ? 'destructive' : 'outline'}
            className="text-xs"
          >
            {formularyImpactQuery.isError
              ? '取得失敗'
              : `${impactQueueTotalCount.toLocaleString()}件中${impactQueueRows.length.toLocaleString()}件表示`}
          </Badge>
        </div>
        {formularyImpactQuery.isError ? (
          <div className="mt-3">
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="採用薬影響レビューを読み込めませんでした"
              description="安全属性・期限・薬価差分の影響キューを表示できていません。対象なしではなく取得エラーです。"
              onRetry={() => void formularyImpactQuery.refetch()}
              retryLabel="再読み込み"
              className="px-4 py-6"
            />
          </div>
        ) : (
          <>
            {followUpSummary && (
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('action_required')}
                >
                  <p className="text-xs text-muted-foreground">未解決フォローアップ</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {followUpSummary.unresolved_count.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('action_required')}
                >
                  <p className="text-xs text-muted-foreground">期限超過</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {followUpSummary.overdue_count.toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => setImpactQueue('action_required')}
                >
                  <p className="text-xs text-muted-foreground">期限未設定</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {followUpSummary.missing_due_date_count.toLocaleString()}
                  </p>
                </button>
              </div>
            )}
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('high_risk')}
              >
                <p className="text-xs text-muted-foreground">ハイリスク採用品</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {highRiskAdoptedCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('lasa_risk')}
              >
                <p className="text-xs text-muted-foreground">LASA注意採用品</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {lasaRiskAdoptedCount.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('controlled')}
              >
                <p className="text-xs text-muted-foreground">規制薬採用品</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {controlledAdoptedCount.toLocaleString()}
                </p>
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">
                安全属性のある採用品のうち、未解決フォローアップがないものを30日以内の要確認にします。
              </p>
              <LoadingButton
                type="button"
                size="sm"
                variant="outline"
                loading={safetyFollowUpMutation.isPending}
                loadingLabel="作成中"
                disabled={!effectiveSelectedSiteId || safetyFlaggedCount === 0}
                onClick={() => safetyFollowUpMutation.mutate()}
              >
                安全性フォローアップ作成
              </LoadingButton>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('transitional_expiry')}
              >
                <p className="text-xs text-muted-foreground">経過措置30日以内</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {transitionalExpiryWithin30Count.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('transitional_expiry')}
              >
                <p className="text-xs text-muted-foreground">経過措置60日以内</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {transitionalExpiryWithin60Count.toLocaleString()}
                </p>
              </button>
              <button
                type="button"
                className="rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setImpactQueue('transitional_expiry')}
              >
                <p className="text-xs text-muted-foreground">経過措置90日以内</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {transitionalExpiryWithin90Count.toLocaleString()}
                </p>
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {impactQueueRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">対象の採用薬はありません。</p>
              ) : (
                impactQueueRows.slice(0, 5).map((stock) => {
                  const recentChange = recentChangesByYjCode.get(stock.drug_master.yj_code);
                  return (
                    <button
                      key={stock.id}
                      type="button"
                      className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() => openDrugDetail(stock.drug_master_id)}
                    >
                      <span className="block text-sm font-medium text-foreground">
                        {stock.drug_master.drug_name}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{stock.drug_master.yj_code}</span>
                        {stock.drug_master.drug_price != null && (
                          <span>
                            ¥{Number(stock.drug_master.drug_price).toFixed(1)}/
                            {stock.drug_master.unit ?? ''}
                          </span>
                        )}
                        {stock.follow_up_status && <span>{stock.follow_up_status}</span>}
                        {stock.drug_master.is_high_risk && <span>ハイリスク</span>}
                        {stock.drug_master.is_lasa_risk && <span>LASA</span>}
                        {(stock.drug_master.is_narcotic || stock.drug_master.is_psychotropic) && (
                          <span>規制薬</span>
                        )}
                        {stock.drug_master.transitional_expiry_date && (
                          <span>
                            経過措置{' '}
                            {new Date(
                              stock.drug_master.transitional_expiry_date,
                            ).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                        {recentChange && <span>差分: {recentChange.change_type}</span>}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
      {masterChangeReport && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="size-4" aria-hidden="true" />
              薬価改定差分レポート
            </h2>
            <Badge variant={masterChangeReport.total_count > 0 ? 'secondary' : 'outline'}>
              採用品差分 {masterChangeReport.total_count.toLocaleString()}件
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {masterChangeReport.change_type_counts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                直近30日のMHLW薬価マスター差分に該当する採用品はありません。
              </p>
            ) : (
              masterChangeReport.change_type_counts.slice(0, 3).map((item) => (
                <div
                  key={item.change_type}
                  className="rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">
                    {formatMasterChangeTypeLabel(item.change_type)}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {item.count.toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
          {masterChangeReport.price_impact && (
            <div className="mt-3 rounded-md border border-border/60 bg-background px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    薬価影響額推計（直近
                    {masterChangeReport.price_impact.usage_window_days.toLocaleString()}日QR）
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {masterChangeReport.price_impact.estimated_total_delta >= 0 ? '+' : ''}¥
                    {masterChangeReport.price_impact.estimated_total_delta.toLocaleString('ja-JP', {
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  QR {masterChangeReport.price_impact.scanned_draft_count.toLocaleString()}件
                </Badge>
              </div>
              {masterChangeReport.price_impact.rows.length > 0 && (
                <div className="mt-3 space-y-1">
                  {masterChangeReport.price_impact.rows.slice(0, 3).map((row) => (
                    <button
                      key={row.stock.id}
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-left text-xs hover:text-primary"
                      onClick={() => openDrugDetail(row.stock.drug_master_id)}
                    >
                      <span className="min-w-0 font-medium text-foreground">
                        {row.stock.drug_master.drug_name}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                        <span>{row.usage_count.toLocaleString()}回</span>
                        {row.unit_price_delta != null && (
                          <span>
                            単価差 {row.unit_price_delta >= 0 ? '+' : ''}¥
                            {row.unit_price_delta.toLocaleString('ja-JP', {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                        {row.estimated_total_delta != null && (
                          <span>
                            推計 {row.estimated_total_delta >= 0 ? '+' : ''}¥
                            {row.estimated_total_delta.toLocaleString('ja-JP', {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {masterChangeReport.rows.length > 0 && (
            <div className="mt-3 space-y-2">
              {masterChangeReport.rows.slice(0, 5).map((row) => (
                <button
                  key={row.stock.id}
                  type="button"
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                  onClick={() => openDrugDetail(row.stock.drug_master_id)}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {row.stock.drug_master.drug_name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{row.stock.drug_master.yj_code}</span>
                    {row.stock.drug_master.drug_price != null && (
                      <span>
                        ¥{Number(row.stock.drug_master.drug_price).toFixed(1)}/
                        {row.stock.drug_master.unit ?? ''}
                      </span>
                    )}
                    {row.changes.slice(0, 2).map((change) => (
                      <span key={change.id}>{formatMasterChangeTypeLabel(change.change_type)}</span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Building2 className="size-4" aria-hidden="true" />
            拠点間コピー
          </h3>
          <Badge variant="outline" className="text-xs">
            コピー先: {sites.find((site) => site.id === effectiveSelectedSiteId)?.name ?? '未選択'}
          </Badge>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(180px,260px)_auto_auto] lg:items-end">
          <div className="space-y-1">
            <span
              id="drug-master-copy-source-label"
              className="text-xs font-medium text-muted-foreground"
            >
              コピー元拠点
            </span>
            <Select
              value={copySourceSiteId}
              onValueChange={(value) => {
                const next = value === '__none__' || !value ? '' : value;
                // P1 race guard: 同期的に ref を更新（effect flush を待たない）。
                copySourceSiteIdRef.current = next;
                setCopySourceSiteId(next);
                setCopyPreview(null);
              }}
            >
              <SelectTrigger
                id="drug-master-copy-source"
                aria-labelledby="drug-master-copy-source-label"
                className="min-h-[44px] w-full sm:min-h-[44px]"
              >
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="min-h-[44px]">
                  コピー元拠点を未選択に戻す
                </SelectItem>
                {copySourceSites.map((site) => (
                  <SelectItem key={site.id} value={site.id} className="min-h-[44px]">
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={copyOverwrite}
              onChange={(event) => {
                // P1 race guard: 同期的に ref を更新（effect flush を待たない）。
                overwriteRef.current = event.target.checked;
                setCopyOverwrite(event.target.checked);
                setCopyPreview(null);
                setTemplatePreview(null);
              }}
              className="size-4 rounded border-input"
            />
            既存の採用品設定を上書き
          </label>
          <div className="flex flex-wrap gap-2">
            <LoadingButton
              type="button"
              size="sm"
              variant="outline"
              loading={
                copyFormularyMutation.isPending && copyFormularyMutation.variables?.dryRun === true
              }
              loadingLabel="確認中"
              disabled={!effectiveSelectedSiteId || !copySourceSiteId}
              onClick={() => copyFormularyMutation.mutate({ dryRun: true })}
              className="gap-1"
            >
              <ListChecks className="size-3.5" aria-hidden="true" />
              コピー差分確認
            </LoadingButton>
            <LoadingButton
              type="button"
              size="sm"
              loading={
                copyFormularyMutation.isPending && copyFormularyMutation.variables?.dryRun === false
              }
              loadingLabel="コピー中"
              disabled={!effectiveSelectedSiteId || !copySourceSiteId}
              onClick={() => copyFormularyMutation.mutate({ dryRun: false })}
              className="gap-1"
            >
              <ClipboardCheck className="size-3.5" aria-hidden="true" />
              採用品をコピー
            </LoadingButton>
          </div>
        </div>
        {copyPreview && (
          <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
            <div className="grid gap-2 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">追加</p>
                <p className="text-lg font-semibold tabular-nums">
                  {copyPreview.preview.summary.create_count.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">上書き</p>
                <p className="text-lg font-semibold tabular-nums">
                  {copyPreview.preview.summary.update_count.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">既存スキップ</p>
                <p className="text-lg font-semibold tabular-nums">
                  {copyPreview.preview.summary.skip_existing_count.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">反映予定</p>
                <p className="text-lg font-semibold tabular-nums">
                  {copyPreview.preview.summary.apply_count.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {copyPreview.preview.rows.slice(0, 3).map((row) => (
                <div
                  key={`${row.action}-${row.drug_master_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs"
                >
                  <span className="min-w-0 font-medium text-foreground">
                    {row.drug_master.drug_name}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="font-mono">{row.drug_master.yj_code}</span>
                    <Badge variant="outline" className="text-xs">
                      {row.action === 'create'
                        ? '追加'
                        : row.action === 'update'
                          ? '上書き'
                          : '既存スキップ'}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">施設別採用品テンプレート</h4>
            <Badge
              variant={formularyTemplatesQuery.isError ? 'destructive' : 'outline'}
              className="text-xs"
            >
              {formularyTemplatesQuery.isError
                ? '取得失敗'
                : `${formularyTemplates.length.toLocaleString()}件`}
            </Badge>
          </div>
          {formularyTemplatesQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="採用品テンプレートを読み込めませんでした"
              description="施設別採用品テンプレートを表示できていません。0件ではなく取得エラーです。再読み込みしてください。"
              onRetry={() => void formularyTemplatesQuery.refetch()}
              retryLabel="再読み込み"
              className="mt-3 px-4 py-6"
            />
          ) : null}
          <div className="mt-3">
            <Input
              value={templateSearchQuery}
              onChange={(event) => {
                setTemplateSearchQuery(event.target.value);
                applySelectedTemplateId('');
                setTemplatePreview(null);
              }}
              placeholder="テンプレート名・説明で検索"
              aria-label="採用品テンプレート検索"
            />
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(160px,1fr)_auto]">
            <Input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="例: 在宅内科 標準セット"
              aria-label="採用品テンプレート名"
            />
            <LoadingButton
              type="button"
              size="sm"
              variant="outline"
              loading={createTemplateMutation.isPending}
              loadingLabel="作成中"
              disabled={!effectiveSelectedSiteId || templateName.trim().length === 0}
              onClick={() => createTemplateMutation.mutate()}
            >
              現在の拠点から作成
            </LoadingButton>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(160px,1fr)_auto_auto_auto]">
            <Select
              value={selectedTemplateId}
              onValueChange={(value) => {
                const next = value === '__none__' || !value ? '' : value;
                // applySelectedTemplateId が state と ref を原子的に同期（race guard）。
                applySelectedTemplateId(next);
                setDeleteTemplateConfirmOpen(false);
                setTemplatePreview(null);
              }}
            >
              <SelectTrigger
                aria-label="適用する採用品テンプレート"
                className="min-h-[44px] w-full sm:min-h-[44px]"
              >
                <SelectValue placeholder="テンプレートを選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="min-h-[44px]">
                  テンプレートを未選択に戻す
                </SelectItem>
                {formularyTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id} className="min-h-[44px]">
                    {template.name}（{template.item_count.toLocaleString()}件）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LoadingButton
              type="button"
              size="sm"
              variant="outline"
              loading={applyTemplateMutation.isPending}
              loadingLabel="確認中"
              disabled={!effectiveSelectedSiteId || !selectedTemplateId}
              onClick={() => applyTemplateMutation.mutate({ dryRun: true })}
            >
              適用差分確認
            </LoadingButton>
            <LoadingButton
              type="button"
              size="sm"
              loading={applyTemplateMutation.isPending}
              loadingLabel="適用中"
              disabled={!effectiveSelectedSiteId || !selectedTemplateId}
              onClick={() => applyTemplateMutation.mutate({ dryRun: false })}
            >
              テンプレートを適用
            </LoadingButton>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={!selectedTemplateId || deleteTemplateMutation.isPending}
              onClick={() => setDeleteTemplateConfirmOpen(true)}
              aria-label={
                selectedTemplate
                  ? `${formatFormularyTemplateSummary(selectedTemplate)} を削除`
                  : '採用品テンプレートを削除'
              }
              title="採用品テンプレートを削除"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          {templatePreview && (
            <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
              <div className="grid gap-2 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">追加</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {templatePreview.preview.summary.create_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">上書き</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {templatePreview.preview.summary.update_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">既存スキップ</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {templatePreview.preview.summary.skip_existing_count.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">反映予定</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {templatePreview.preview.summary.apply_count.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {templatePreview.preview.rows.slice(0, 3).map((row) => (
                  <div
                    key={`${row.action}-${row.drug_master_id}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs"
                  >
                    <span className="min-w-0 font-medium text-foreground">
                      {row.drug_master.drug_name}
                    </span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-mono">{row.drug_master.yj_code}</span>
                      <Badge variant="outline" className="text-xs">
                        {row.action === 'create'
                          ? '追加'
                          : row.action === 'update'
                            ? '上書き'
                            : '既存スキップ'}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">CSV一括登録</span>
          <textarea
            value={bulkCsv}
            onChange={(event) => {
              // applyBulkCsv が state と ref を原子的に同期（race guard）。
              applyBulkCsv(event.target.value);
              setBulkPreview(null);
            }}
            placeholder="YJコード,医薬品名,採用,発注点,優先後発品YJコード,メモ"
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <LoadingButton
            type="button"
            size="sm"
            variant="outline"
            loading={bulkPreviewMutation.isPending}
            loadingLabel="確認中"
            disabled={!effectiveSelectedSiteId || bulkCsv.trim().length === 0}
            onClick={() => bulkPreviewMutation.mutate()}
            className="gap-1"
          >
            <ListChecks className="size-3.5" aria-hidden="true" />
            差分確認
          </LoadingButton>
          <LoadingButton
            type="button"
            size="sm"
            loading={bulkImportMutation.isPending}
            loadingLabel="登録中"
            disabled={!canApplyBulkPreview}
            onClick={() => bulkImportMutation.mutate()}
            className="gap-1"
          >
            <Upload className="size-3.5" aria-hidden="true" />
            一括登録
          </LoadingButton>
          <LoadingButton
            type="button"
            size="sm"
            variant="outline"
            loading={templateMutation.isPending}
            loadingLabel="取得中"
            onClick={() => templateMutation.mutate()}
            className="gap-1"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSVテンプレート
          </LoadingButton>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            CSV出力用途
            <Select
              value={exportPurpose}
              onValueChange={(value) =>
                setExportPurpose((value ?? exportPurpose) as FormularyExportPurpose)
              }
            >
              <SelectTrigger
                aria-label="CSV出力用途"
                className="min-h-[44px] min-w-[160px] sm:min-h-[44px]"
              >
                <SelectValue>{selectedExportPurposeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operations" className="min-h-[44px]">
                  運用台帳
                </SelectItem>
                <SelectItem value="audit" className="min-h-[44px]">
                  監査
                </SelectItem>
                <SelectItem value="posting" className="min-h-[44px]">
                  掲示用
                </SelectItem>
                <SelectItem value="pharmacist_review" className="min-h-[44px]">
                  薬剤師レビュー
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <LoadingButton
            type="button"
            size="sm"
            variant="outline"
            loading={exportMutation.isPending}
            loadingLabel="出力中"
            disabled={!effectiveSelectedSiteId}
            onClick={() => exportMutation.mutate()}
            className="gap-1"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSV出力
          </LoadingButton>
          <LoadingButton
            type="button"
            size="sm"
            variant="outline"
            loading={reviewMutation.isPending}
            loadingLabel="記録中"
            disabled={
              !effectiveSelectedSiteId || reviewDueCount === 0 || formularyReviewQuery.isError
            }
            onClick={() => reviewMutation.mutate()}
            className="gap-1"
          >
            <ClipboardCheck className="size-3.5" aria-hidden="true" />
            レビュー済み
          </LoadingButton>
        </div>
      </div>
      {bulkPreviewSummary && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListChecks className="size-4" aria-hidden="true" />
              CSV反映前プレビュー
            </h3>
            <Badge variant={bulkPreviewBlockingCount > 0 ? 'destructive' : 'outline'}>
              {bulkPreviewBlockingCount > 0
                ? `要確認 ${bulkPreviewBlockingCount.toLocaleString()}件`
                : '反映可能'}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">新規採用</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.createCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">更新</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.updateCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">採用解除</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.deactivateCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">変更なし</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.noChangeCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">未照合</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.unmatchedCount.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">無効</p>
              <p className="text-lg font-semibold tabular-nums">
                {bulkPreviewSummary.invalidCount.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {visibleBulkPreviewRows.map((row) => (
              <div
                key={`${row.rowNumber}-${row.status}`}
                className="rounded-md border border-border/60 bg-background px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {row.drug_name ?? row.yj_code ?? `行 ${row.rowNumber}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      行 {row.rowNumber}
                      {row.yj_code ? ` / ${row.yj_code}` : ''}
                      {row.reason ? ` / ${row.reason}` : ''}
                    </p>
                  </div>
                  <Badge
                    variant={
                      ['invalid', 'unmatched'].includes(row.status) ? 'destructive' : 'outline'
                    }
                  >
                    {formatBulkPreviewStatusLabel(row.status)}
                  </Badge>
                </div>
                {row.candidates && row.candidates.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                    {row.candidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 font-medium text-foreground">
                          {candidate.drug_name}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-mono">{candidate.yj_code}</span>
                          {candidate.generic_name && <span>{candidate.generic_name}</span>}
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label={`${candidate.drug_name}のYJコードをコピー`}
                            title="YJコードをコピー"
                            onClick={() => void copyCandidateYjCode(candidate.yj_code)}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {bulkPreviewRowsForDisplay.length > 6 && (
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setBulkPreviewExpanded((expanded) => !expanded)}
              >
                {bulkPreviewExpanded
                  ? 'プレビューを6件に絞る'
                  : `全${bulkPreviewRowsForDisplay.length.toLocaleString()}件を表示`}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
