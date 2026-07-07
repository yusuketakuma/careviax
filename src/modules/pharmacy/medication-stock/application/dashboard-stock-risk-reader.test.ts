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
        extracted_text: '湿布は残り4枚',
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
        extracted_text: 'カロナールを2錠使用',
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
