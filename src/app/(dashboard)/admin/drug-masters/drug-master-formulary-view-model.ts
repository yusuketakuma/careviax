export type ImpactQueueKey =
  | 'action_required'
  | 'recently_changed'
  | 'transitional_expiry'
  | 'missing_reorder_point'
  | 'safety_flagged'
  | 'high_risk'
  | 'lasa_risk'
  | 'controlled'
  | 'review_due';

export function formatImportStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return '完了';
    case 'failed':
      return '失敗';
    case 'running':
      return '実行中';
    default:
      return '待機';
  }
}

export function formatBulkPreviewStatusLabel(status: string) {
  switch (status) {
    case 'create':
      return '新規採用';
    case 'update':
      return '更新';
    case 'deactivate':
      return '採用解除';
    case 'unmatched':
      return '未照合';
    case 'invalid':
      return '無効';
    default:
      return '変更なし';
  }
}

export function formatMasterChangeTypeLabel(changeType: string) {
  switch (changeType) {
    case 'price_changed':
      return '薬価変更';
    case 'transitional_expiry_changed':
      return '経過措置変更';
    default:
      return changeType;
  }
}

export function formatStockHistoryActionLabel(action: string) {
  switch (action) {
    case 'pharmacy_drug_stock_created':
      return '採用登録';
    case 'pharmacy_drug_stock_updated':
      return '採用品設定更新';
    case 'pharmacy_drug_stock_bulk_imported':
      return 'CSV一括反映';
    case 'pharmacy_drug_stock_bulk_import_summary':
      return 'CSV一括登録サマリー';
    case 'pharmacy_drug_stock_reviewed':
      return 'レビュー記録';
    default:
      return action;
  }
}

export function formatFormularyRequestActionLabel(actionType: string) {
  switch (actionType) {
    case 'adopt':
      return '採用追加';
    case 'deactivate':
      return '採用解除';
    case 'update_settings':
      return '設定変更';
    default:
      return actionType;
  }
}

type LabelOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type MasterStatusSource = {
  freshness: string;
};

export function buildDrugMasterFilterViewModel<
  TImportSource extends string,
  TImportStatus extends string,
  TCategory extends string,
>({
  masterStatusSources,
  importLogSourceOptions,
  importLogStatusOptions,
  categoryOptions,
  importLogSourceFilter,
  importLogStatusFilter,
  category,
  safetyFilters,
}: {
  masterStatusSources: MasterStatusSource[];
  importLogSourceOptions: ReadonlyArray<LabelOption<TImportSource>>;
  importLogStatusOptions: ReadonlyArray<LabelOption<TImportStatus>>;
  categoryOptions: ReadonlyArray<LabelOption<TCategory>>;
  importLogSourceFilter: TImportSource;
  importLogStatusFilter: TImportStatus;
  category: TCategory;
  safetyFilters: boolean[];
}) {
  const staleSourceCount = masterStatusSources.filter((source) =>
    ['stale', 'never'].includes(source.freshness),
  ).length;
  const agingSourceCount = masterStatusSources.filter(
    (source) => source.freshness === 'aging',
  ).length;

  return {
    staleSourceCount,
    agingSourceCount,
    selectedImportLogSourceLabel:
      importLogSourceOptions.find((option) => option.value === importLogSourceFilter)?.label ??
      'すべてのソース',
    selectedImportLogStatusLabel:
      importLogStatusOptions.find((option) => option.value === importLogStatusFilter)?.label ??
      'すべての状態',
    selectedCategoryLabel:
      categoryOptions.find((option) => option.value === category)?.label ?? '全薬効分類',
    activeSafetyFilterCount: safetyFilters.filter(Boolean).length,
  };
}

type FormularyOperationsStock = {
  drug_master: {
    yj_code: string;
    is_high_risk: boolean;
    is_lasa_risk: boolean;
    is_narcotic: boolean;
    is_psychotropic: boolean;
    transitional_expiry_date: string | null;
  };
};

type FormularyOperationsRecentChange = {
  yj_code: string;
};

type FormularyOperationsImpact<
  TStock extends FormularyOperationsStock,
  TRecentChange extends FormularyOperationsRecentChange,
  TMasterChangeReport,
  TFollowUpSummary,
> = {
  recent_changes: TRecentChange[];
  totals: {
    review_due_count: number;
    missing_reorder_point_count: number;
    safety_flagged_count: number;
    high_risk_count: number;
    lasa_risk_count: number;
    controlled_count: number;
    transitional_expiry_count: number;
    transitional_expiry_within_30_count: number;
    transitional_expiry_within_60_count: number;
    transitional_expiry_within_90_count: number;
    action_required_count: number;
    recent_master_change_count: number;
  };
  selected_queue: {
    key: ImpactQueueKey;
    rows: TStock[];
    total_count: number;
  };
  master_change_report?: TMasterChangeReport;
  follow_up_summary?: TFollowUpSummary;
  samples: Record<ImpactQueueKey, TStock[]>;
};

type FormularyOperationsUsageMismatch = {
  totals: {
    frequent_unstocked_count: number;
    unused_stocked_count: number;
  };
};

export type FormularyOperationsViewModelInput<
  TStock extends FormularyOperationsStock,
  TRecentChange extends FormularyOperationsRecentChange,
  TMasterChangeReport,
  TFollowUpSummary,
> = {
  reviewDueStocks: TStock[];
  missingReorderStocks: TStock[];
  formularyImpact:
    | FormularyOperationsImpact<TStock, TRecentChange, TMasterChangeReport, TFollowUpSummary>
    | null
    | undefined;
  formularyUsageMismatch: FormularyOperationsUsageMismatch | null | undefined;
  impactQueue: ImpactQueueKey;
  expiryReferenceTime: number;
};

export function buildFormularyOperationsViewModel<
  TStock extends FormularyOperationsStock,
  TRecentChange extends FormularyOperationsRecentChange,
  TMasterChangeReport,
  TFollowUpSummary,
>({
  reviewDueStocks,
  missingReorderStocks,
  formularyImpact,
  formularyUsageMismatch,
  impactQueue,
  expiryReferenceTime,
}: FormularyOperationsViewModelInput<
  TStock,
  TRecentChange,
  TMasterChangeReport,
  TFollowUpSummary
>) {
  const safetyReviewCount = reviewDueStocks.filter(
    (stock) =>
      stock.drug_master.is_high_risk ||
      stock.drug_master.is_lasa_risk ||
      stock.drug_master.is_narcotic ||
      stock.drug_master.is_psychotropic,
  ).length;
  const expiryWatchCount = reviewDueStocks.filter((stock) => {
    if (!stock.drug_master.transitional_expiry_date) return false;
    const expiry = new Date(stock.drug_master.transitional_expiry_date).getTime();
    return expiry - expiryReferenceTime <= 1000 * 60 * 60 * 24 * 90;
  }).length;
  const reviewDueCount = formularyImpact?.totals.review_due_count ?? reviewDueStocks.length;
  const missingReorderCount =
    formularyImpact?.totals.missing_reorder_point_count ?? missingReorderStocks.length;
  const safetyFlaggedCount = formularyImpact?.totals.safety_flagged_count ?? safetyReviewCount;
  const highRiskAdoptedCount = formularyImpact?.totals.high_risk_count ?? 0;
  const lasaRiskAdoptedCount = formularyImpact?.totals.lasa_risk_count ?? 0;
  const controlledAdoptedCount = formularyImpact?.totals.controlled_count ?? 0;
  const transitionalExpiryCount =
    formularyImpact?.totals.transitional_expiry_count ?? expiryWatchCount;
  const transitionalExpiryWithin30Count =
    formularyImpact?.totals.transitional_expiry_within_30_count ?? 0;
  const transitionalExpiryWithin60Count =
    formularyImpact?.totals.transitional_expiry_within_60_count ?? 0;
  const transitionalExpiryWithin90Count =
    formularyImpact?.totals.transitional_expiry_within_90_count ?? transitionalExpiryCount;
  const actionRequiredCount = formularyImpact?.totals.action_required_count ?? 0;
  const recentMasterChangeCount = formularyImpact?.totals.recent_master_change_count ?? 0;
  const followUpSummary = formularyImpact?.follow_up_summary;
  const frequentUnstockedMismatchCount =
    formularyUsageMismatch?.totals.frequent_unstocked_count ?? 0;
  const unusedStockedMismatchCount = formularyUsageMismatch?.totals.unused_stocked_count ?? 0;
  const recentChangesByYjCode = new Map(
    (formularyImpact?.recent_changes ?? []).map((change) => [change.yj_code, change]),
  );
  const impactQueueRows =
    formularyImpact?.selected_queue.key === impactQueue
      ? formularyImpact.selected_queue.rows
      : (formularyImpact?.samples[impactQueue] ?? []);
  const masterChangeReport = formularyImpact?.master_change_report ?? null;
  const impactQueueTotalCount =
    formularyImpact?.selected_queue.key === impactQueue
      ? formularyImpact.selected_queue.total_count
      : impactQueueRows.length;

  return {
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
  };
}
