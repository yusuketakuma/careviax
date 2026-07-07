import { describe, expect, it, vi } from 'vitest';
import {
  readDashboardMedicationStockLedgerRisks,
  type DashboardMedicationStockLedgerRiskDb,
} from './dashboard-stock-risk-reader';

describe('readDashboardMedicationStockLedgerRisks', () => {
  it('does not query when restricted assignment scope is empty', async () => {
    const queryRaw = vi.fn();
    const result = await readDashboardMedicationStockLedgerRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', patientIds: [], caseIds: [], take: 10 },
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({
      rows: [],
      totalCount: 0,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
    });
  });

  it('returns bounded ledger risk rows and parses window-count metadata', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        stock_item_id: 'stock_item_1',
        stock_item_display_id: 'MS-001',
        patient_id: 'patient_1',
        case_id: null,
        display_name: '湿布A',
        ingredient_name: null,
        strength: null,
        dosage_form: null,
        route: null,
        unit: 'sheet',
        medication_category: 'topical',
        managing_party: 'family',
        equivalence_review_status: 'not_required',
        equivalence_confidence: null,
        item_updated_at: new Date(2026, 5, 12, 9, 0),
        snapshot_id: 'snapshot_1',
        current_quantity: '2',
        last_observed_quantity: '2',
        last_observed_at: null,
        estimated_daily_usage: null,
        usage_confidence: 'medium',
        estimated_stockout_date: null,
        days_until_stockout: null,
        stock_risk_level: 'urgent',
        risk_reason_code: null,
        calculated_at: new Date(2026, 5, 12, 9, 5),
        total_count: BigInt(3),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(0),
        equivalence_review_count: BigInt(1),
      },
    ]);

    const result = await readDashboardMedicationStockLedgerRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', patientIds: ['patient_1'], caseIds: ['case_1'], take: 10 },
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(1);
    expect(result.totalCount).toBe(3);
    expect(result.urgentCount).toBe(1);
    expect(result.shortageExpectedCount).toBe(1);
    expect(result.usageUnknownCount).toBe(0);
    expect(result.equivalenceReviewCount).toBe(1);
  });
});
