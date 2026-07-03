'use client';

import { type RefObject } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { PageSection } from '@/components/layout/page-section';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StructuredPayload } from './drug-master-content-columns';
import {
  INTERACTION_SEVERITY_LABEL,
  parseReorderPointInput,
  readAuditObject,
  REORDER_POINT_ERROR_ID,
  REORDER_POINT_ERROR_MESSAGE,
  REORDER_POINT_HELP_ID,
} from './drug-master-content-format';
import {
  formatBulkPreviewStatusLabel,
  formatStockHistoryActionLabel,
} from './drug-master-formulary-view-model';
import type {
  BulkPreviewResponse,
  DrugMasterDetail,
  FormularyChangeRequestItem,
  GenericCandidateOption,
  GenericRecommendation,
  IngredientGroupResponse,
  PharmacyDrugStockConfig,
  PharmacyDrugStockHistoryItem,
  PharmacySiteOption,
} from './drug-master-content-types';

// 親（DrugMasterOperationalContent）が所有する state/query/mutation/ref を props として
// 明示的にスレッドする。暗黙結合を避けるため、query/mutation は「子が読む最小構造」だけを
// 型で表現する（実体の react-query 型が構造的に代入可能）。
// P1 医療安全: reorderPoint ref・stockMutation・in-flight プレビューの stale-guard は
// 親が所有し続け、子は props 経由で参照するだけ（挙動を厳密保存）。

type DetailQueryLike = {
  data: DrugMasterDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

type QueryStatusLike = {
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

type MutationLike<TVariables> = {
  isPending: boolean;
  mutate: (variables: TVariables) => void;
};

type StockMutationPayload = {
  site_id: string;
  drug_master_id: string;
  is_stocked: boolean;
  preferred_generic_id?: string | null;
  reorder_point?: number | null;
  follow_up_status?:
    | 'active'
    | 'needs_review'
    | 'planned_switch'
    | 'monitoring'
    | 'resolved'
    | null;
  follow_up_reason?: string | null;
  follow_up_due_date?: string | null;
};

type StockRequestPayload = {
  site_id: string;
  drug_master_id: string;
  action_type: 'adopt' | 'deactivate' | 'update_settings';
  requested_payload: {
    is_stocked: boolean;
    reorder_point?: number | null;
    preferred_generic_id?: string | null;
    adoption_note?: string | null;
  };
  reason?: string | null;
};

type DrugSafetyDisplay = {
  hasSafetyWarning: boolean;
  safetyAttributeLabels: string[];
};

type SheetRelatedInteraction = {
  id: string;
  severity: DrugMasterDetail['interactions_as_a'][number]['severity'];
  mechanism: string | null;
  clinical_effect: string | null;
  source: DrugMasterDetail['interactions_as_a'][number]['source'];
  counterpart: { id: string; drug_name: string; yj_code: string };
};

export interface DrugMasterDetailSheetProps {
  selectedDrugId: string | null;
  openDrugDetail: (drugId: string | null) => void;
  detailQuery: DetailQueryLike;
  effectiveSelectedSiteId: string;
  sites: PharmacySiteOption[];
  stockConfig: PharmacyDrugStockConfig | null;
  stockConfigQuery: QueryStatusLike;
  selectedPendingRequest: FormularyChangeRequestItem | null;
  stockMutation: MutationLike<StockMutationPayload>;
  stockRequestMutation: MutationLike<StockRequestPayload>;
  effectivePreferredGenericId: string;
  setPreferredGenericId: (value: string) => void;
  selectedPreferredGenericLabel: string;
  preferredGenericCandidates: GenericCandidateOption[];
  preferredGenericCandidatesQuery: QueryStatusLike;
  genericRecommendations: GenericRecommendation[];
  genericRecommendationsQuery: QueryStatusLike;
  reorderPointInputRef: RefObject<HTMLInputElement | null>;
  reorderPointError: string | null;
  setReorderPointError: (value: string | null) => void;
  ingredientGroup: IngredientGroupResponse | null;
  ingredientGroupQuery: QueryStatusLike;
  stockHistory: PharmacyDrugStockHistoryItem[];
  stockHistoryQuery: QueryStatusLike;
  drugSafetyDisplay: DrugSafetyDisplay | null;
  latestPackageInsert: DrugMasterDetail['package_inserts'][number] | null;
  relatedInteractions: SheetRelatedInteraction[];
}

export function DrugMasterDetailSheet({
  selectedDrugId,
  openDrugDetail,
  detailQuery,
  effectiveSelectedSiteId,
  sites,
  stockConfig,
  stockConfigQuery,
  selectedPendingRequest,
  stockMutation,
  stockRequestMutation,
  effectivePreferredGenericId,
  setPreferredGenericId,
  selectedPreferredGenericLabel,
  preferredGenericCandidates,
  preferredGenericCandidatesQuery,
  genericRecommendations,
  genericRecommendationsQuery,
  reorderPointInputRef,
  reorderPointError,
  setReorderPointError,
  ingredientGroup,
  ingredientGroupQuery,
  stockHistory,
  stockHistoryQuery,
  drugSafetyDisplay,
  latestPackageInsert,
  relatedInteractions,
}: DrugMasterDetailSheetProps) {
  return (
    <Sheet
      open={selectedDrugId !== null}
      onOpenChange={(open) => {
        if (!open) {
          openDrugDetail(null);
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle>{detailQuery.data?.drug_name ?? '医薬品詳細'}</SheetTitle>
          <SheetDescription>
            行を選択すると最新の添付文書要約と相互作用を確認できます。
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-4">
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">医薬品詳細を読み込み中です…</p>
          ) : detailQuery.isError ? (
            <p className="text-sm text-state-blocked">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : '医薬品詳細の取得に失敗しました'}
            </p>
          ) : detailQuery.data ? (
            // 親の narrowing（detailQuery.data）を IIFE 引数として束縛し、非 optional な
            // drugDetail を closure（onClick/mutate）内でも維持する（typecheck 保存）。
            ((drugDetail: DrugMasterDetail) => (
              <>
                <PageSection
                  title="採用品設定"
                  description="対象拠点での採用状態、優先後発薬、フォローアップ、在庫下限を確認します。"
                >
                  {!effectiveSelectedSiteId ? (
                    <p className="text-sm text-muted-foreground">
                      先に対象拠点を選択してください。
                    </p>
                  ) : stockConfigQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">採用品設定を読み込み中です…</p>
                  ) : stockConfigQuery.isError ? (
                    <ErrorState
                      variant="server"
                      size="inline"
                      headingLevel={3}
                      title="採用品設定を読み込めませんでした"
                      description="採用品状態、在庫下限、採用後発薬を表示できていません。未登録ではなく取得エラーです。再読み込みしてください。"
                      action={{
                        label: '再読み込み',
                        onClick: () => void stockConfigQuery.refetch(),
                      }}
                      className="px-4 py-6"
                    />
                  ) : (
                    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {sites.find((site) => site.id === effectiveSelectedSiteId)?.name ??
                              '対象拠点'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {stockConfig?.is_stocked
                              ? '採用品として登録済みです。必要に応じて採用後発薬を指定してください。'
                              : 'この薬を採用品として登録できます。'}
                          </p>
                          {selectedPendingRequest && (
                            <p className="mt-1 text-xs font-medium text-state-confirm">
                              未承認の変更申請があります。
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {stockConfig?.is_stocked ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-transparent bg-state-done/10 text-state-done"
                            >
                              <CheckCircle2 className="size-3.5" aria-hidden="true" />
                              採用品
                            </Badge>
                          ) : (
                            <Badge variant="outline">未登録</Badge>
                          )}
                          <LoadingButton
                            type="button"
                            size="sm"
                            loading={stockMutation.isPending}
                            loadingLabel="保存中"
                            onClick={() =>
                              stockMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: drugDetail.id,
                                is_stocked: !(stockConfig?.is_stocked ?? false),
                                preferred_generic_id: stockConfig?.is_stocked
                                  ? null
                                  : effectivePreferredGenericId || null,
                                reorder_point: stockConfig?.is_stocked
                                  ? null
                                  : (stockConfig?.reorder_point ?? null),
                              })
                            }
                          >
                            {stockConfig?.is_stocked ? '採用品から外す' : '採用品に登録'}
                          </LoadingButton>
                          <LoadingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            loading={stockRequestMutation.isPending}
                            loadingLabel="申請中"
                            disabled={!effectiveSelectedSiteId || !!selectedPendingRequest}
                            onClick={() =>
                              stockRequestMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: drugDetail.id,
                                action_type: stockConfig?.is_stocked ? 'deactivate' : 'adopt',
                                requested_payload: {
                                  is_stocked: !(stockConfig?.is_stocked ?? false),
                                  preferred_generic_id: stockConfig?.is_stocked
                                    ? null
                                    : effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.is_stocked
                                    ? null
                                    : (stockConfig?.reorder_point ?? null),
                                  adoption_note: stockConfig?.adoption_note ?? null,
                                },
                                reason: stockConfig?.is_stocked
                                  ? '採用品解除の承認依頼'
                                  : '採用品追加の承認依頼',
                              })
                            }
                          >
                            変更申請
                          </LoadingButton>
                        </div>
                      </div>

                      {(drugDetail.generic_name || preferredGenericCandidates.length > 0) && (
                        <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">採用後発薬</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              一般名 {drugDetail.generic_name ?? '未設定'}{' '}
                              に対する採用後発薬を設定します。
                            </p>
                          </div>
                          <Select
                            value={effectivePreferredGenericId}
                            onValueChange={(value) => setPreferredGenericId(value ?? '')}
                          >
                            <SelectTrigger
                              aria-label="採用後発薬"
                              className="w-full min-h-[44px] sm:min-h-[44px]"
                            >
                              <SelectValue>{selectedPreferredGenericLabel}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="" className="min-h-[44px]">
                                指定しない
                              </SelectItem>
                              {preferredGenericCandidates.map((candidate) => (
                                <SelectItem
                                  key={candidate.id}
                                  value={candidate.id}
                                  className="min-h-[44px]"
                                >
                                  {candidate.drug_name} ({candidate.yj_code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {preferredGenericCandidatesQuery.isError ? (
                            <ErrorState
                              variant="server"
                              size="inline"
                              headingLevel={3}
                              title="採用後発薬候補を読み込めませんでした"
                              description="採用後発薬の候補を表示できていません。候補なしではなく取得エラーです。再読み込みしてください。"
                              action={{
                                label: '再読み込み',
                                onClick: () => void preferredGenericCandidatesQuery.refetch(),
                              }}
                              className="px-4 py-6"
                            />
                          ) : null}
                          {genericRecommendationsQuery.isError ? (
                            <ErrorState
                              variant="server"
                              size="inline"
                              headingLevel={3}
                              title="推奨後発品を読み込めませんでした"
                              description="推奨候補を表示できていません。候補なしではなく取得エラーです。再読み込みしてください。"
                              action={{
                                label: '再読み込み',
                                onClick: () => void genericRecommendationsQuery.refetch(),
                              }}
                              className="px-4 py-6"
                            />
                          ) : genericRecommendations.length > 0 ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                薬価順の推奨候補
                              </p>
                              <div className="space-y-2">
                                {genericRecommendations.slice(0, 3).map((candidate) => (
                                  <button
                                    key={candidate.id}
                                    type="button"
                                    className="w-full rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
                                    onClick={() => setPreferredGenericId(candidate.id)}
                                  >
                                    <span className="block text-sm font-medium text-foreground">
                                      {candidate.drug_name}
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <span>{candidate.yj_code}</span>
                                      <span>
                                        {candidate.drug_price != null
                                          ? `¥${Number(candidate.drug_price).toFixed(1)}/${candidate.unit ?? ''}`
                                          : '薬価未設定'}
                                      </span>
                                      {candidate.price_delta != null && (
                                        <span
                                          className={
                                            candidate.price_delta < 0
                                              ? 'font-medium text-state-done'
                                              : 'font-medium text-state-confirm'
                                          }
                                        >
                                          {candidate.price_delta < 0 ? '差額' : '増額'} ¥
                                          {Math.abs(candidate.price_delta).toFixed(1)}
                                        </span>
                                      )}
                                      {candidate.site_stock?.is_stocked && (
                                        <span className="font-medium text-state-done">
                                          採用済み
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              現在: {stockConfig?.preferred_generic?.drug_name ?? '未設定'}
                            </p>
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="保存中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: drugDetail.id,
                                  is_stocked: true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                })
                              }
                            >
                              後発薬設定を保存
                            </LoadingButton>
                          </div>
                        </div>
                      )}

                      {(drugDetail.transitional_expiry_date || stockConfig?.follow_up_status) && (
                        <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              マスター変更フォロー
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              経過措置や薬価改定で採用品の切替・継続確認が必要な場合に状態を残します。
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                stockConfig?.follow_up_status === 'resolved'
                                  ? 'outline'
                                  : drugDetail.transitional_expiry_date
                                    ? 'destructive'
                                    : 'secondary'
                              }
                              className="text-xs"
                            >
                              {stockConfig?.follow_up_status === 'resolved'
                                ? '対応済み'
                                : stockConfig?.follow_up_status === 'planned_switch'
                                  ? '切替予定'
                                  : stockConfig?.follow_up_status === 'monitoring'
                                    ? '経過観察'
                                    : '要確認'}
                            </Badge>
                            {drugDetail.transitional_expiry_date && (
                              <span className="text-xs text-muted-foreground">
                                経過措置期限:{' '}
                                {new Date(drugDetail.transitional_expiry_date).toLocaleDateString(
                                  'ja-JP',
                                )}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="記録中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: drugDetail.id,
                                  is_stocked: stockConfig?.is_stocked ?? true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                  follow_up_status: 'planned_switch',
                                  follow_up_reason: '経過措置またはマスター変更に伴う切替予定',
                                  follow_up_due_date: drugDetail.transitional_expiry_date ?? null,
                                })
                              }
                            >
                              切替予定にする
                            </LoadingButton>
                            <LoadingButton
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={stockMutation.isPending}
                              loadingLabel="記録中"
                              disabled={!effectiveSelectedSiteId}
                              onClick={() =>
                                stockMutation.mutate({
                                  site_id: effectiveSelectedSiteId,
                                  drug_master_id: drugDetail.id,
                                  is_stocked: stockConfig?.is_stocked ?? true,
                                  preferred_generic_id: effectivePreferredGenericId || null,
                                  reorder_point: stockConfig?.reorder_point ?? null,
                                  follow_up_status: 'resolved',
                                  follow_up_reason: '採用薬フォローアップ確認済み',
                                  follow_up_due_date: null,
                                })
                              }
                            >
                              対応済みにする
                            </LoadingButton>
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 rounded-md border border-border/60 bg-background p-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">在庫下限アラート</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            下限数量を下回った場合の補充アラート閾値を設定します。
                          </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">
                              下限数量
                            </span>
                            <Input
                              id="drug-master-reorder-point"
                              ref={reorderPointInputRef}
                              type="number"
                              min={0}
                              defaultValue={stockConfig?.reorder_point ?? ''}
                              aria-invalid={reorderPointError ? true : undefined}
                              aria-describedby={
                                reorderPointError
                                  ? `${REORDER_POINT_HELP_ID} ${REORDER_POINT_ERROR_ID}`
                                  : REORDER_POINT_HELP_ID
                              }
                              onChange={() => {
                                if (reorderPointError) {
                                  setReorderPointError(null);
                                }
                              }}
                              placeholder="例: 10"
                              className="w-32"
                            />
                            <span
                              id={REORDER_POINT_HELP_ID}
                              className="block text-xs text-muted-foreground"
                            >
                              0以上の整数、または空欄で未設定にします。
                            </span>
                          </label>
                          <LoadingButton
                            type="button"
                            size="sm"
                            variant="outline"
                            loading={stockMutation.isPending}
                            loadingLabel="保存中"
                            disabled={!effectiveSelectedSiteId}
                            aria-describedby={
                              reorderPointError ? REORDER_POINT_ERROR_ID : undefined
                            }
                            onClick={() => {
                              const rawValue = reorderPointInputRef.current?.value?.trim() ?? '';
                              const parsedValue = parseReorderPointInput(rawValue);
                              if (!parsedValue.ok) {
                                setReorderPointError(REORDER_POINT_ERROR_MESSAGE);
                                return;
                              }
                              setReorderPointError(null);

                              stockMutation.mutate({
                                site_id: effectiveSelectedSiteId,
                                drug_master_id: drugDetail.id,
                                is_stocked: stockConfig?.is_stocked ?? true,
                                preferred_generic_id: effectivePreferredGenericId || null,
                                reorder_point: parsedValue.value,
                              });
                            }}
                          >
                            アラート閾値を保存
                          </LoadingButton>
                        </div>
                        {reorderPointError ? (
                          <p
                            id={REORDER_POINT_ERROR_ID}
                            role="alert"
                            className="text-sm text-destructive"
                          >
                            {reorderPointError}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          現在値:{' '}
                          {stockConfig?.reorder_point != null
                            ? `${stockConfig.reorder_point}単位`
                            : '未設定'}
                        </p>
                      </div>
                    </div>
                  )}
                </PageSection>

                {(ingredientGroupQuery.isError || (ingredientGroup && ingredientGroup.summary)) && (
                  <PageSection
                    title="同一成分グループ"
                    description="同一一般名の薬剤、後発品、採用済み数、薬価帯を比較します。"
                  >
                    {ingredientGroupQuery.isError ? (
                      <ErrorState
                        variant="server"
                        size="inline"
                        headingLevel={3}
                        title="同一成分グループを読み込めませんでした"
                        description="同一一般名の比較データを表示できていません。未設定ではなく取得エラーです。再読み込みしてください。"
                        action={{
                          label: '再読み込み',
                          onClick: () => void ingredientGroupQuery.refetch(),
                        }}
                      />
                    ) : ingredientGroup && ingredientGroup.summary ? (
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                        <div className="grid gap-2 sm:grid-cols-4">
                          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">同一一般名</p>
                            <p className="mt-1 text-lg font-semibold tabular-nums">
                              {ingredientGroup.summary.member_count.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">後発品</p>
                            <p className="mt-1 text-lg font-semibold tabular-nums">
                              {ingredientGroup.summary.generic_count.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">採用済み</p>
                            <p className="mt-1 text-lg font-semibold tabular-nums">
                              {ingredientGroup.summary.stocked_count.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                            <p className="text-xs text-muted-foreground">薬価帯</p>
                            <p className="mt-1 text-sm font-semibold">
                              {ingredientGroup.summary.lowest_price != null &&
                              ingredientGroup.summary.highest_price != null
                                ? `¥${ingredientGroup.summary.lowest_price.toFixed(1)}-¥${ingredientGroup.summary.highest_price.toFixed(1)}`
                                : '未設定'}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {ingredientGroup.members.slice(0, 5).map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-left hover:bg-muted/40"
                              onClick={() => openDrugDetail(member.id)}
                            >
                              <span className="block text-sm font-medium text-foreground">
                                {member.drug_name}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-mono">{member.yj_code}</span>
                                <span>{member.is_generic ? '後発品' : '先発/準先発'}</span>
                                {member.drug_price != null && (
                                  <span>
                                    ¥{Number(member.drug_price).toFixed(1)}/{member.unit ?? ''}
                                  </span>
                                )}
                                {member.site_stock?.is_stocked ? (
                                  <span className="font-medium text-state-done">採用済み</span>
                                ) : (
                                  <span>未採用</span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </PageSection>
                )}

                <PageSection
                  title="採用品変更履歴"
                  description="対象拠点での採用品変更、CSV反映、承認操作の直近履歴を確認します。"
                >
                  {!effectiveSelectedSiteId ? (
                    <p className="text-sm text-muted-foreground">
                      対象拠点を選択すると採用品の変更履歴を確認できます。
                    </p>
                  ) : stockHistoryQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">採用品履歴を読み込み中です…</p>
                  ) : stockHistoryQuery.isError ? (
                    <ErrorState
                      variant="server"
                      size="inline"
                      headingLevel={3}
                      title="採用品変更履歴を読み込めませんでした"
                      description="採用品変更履歴を表示できていません。履歴なしではなく取得エラーです。再読み込みしてください。"
                      action={{
                        label: '再読み込み',
                        onClick: () => void stockHistoryQuery.refetch(),
                      }}
                      className="px-4 py-6"
                    />
                  ) : stockHistory.length === 0 ? (
                    <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      この薬剤の採用品変更履歴はまだありません。
                    </p>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                      {stockHistory.slice(0, 5).map((item) => {
                        const changes = readAuditObject(item.changes);
                        return (
                          <div
                            key={item.id}
                            className="rounded-md border border-border/60 bg-background px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">
                                {formatStockHistoryActionLabel(item.action)}
                              </p>
                              <Badge variant="outline" className="text-xs">
                                {new Date(item.created_at).toLocaleDateString('ja-JP')}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              操作者: {item.actor_id}
                            </p>
                            {Boolean(changes.row_number || changes.status) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                行 {String(changes.row_number ?? '—')} / 状態{' '}
                                {formatBulkPreviewStatusLabel(
                                  String(
                                    changes.status ?? '',
                                  ) as BulkPreviewResponse['preview']['rows'][number]['status'],
                                )}
                              </p>
                            )}
                            {Boolean(changes.summary) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                反映 {String(readAuditObject(changes.summary).processableRows ?? 0)}
                                件 / 未照合{' '}
                                {String(readAuditObject(changes.summary).unmatchedCount ?? 0)}件 /
                                無効 {String(readAuditObject(changes.summary).invalidCount ?? 0)}件
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </PageSection>

                <PageSection
                  title="薬剤基本情報・安全属性"
                  description="YJ/HOTコード、薬価、経過措置、高リスク・LASA属性を確認します。"
                  tone={drugSafetyDisplay?.hasSafetyWarning ? 'warning' : 'default'}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">YJ {drugDetail.yj_code}</Badge>
                    {drugDetail.hot_code && (
                      <Badge variant="outline">HOT {drugDetail.hot_code}</Badge>
                    )}
                    {drugDetail.is_generic && <Badge variant="outline">後発品</Badge>}
                    {drugDetail.is_narcotic && (
                      <Badge variant="outline" className="border-tag-hazard/30 text-tag-hazard">
                        麻薬
                      </Badge>
                    )}
                    {drugDetail.is_psychotropic && (
                      <Badge variant="outline" className="border-tag-hazard/30 text-tag-hazard">
                        向精神
                      </Badge>
                    )}
                    {drugDetail.is_high_risk && (
                      <Badge variant="outline" className="border-tag-hazard/30 text-tag-hazard">
                        ハイリスク薬
                      </Badge>
                    )}
                    {drugDetail.outpatient_injection_eligible && (
                      <Badge variant="outline" className="border-tag-info/30 text-tag-info">
                        外来/在宅自己注射確認済み
                      </Badge>
                    )}
                    {drugDetail.is_lasa_risk && (
                      <Badge variant="outline" className="border-tag-hazard/30 text-tag-hazard">
                        LASA注意
                      </Badge>
                    )}
                  </div>
                  {drugSafetyDisplay?.hasSafetyWarning && (
                    <div className="rounded-lg border border-tag-hazard/30 bg-tag-hazard/10 p-4 text-sm text-foreground">
                      <h2 className="font-semibold text-tag-hazard">薬剤名・高リスク確認</h2>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-medium text-tag-hazard">表示名</dt>
                          <dd className="mt-0.5 font-medium">
                            {drugDetail.tall_man_name ?? drugDetail.drug_name}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-tag-hazard">通常表記</dt>
                          <dd className="mt-0.5">{drugDetail.drug_name}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-tag-hazard">LASAグループ</dt>
                          <dd className="mt-0.5">{drugDetail.lasa_group_key ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-tag-hazard">安全属性</dt>
                          <dd className="mt-0.5">
                            {drugSafetyDisplay.safetyAttributeLabels.join(' / ') || '—'}
                          </dd>
                        </div>
                        {drugDetail.outpatient_injection_note && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-tag-hazard">
                              自己注射確認メモ
                            </dt>
                            <dd className="mt-0.5">{drugDetail.outpatient_injection_note}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                  <dl className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        一般名
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {drugDetail.generic_name ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        薬効分類
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {drugDetail.therapeutic_category ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        薬価
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {drugDetail.drug_price != null
                          ? `¥${Number(drugDetail.drug_price).toFixed(1)}/${drugDetail.unit ?? ''}`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        最大投与日数
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {drugDetail.max_administration_days ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        経過措置期限
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {drugDetail.transitional_expiry_date
                          ? new Date(drugDetail.transitional_expiry_date).toLocaleDateString(
                              'ja-JP',
                            )
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        最新改訂
                      </dt>
                      <dd className="mt-1 text-sm text-foreground">
                        {latestPackageInsert?.revised_at
                          ? new Date(latestPackageInsert.revised_at).toLocaleDateString('ja-JP')
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                </PageSection>

                <PageSection
                  title="添付文書詳細"
                  description="禁忌、重大な副作用、腎機能別用量調整、高齢者への注意を確認します。"
                >
                  <div className="grid gap-4">
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">禁忌</h3>
                      <StructuredPayload value={latestPackageInsert?.contraindications} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">重大な副作用</h3>
                      <StructuredPayload value={latestPackageInsert?.adverse_effects} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">腎機能別用量調整</h3>
                      <StructuredPayload value={latestPackageInsert?.dosage_adjustment_renal} />
                    </div>
                    <div className="rounded-lg border border-border/60 p-4">
                      <h3 className="mb-2 text-sm font-medium text-foreground">高齢者への注意</h3>
                      <StructuredPayload value={latestPackageInsert?.precautions_elderly} />
                    </div>
                  </div>
                </PageSection>

                <PageSection
                  title="相互作用一覧"
                  description="相互作用の重症度、対象薬剤、機序、臨床影響を確認します。"
                >
                  {relatedInteractions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      直近の相互作用データはまだ登録されていません。
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {relatedInteractions.map((interaction) => (
                        <div
                          key={interaction.id}
                          className="rounded-lg border border-border/60 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                interaction.severity === 'contraindicated'
                                  ? 'destructive'
                                  : 'outline'
                              }
                            >
                              {INTERACTION_SEVERITY_LABEL[interaction.severity]}
                            </Badge>
                            <span className="text-sm font-medium text-foreground">
                              {interaction.counterpart.drug_name}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {interaction.counterpart.yj_code}
                            </span>
                          </div>
                          {interaction.mechanism && (
                            <p className="mt-2 text-sm text-muted-foreground">
                              機序: {interaction.mechanism}
                            </p>
                          )}
                          {interaction.clinical_effect && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              臨床影響: {interaction.clinical_effect}
                            </p>
                          )}
                          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                            source: {interaction.source}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </PageSection>
              </>
            ))(detailQuery.data)
          ) : (
            <p className="text-sm text-muted-foreground">一覧から医薬品を選択してください。</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
