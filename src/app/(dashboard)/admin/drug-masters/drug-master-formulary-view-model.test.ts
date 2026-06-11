import { describe, expect, it } from 'vitest';
import {
  buildBulkPreviewViewModel,
  buildDrugMasterFilterViewModel,
  buildDrugMasterSelectionViewModel,
  buildDrugMasterSiteHeaderViewModel,
  buildDrugSafetyDisplayViewModel,
  buildFormularyOperationsViewModel,
  formatBulkPreviewStatusLabel,
  formatFormularyRequestActionLabel,
  formatImportStatusLabel,
  formatMasterChangeTypeLabel,
  formatStockHistoryActionLabel,
  type ImpactQueueKey,
} from './drug-master-formulary-view-model';

type TestStock = {
  id: string;
  drug_master: {
    yj_code: string;
    is_high_risk: boolean;
    is_lasa_risk: boolean;
    is_narcotic: boolean;
    is_psychotropic: boolean;
    transitional_expiry_date: string | null;
  };
};

type TestRecentChange = {
  id: string;
  yj_code: string;
  change_type: string;
};

const emptySamples: Record<ImpactQueueKey, TestStock[]> = {
  action_required: [],
  recently_changed: [],
  transitional_expiry: [],
  missing_reorder_point: [],
  safety_flagged: [],
  high_risk: [],
  lasa_risk: [],
  controlled: [],
  review_due: [],
};

function stock(id: string, overrides: Partial<TestStock['drug_master']> = {}): TestStock {
  return {
    id,
    drug_master: {
      yj_code: `${id}-yj`,
      is_high_risk: false,
      is_lasa_risk: false,
      is_narcotic: false,
      is_psychotropic: false,
      transitional_expiry_date: null,
      ...overrides,
    },
  };
}

function impact(
  overrides: Partial<
    Parameters<typeof buildFormularyOperationsViewModel>[0]['formularyImpact']
  > = {},
) {
  const base = {
    recent_changes: [] as TestRecentChange[],
    totals: {
      review_due_count: 11,
      missing_reorder_point_count: 12,
      safety_flagged_count: 13,
      high_risk_count: 14,
      lasa_risk_count: 15,
      controlled_count: 16,
      transitional_expiry_count: 17,
      transitional_expiry_within_30_count: 18,
      transitional_expiry_within_60_count: 19,
      transitional_expiry_within_90_count: 20,
      action_required_count: 21,
      recent_master_change_count: 22,
    },
    selected_queue: {
      key: 'action_required' as const,
      rows: [] as TestStock[],
      total_count: 0,
    },
    samples: emptySamples,
  };
  return { ...base, ...overrides };
}

describe('buildFormularyOperationsViewModel', () => {
  it('prefers impact totals over fallback review and reorder counts', () => {
    const model = buildFormularyOperationsViewModel({
      reviewDueStocks: [stock('review_1')],
      missingReorderStocks: [stock('missing_1'), stock('missing_2')],
      formularyImpact: impact(),
      formularyUsageMismatch: {
        totals: {
          frequent_unstocked_count: 31,
          unused_stocked_count: 32,
        },
      },
      impactQueue: 'action_required',
      expiryReferenceTime: new Date('2026-04-01T00:00:00.000Z').getTime(),
    });

    expect(model).toMatchObject({
      reviewDueCount: 11,
      missingReorderCount: 12,
      safetyFlaggedCount: 13,
      highRiskAdoptedCount: 14,
      lasaRiskAdoptedCount: 15,
      controlledAdoptedCount: 16,
      transitionalExpiryCount: 17,
      transitionalExpiryWithin30Count: 18,
      transitionalExpiryWithin60Count: 19,
      transitionalExpiryWithin90Count: 20,
      actionRequiredCount: 21,
      recentMasterChangeCount: 22,
      frequentUnstockedMismatchCount: 31,
      unusedStockedMismatchCount: 32,
    });
  });

  it('uses selected queue rows and total count when the active queue matches', () => {
    const selectedRow = stock('selected');
    const sampledRow = stock('sampled');

    const model = buildFormularyOperationsViewModel({
      reviewDueStocks: [],
      missingReorderStocks: [],
      formularyImpact: impact({
        selected_queue: {
          key: 'high_risk',
          rows: [selectedRow],
          total_count: 9,
        },
        samples: {
          ...emptySamples,
          high_risk: [sampledRow],
        },
      }),
      formularyUsageMismatch: null,
      impactQueue: 'high_risk',
      expiryReferenceTime: new Date('2026-04-01T00:00:00.000Z').getTime(),
    });

    expect(model.impactQueueRows).toEqual([selectedRow]);
    expect(model.impactQueueTotalCount).toBe(9);
  });

  it('falls back to sampled queue rows when the selected queue is stale', () => {
    const sampledRow = stock('sampled');
    const change = {
      id: 'change_1',
      yj_code: sampledRow.drug_master.yj_code,
      change_type: 'price',
    };

    const model = buildFormularyOperationsViewModel({
      reviewDueStocks: [],
      missingReorderStocks: [],
      formularyImpact: impact({
        recent_changes: [change],
        selected_queue: {
          key: 'action_required',
          rows: [stock('selected')],
          total_count: 5,
        },
        samples: {
          ...emptySamples,
          high_risk: [sampledRow],
        },
      }),
      formularyUsageMismatch: null,
      impactQueue: 'high_risk',
      expiryReferenceTime: new Date('2026-04-01T00:00:00.000Z').getTime(),
    });

    expect(model.impactQueueRows).toEqual([sampledRow]);
    expect(model.impactQueueTotalCount).toBe(1);
    expect(model.recentChangesByYjCode.get(sampledRow.drug_master.yj_code)).toEqual(change);
  });

  it('keeps local fallbacks when impact data is unavailable', () => {
    const model = buildFormularyOperationsViewModel({
      reviewDueStocks: [
        stock('high', { is_high_risk: true }),
        stock('expiry', { transitional_expiry_date: '2026-05-01T00:00:00.000Z' }),
        stock('late_expiry', { transitional_expiry_date: '2026-12-01T00:00:00.000Z' }),
      ],
      missingReorderStocks: [stock('missing')],
      formularyImpact: null,
      formularyUsageMismatch: null,
      impactQueue: 'transitional_expiry',
      expiryReferenceTime: new Date('2026-04-01T00:00:00.000Z').getTime(),
    });

    expect(model.reviewDueCount).toBe(3);
    expect(model.missingReorderCount).toBe(1);
    expect(model.safetyFlaggedCount).toBe(1);
    expect(model.transitionalExpiryCount).toBe(1);
    expect(model.transitionalExpiryWithin90Count).toBe(1);
    expect(model.impactQueueRows).toEqual([]);
  });
});

describe('formulary label formatters', () => {
  it('formats known and fallback operational labels', () => {
    expect(formatImportStatusLabel('completed')).toBe('完了');
    expect(formatImportStatusLabel('queued')).toBe('待機');
    expect(formatBulkPreviewStatusLabel('deactivate')).toBe('採用解除');
    expect(formatBulkPreviewStatusLabel('no_change')).toBe('変更なし');
    expect(formatMasterChangeTypeLabel('price_changed')).toBe('薬価変更');
    expect(formatMasterChangeTypeLabel('custom_change')).toBe('custom_change');
    expect(formatStockHistoryActionLabel('pharmacy_drug_stock_bulk_imported')).toBe('CSV一括反映');
    expect(formatStockHistoryActionLabel('custom_action')).toBe('custom_action');
    expect(formatFormularyRequestActionLabel('update_settings')).toBe('設定変更');
    expect(formatFormularyRequestActionLabel('custom_request')).toBe('custom_request');
  });
});

describe('buildBulkPreviewViewModel', () => {
  const summary = {
    totalRows: 8,
    processableRows: 6,
    createCount: 2,
    updateCount: 2,
    deactivateCount: 1,
    noChangeCount: 1,
    unmatchedCount: 1,
    invalidCount: 1,
  };

  it('sorts blocking rows first and limits collapsed preview rows', () => {
    const model = buildBulkPreviewViewModel({
      bulkPreview: {
        preview: {
          summary,
          rows: [
            { rowNumber: 4, status: 'update', drug_name: '更新薬' },
            { rowNumber: 2, status: 'unmatched', drug_name: '未照合薬' },
            { rowNumber: 3, status: 'invalid', drug_name: '無効薬' },
            { rowNumber: 1, status: 'create', drug_name: '新規薬' },
            { rowNumber: 5, status: 'no_change', drug_name: '変更なし薬' },
            { rowNumber: 6, status: 'deactivate', drug_name: '解除薬' },
            { rowNumber: 7, status: 'update', drug_name: '更新薬2' },
          ],
        },
      },
      bulkPreviewExpanded: false,
      effectiveSelectedSiteId: 'site_1',
      bulkCsv: 'yj_code,drug_name\n1,薬剤',
    });

    expect(model.bulkPreviewBlockingCount).toBe(2);
    expect(model.bulkPreviewRowsForDisplay.map((row) => row.rowNumber)).toEqual([
      2, 3, 1, 4, 5, 6, 7,
    ]);
    expect(model.visibleBulkPreviewRows.map((row) => row.rowNumber)).toEqual([2, 3, 1, 4, 5, 6]);
    expect(model.canApplyBulkPreview).toBe(false);
  });

  it('keeps expanded preview rows complete, stable by row number, and does not mutate source rows', () => {
    const rows = [
      { rowNumber: 10, status: 'invalid' },
      { rowNumber: 2, status: 'invalid' },
      { rowNumber: 1, status: 'unmatched' },
      { rowNumber: 3, status: 'create' },
      { rowNumber: 4, status: 'update' },
      { rowNumber: 5, status: 'deactivate' },
      { rowNumber: 6, status: 'no_change' },
    ];

    const model = buildBulkPreviewViewModel({
      bulkPreview: {
        preview: {
          summary: {
            ...summary,
            unmatchedCount: 1,
            invalidCount: 2,
          },
          rows,
        },
      },
      bulkPreviewExpanded: true,
      effectiveSelectedSiteId: 'site_1',
      bulkCsv: '   \n\t',
    });

    expect(model.bulkPreviewRowsForDisplay.map((row) => row.rowNumber)).toEqual([
      1, 2, 10, 3, 4, 5, 6,
    ]);
    expect(model.visibleBulkPreviewRows).toHaveLength(7);
    expect(model.canApplyBulkPreview).toBe(false);
    expect(rows.map((row) => row.rowNumber)).toEqual([10, 2, 1, 3, 4, 5, 6]);
  });

  it('allows apply only with a selected site, non-empty csv, no blocking rows, and processable rows', () => {
    const basePreview = {
      preview: {
        summary: {
          ...summary,
          processableRows: 1,
          unmatchedCount: 0,
          invalidCount: 0,
        },
        rows: [{ rowNumber: 1, status: 'create' }],
      },
    };

    expect(
      buildBulkPreviewViewModel({
        bulkPreview: basePreview,
        bulkPreviewExpanded: true,
        effectiveSelectedSiteId: 'site_1',
        bulkCsv: 'yj_code\n123',
      }).canApplyBulkPreview,
    ).toBe(true);
    expect(
      buildBulkPreviewViewModel({
        bulkPreview: basePreview,
        bulkPreviewExpanded: true,
        effectiveSelectedSiteId: '',
        bulkCsv: 'yj_code\n123',
      }).canApplyBulkPreview,
    ).toBe(false);
    expect(
      buildBulkPreviewViewModel({
        bulkPreview: {
          preview: {
            ...basePreview.preview,
            summary: { ...basePreview.preview.summary, processableRows: 0 },
          },
        },
        bulkPreviewExpanded: true,
        effectiveSelectedSiteId: 'site_1',
        bulkCsv: 'yj_code\n123',
      }).canApplyBulkPreview,
    ).toBe(false);
  });

  it('returns empty display state without a preview', () => {
    const model = buildBulkPreviewViewModel({
      bulkPreview: null,
      bulkPreviewExpanded: true,
      effectiveSelectedSiteId: 'site_1',
      bulkCsv: 'yj_code\n123',
    });

    expect(model).toEqual({
      bulkPreviewSummary: null,
      bulkPreviewBlockingCount: 0,
      bulkPreviewRowsForDisplay: [],
      visibleBulkPreviewRows: [],
      canApplyBulkPreview: false,
    });
  });
});

describe('buildDrugMasterSiteHeaderViewModel', () => {
  it('derives the effective site, copy sources, and formulary header copy', () => {
    const model = buildDrugMasterSiteHeaderViewModel({
      variant: 'formulary',
      effectiveSelectedSiteId: 'site_1',
      sites: [
        { id: 'site_1', name: '本店' },
        { id: 'site_2', name: '分店' },
      ],
    });

    expect(model).toEqual({
      copySourceSites: [{ id: 'site_2', name: '分店' }],
      headerTitle: '採用薬マスター',
      headerDescription:
        '拠点ごとの採用品設定と優先後発品を確認し、処方受付で使う採用薬候補を整備します。',
    });
  });

  it('preserves an explicit selected site and falls back cleanly with no sites', () => {
    expect(
      buildDrugMasterSiteHeaderViewModel({
        variant: 'master',
        effectiveSelectedSiteId: 'site_2',
        sites: [
          { id: 'site_1', name: '本店' },
          { id: 'site_2', name: '分店' },
        ],
      }),
    ).toEqual({
      copySourceSites: [{ id: 'site_1', name: '本店' }],
      headerTitle: '医薬品マスター',
      headerDescription: 'SSK基本マスター・PMDA添付文書データベースの管理',
    });

    expect(
      buildDrugMasterSiteHeaderViewModel({
        variant: 'formulary',
        effectiveSelectedSiteId: '',
        sites: [],
      }).copySourceSites,
    ).toEqual([]);
  });
});

describe('buildDrugSafetyDisplayViewModel', () => {
  const baseDrug = {
    tall_man_name: null,
    is_lasa_risk: false,
    is_high_risk: false,
    is_narcotic: false,
    is_psychotropic: false,
    outpatient_injection_eligible: false,
  };

  it('treats psychotropic-only drugs as safety-warning regulated drugs', () => {
    const model = buildDrugSafetyDisplayViewModel({
      ...baseDrug,
      is_psychotropic: true,
    });

    expect(model).toEqual({
      hasSafetyWarning: true,
      safetyAttributeLabels: ['向精神薬'],
    });
  });

  it('keeps narcotic and other safety attributes in the detail warning list', () => {
    const model = buildDrugSafetyDisplayViewModel({
      ...baseDrug,
      tall_man_name: 'Tall Man Name',
      is_lasa_risk: true,
      is_high_risk: true,
      is_narcotic: true,
      outpatient_injection_eligible: true,
    });

    expect(model.hasSafetyWarning).toBe(true);
    expect(model.safetyAttributeLabels).toEqual([
      '類似薬剤名注意',
      '高リスク薬',
      '麻薬',
      '外来/在宅自己注射確認済み',
    ]);
  });

  it('does not show the safety warning panel when no safety attributes are present', () => {
    expect(buildDrugSafetyDisplayViewModel(baseDrug)).toEqual({
      hasSafetyWarning: false,
      safetyAttributeLabels: [],
    });
  });
});

describe('buildDrugMasterFilterViewModel', () => {
  it('derives source freshness counts, selected labels, and active safety filter count', () => {
    const model = buildDrugMasterFilterViewModel({
      masterStatusSources: [
        { freshness: 'fresh' },
        { freshness: 'aging' },
        { freshness: 'stale' },
        { freshness: 'never' },
      ],
      importLogSourceOptions: [
        { value: 'all', label: 'すべてのソース' },
        { value: 'ssk', label: 'SSK' },
      ],
      importLogStatusOptions: [
        { value: 'all', label: 'すべての状態' },
        { value: 'failed', label: '失敗のみ' },
      ],
      categoryOptions: [
        { value: '', label: '全薬効分類' },
        { value: '1', label: '1: 神経系及び感覚器官用医薬品' },
      ],
      importLogSourceFilter: 'ssk',
      importLogStatusFilter: 'failed',
      category: '1',
      safetyFilters: [true, false, true, false, true],
    });

    expect(model).toEqual({
      staleSourceCount: 2,
      agingSourceCount: 1,
      selectedImportLogSourceLabel: 'SSK',
      selectedImportLogStatusLabel: '失敗のみ',
      selectedCategoryLabel: '1: 神経系及び感覚器官用医薬品',
      activeSafetyFilterCount: 3,
    });
  });

  it('falls back to default labels when selected values are unknown', () => {
    const model = buildDrugMasterFilterViewModel({
      masterStatusSources: [],
      importLogSourceOptions: [],
      importLogStatusOptions: [],
      categoryOptions: [],
      importLogSourceFilter: 'unknown',
      importLogStatusFilter: 'unknown',
      category: '9',
      safetyFilters: [],
    });

    expect(model).toMatchObject({
      selectedImportLogSourceLabel: 'すべてのソース',
      selectedImportLogStatusLabel: 'すべての状態',
      selectedCategoryLabel: '全薬効分類',
      activeSafetyFilterCount: 0,
    });
  });
});

describe('buildDrugMasterSelectionViewModel', () => {
  it('derives the selected table row, pending request, and bidirectional interactions', () => {
    const model = buildDrugMasterSelectionViewModel({
      drugs: [{ id: 'drug_a' }, { id: 'drug_b' }, { id: 'drug_c' }],
      selectedDrugId: 'drug_b',
      pendingFormularyRequests: [
        { id: 'request_a', drug_master_id: 'drug_a' },
        { id: 'request_b', drug_master_id: 'drug_b' },
      ],
      detail: {
        interactions_as_a: [
          {
            id: 'interaction_a',
            severity: 'contraindicated',
            mechanism: 'CYP',
            clinical_effect: '血中濃度上昇',
            source: 'pmda_xml',
            drug_a: { id: 'drug_b', name: '対象薬' },
            drug_b: { id: 'counterpart_b', name: '相手薬B' },
          },
        ],
        interactions_as_b: [
          {
            id: 'interaction_b',
            severity: 'caution',
            mechanism: null,
            clinical_effect: null,
            source: 'manual',
            drug_a: { id: 'counterpart_a', name: '相手薬A' },
            drug_b: { id: 'drug_b', name: '対象薬' },
          },
        ],
      },
    });

    expect(model.selectedRowIndex).toBe(1);
    expect(model.selectedPendingRequest).toEqual({
      id: 'request_b',
      drug_master_id: 'drug_b',
    });
    expect(model.relatedInteractions).toEqual([
      {
        id: 'interaction_a',
        severity: 'contraindicated',
        mechanism: 'CYP',
        clinical_effect: '血中濃度上昇',
        source: 'pmda_xml',
        counterpart: { id: 'counterpart_b', name: '相手薬B' },
      },
      {
        id: 'interaction_b',
        severity: 'caution',
        mechanism: null,
        clinical_effect: null,
        source: 'manual',
        counterpart: { id: 'counterpart_a', name: '相手薬A' },
      },
    ]);
  });

  it('falls back cleanly when no selected drug or detail is available', () => {
    const model = buildDrugMasterSelectionViewModel({
      drugs: [{ id: 'drug_a' }],
      selectedDrugId: null,
      pendingFormularyRequests: [{ id: 'request_a', drug_master_id: 'drug_a' }],
      detail: null,
    });

    expect(model).toEqual({
      selectedRowIndex: undefined,
      selectedPendingRequest: null,
      relatedInteractions: [],
    });
  });

  it('does not expose a stale table index when the selected drug is absent from the current page', () => {
    const model = buildDrugMasterSelectionViewModel({
      drugs: [{ id: 'drug_a' }],
      selectedDrugId: 'drug_b',
      pendingFormularyRequests: [],
      detail: undefined,
    });

    expect(model.selectedRowIndex).toBeUndefined();
    expect(model.selectedPendingRequest).toBeNull();
  });
});
