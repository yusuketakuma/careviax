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
