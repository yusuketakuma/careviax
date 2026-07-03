'use client';

import { ClipboardCheck, FileWarning, History, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  type buildFormularyOperationsViewModel,
  formatFormularyRequestActionLabel,
  formatMasterChangeTypeLabel,
  type ImpactQueueKey,
} from './drug-master-formulary-view-model';
import type {
  FormularyChangeRequestItem,
  FormularyChangeRequestListResponse,
  FormularyImpactResponse,
  FormularyRecentChange,
  FormularyRequestDecisionTarget,
  FormularyStockSummaryRow,
  FormularyUsageMismatchResponse,
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

export type FormularyOperationsPanelProps = {
  formularyOps: FormularyOperationsViewModel;
  formularyReviewQuery: QueryStatusLike;
  formularyMissingReorderQuery: QueryStatusLike;
  formularyImpactQuery: QueryStatusLike;
  formularyUsageMismatchQuery: QueryStatusLike;
  formularyRequestsQuery: QueryStatusLike;
  pendingFormularyRequests: FormularyChangeRequestItem[];
  formularyRequestSummary: FormularyChangeRequestListResponse['summary'] | undefined;
  formularyUsageMismatch: FormularyUsageMismatchResponse | undefined;
  stockRequestDecisionMutation: VariableMutationStatusLike<StockRequestDecisionVariables>;
  safetyFollowUpMutation: ActionMutationLike;
  effectiveSelectedSiteId: string;
  setImpactQueue: (queue: ImpactQueueKey) => void;
  openDrugDetail: (drugId: string | null) => void;
  setFormularyRequestDecisionTarget: (target: FormularyRequestDecisionTarget) => void;
};

export function FormularyOperationsPanel({
  formularyOps,
  formularyReviewQuery,
  formularyMissingReorderQuery,
  formularyImpactQuery,
  formularyUsageMismatchQuery,
  formularyRequestsQuery,
  pendingFormularyRequests,
  formularyRequestSummary,
  formularyUsageMismatch,
  stockRequestDecisionMutation,
  safetyFollowUpMutation,
  effectiveSelectedSiteId,
  setImpactQueue,
  openDrugDetail,
  setFormularyRequestDecisionTarget,
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
              action={{
                label: '再読み込み',
                onClick: () => void formularyReviewQuery.refetch(),
              }}
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
              action={{
                label: '再読み込み',
                onClick: () => void formularyMissingReorderQuery.refetch(),
              }}
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
              action={{
                label: '再読み込み',
                onClick: () => void formularyRequestsQuery.refetch(),
              }}
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
              action={{
                label: '再読み込み',
                onClick: () => void formularyUsageMismatchQuery.refetch(),
              }}
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
              action={{
                label: '再読み込み',
                onClick: () => void formularyImpactQuery.refetch(),
              }}
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
    </>
  );
}
