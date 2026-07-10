import { describe, expect, it, vi } from 'vitest';
import {
  readDashboardMedicationStockLedgerRisks,
  readDashboardMedicationStockSignalRisks,
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
      unitMismatchCount: 0,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
    });
  });

  it('preserves a unit-mismatch count beyond the returned ledger row limit', async () => {
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
        snapshot_unit_mismatch: false,
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
        unit_mismatch_count: BigInt(1),
        urgent_count: BigInt(1),
        shortage_expected_count: BigInt(1),
        usage_unknown_count: BigInt(0),
        equivalence_review_count: BigInt(1),
      },
    ]);

    const result = await readDashboardMedicationStockLedgerRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', patientIds: ['patient_1'], caseIds: ['case_1'], take: 1 },
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(1);
    expect(result.totalCount).toBe(3);
    expect(result.unitMismatchCount).toBe(1);
    expect(result.urgentCount).toBe(1);
    expect(result.shortageExpectedCount).toBe(1);
    expect(result.usageUnknownCount).toBe(0);
    expect(result.equivalenceReviewCount).toBe(1);
    const query = queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toContain(1);
  });

  it('retains a mismatched stock item while suppressing every snapshot-derived value', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        stock_item_id: 'stock_item_mismatch',
        stock_item_display_id: 'MS-MISMATCH',
        patient_id: 'patient_1',
        case_id: 'case_1',
        display_name: '単位確認薬',
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
        snapshot_unit_mismatch: true,
        snapshot_id: 'snapshot_mismatch_secret',
        current_quantity: '777',
        last_observed_quantity: '444',
        last_observed_at: new Date(2026, 5, 12, 8, 0),
        estimated_daily_usage: '333',
        usage_confidence: 'high',
        estimated_stockout_date: new Date(2026, 5, 13, 0, 0),
        days_until_stockout: 1,
        stock_risk_level: 'urgent',
        risk_reason_code: 'raw-mismatch-reason',
        calculated_at: new Date(2026, 5, 12, 9, 5),
        total_count: BigInt(1),
        unit_mismatch_count: BigInt(1),
        urgent_count: BigInt(0),
        shortage_expected_count: BigInt(0),
        usage_unknown_count: BigInt(0),
        equivalence_review_count: BigInt(0),
      },
    ]);

    const result = await readDashboardMedicationStockLedgerRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', patientIds: ['patient_1'], caseIds: ['case_1'], take: 10 },
    );

    expect(result).toMatchObject({
      totalCount: 1,
      unitMismatchCount: 1,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
      rows: [
        {
          stock_item_id: 'stock_item_mismatch',
          unit: 'sheet',
          snapshot_unit_mismatch: true,
          snapshot_id: null,
          current_quantity: null,
          last_observed_quantity: null,
          last_observed_at: null,
          estimated_daily_usage: null,
          usage_confidence: null,
          estimated_stockout_date: null,
          days_until_stockout: null,
          stock_risk_level: null,
          risk_reason_code: null,
          calculated_at: null,
        },
      ],
    });
    const serializedRows = JSON.stringify(result.rows, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serializedRows).not.toContain('snapshot_mismatch_secret');
    expect(serializedRows).not.toContain('raw-mismatch-reason');

    const query = queryRaw.mock.calls[0][0] as { strings: string[] };
    const sql = query.strings.join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('snapshot."unit" IS DISTINCT FROM item."unit"');
    expect(sql).toContain(
      'CASE WHEN snapshot."unit" = item."unit" THEN snapshot."current_quantity" END',
    );
    expect(sql).toContain(
      'CASE WHEN snapshot."unit" = item."unit" THEN snapshot."risk_reason_code" END',
    );
    expect(sql).toContain(
      'WHERE snapshot."id" IS NOT NULL AND snapshot."unit" IS DISTINCT FROM item."unit"',
    );
    expect(sql).toContain(
      'WHERE snapshot."unit" = item."unit" AND snapshot."stock_risk_level"::text = \'urgent\'',
    );
    expect(sql).toContain(
      'CASE WHEN snapshot."unit" = item."unit" THEN snapshot."estimated_stockout_date" END',
    );
    expect(sql).toContain(
      'CASE WHEN snapshot."unit" = item."unit" THEN snapshot."calculated_at" END',
    );
  });
});

describe('readDashboardMedicationStockSignalRisks', () => {
  it('does not query when restricted assignment scope is empty', async () => {
    const queryRaw = vi.fn();
    const result = await readDashboardMedicationStockSignalRisks(
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
      linkedToStockEventCount: 0,
    });
  });

  it('does not query when take is zero', async () => {
    const queryRaw = vi.fn();
    const result = await readDashboardMedicationStockSignalRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', take: 0 },
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({
      rows: [],
      totalCount: 0,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
      linkedToStockEventCount: 0,
    });
  });

  it('returns bounded signal risk rows and parses window-count metadata', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'signal_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        inbound_event_id: 'event_1',
        signal_type: 'observed_quantity',
        extracted_medication_name: '湿布A',
        extracted_quantity: 4,
        extracted_unit: '枚',
        source_confidence: 'text_parsed_high',
        review_status: 'needs_review',
        action_status: 'not_linked',
        created_at: new Date(2026, 5, 12, 9, 0),
        updated_at: new Date(2026, 5, 12, 9, 5),
        inbound_event_patient_id: 'patient_1',
        inbound_event_case_id: 'case_1',
        inbound_event_source_channel: 'mcs',
        inbound_event_sender_role: 'nurse',
        inbound_event_normalized_summary: '湿布残数4枚',
        inbound_event_received_at: new Date(2026, 5, 12, 8, 55),
        total_count: BigInt(7),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(3),
        usage_unknown_count: BigInt(4),
        equivalence_review_count: BigInt(5),
        linked_to_stock_event_count: BigInt(1),
      },
      {
        id: 'signal_2',
        patient_id: 'patient_2',
        case_id: null,
        inbound_event_id: 'event_2',
        signal_type: 'usage_delta',
        extracted_medication_name: 'カロナール',
        extracted_quantity: 2,
        extracted_unit: '錠',
        source_confidence: 'manual',
        review_status: 'accepted',
        action_status: 'linked_to_task',
        created_at: new Date(2026, 5, 12, 8, 0),
        updated_at: new Date(2026, 5, 12, 8, 10),
        inbound_event_patient_id: 'patient_2',
        inbound_event_case_id: null,
        inbound_event_source_channel: 'phone',
        inbound_event_sender_role: 'family',
        inbound_event_normalized_summary: 'カロナール使用報告',
        inbound_event_received_at: new Date(2026, 5, 12, 8, 5),
        total_count: BigInt(7),
        urgent_count: BigInt(2),
        shortage_expected_count: BigInt(3),
        usage_unknown_count: BigInt(4),
        equivalence_review_count: BigInt(5),
        linked_to_stock_event_count: BigInt(1),
      },
    ]);

    const result = await readDashboardMedicationStockSignalRisks(
      { $queryRaw: queryRaw } as DashboardMedicationStockLedgerRiskDb,
      { orgId: 'org_1', patientIds: ['patient_1'], caseIds: ['case_1'], take: 10 },
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(7);
    expect(result.urgentCount).toBe(2);
    expect(result.shortageExpectedCount).toBe(3);
    expect(result.usageUnknownCount).toBe(4);
    expect(result.equivalenceReviewCount).toBe(5);
    expect(result.linkedToStockEventCount).toBe(1);
  });
});
