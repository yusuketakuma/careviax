import { describe, expect, it, vi } from 'vitest';

import {
  getPatientMedicationStockSummary,
  type MedicationStockSummaryDb,
} from './patient-medication-stock-summary';

function createDb(overrides: Partial<MedicationStockSummaryDb> = {}) {
  return {
    patient: {
      findFirst: vi.fn(),
    },
    patientMedicationStockItem: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    medicationStockSnapshot: {
      findMany: vi.fn(),
    },
    medicationStockEvent: {
      findMany: vi.fn(),
    },
    externalMedicationStockObservation: {
      count: vi.fn(),
    },
    ...overrides,
  } as unknown as MedicationStockSummaryDb;
}

const args = {
  orgId: 'org_1',
  patientId: 'patient_1',
  role: 'pharmacist' as const,
  userId: 'user_1',
};

describe('getPatientMedicationStockSummary', () => {
  it('returns null before reading stock tables when the patient is not visible', async () => {
    const db = createDb();
    vi.mocked(db.patient.findFirst).mockResolvedValue(null);

    await expect(getPatientMedicationStockSummary(db, args)).resolves.toBeNull();

    expect(db.patient.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        cases: {
          select: { id: true },
        },
      },
    });
    expect(db.patientMedicationStockItem.findMany).not.toHaveBeenCalled();
    expect(db.medicationStockEvent.findMany).not.toHaveBeenCalled();
  });

  it('uses patient/case-scoped stock indexes and returns summarized DTOs without source ids', async () => {
    const db = createDb();
    vi.mocked(db.patient.findFirst).mockResolvedValue({
      id: 'patient_1',
      cases: [{ id: 'case_1' }],
    } as never);
    vi.mocked(db.patientMedicationStockItem.count).mockResolvedValue(3);
    vi.mocked(db.externalMedicationStockObservation.count).mockResolvedValue(1);
    vi.mocked(db.patientMedicationStockItem.findMany).mockResolvedValue([
      {
        id: 'stock_urgent',
        display_id: 'MS-1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        display_name: '湿布',
        normalized_name: '湿布',
        ingredient_name: 'ロキソプロフェン',
        strength: '100mg',
        dosage_form: '貼付剤',
        route: '外用',
        unit: 'sheet',
        source_type: 'manual',
        medication_category: 'external',
        managing_party: 'patient',
        equivalence_review_status: 'needs_review',
        equivalence_confidence: 'ingredient_strength_form',
        active: true,
        updated_at: new Date('2026-07-07T01:00:00Z'),
      },
      {
        id: 'stock_ok',
        display_id: 'MS-2',
        patient_id: 'patient_1',
        case_id: null,
        display_name: '頓服薬',
        normalized_name: null,
        ingredient_name: null,
        strength: null,
        dosage_form: null,
        route: null,
        unit: 'dose',
        source_type: 'initial_leftover',
        medication_category: 'prn',
        managing_party: 'family',
        equivalence_review_status: 'not_required',
        equivalence_confidence: null,
        active: true,
        updated_at: new Date('2026-07-06T01:00:00Z'),
      },
    ] as never);
    vi.mocked(db.medicationStockSnapshot.findMany).mockResolvedValue([
      {
        stock_item_id: 'stock_urgent',
        current_quantity: '2',
        unit: 'sheet',
        last_observed_quantity: '4',
        last_observed_at: new Date('2026-07-06T09:00:00Z'),
        estimated_daily_usage: '2',
        usage_confidence: 'high',
        estimated_stockout_date: new Date('2026-07-08T00:00:00Z'),
        days_until_stockout: 1,
        stock_risk_level: 'urgent',
        risk_reason_code: 'before_next_visit',
        calculated_at: new Date('2026-07-07T00:00:00Z'),
      },
      {
        stock_item_id: 'stock_ok',
        current_quantity: null,
        unit: 'dose',
        last_observed_quantity: null,
        last_observed_at: null,
        estimated_daily_usage: null,
        usage_confidence: 'unknown',
        estimated_stockout_date: null,
        days_until_stockout: null,
        stock_risk_level: 'unknown',
        risk_reason_code: null,
        calculated_at: new Date('2026-07-07T00:00:00Z'),
      },
    ] as never);
    vi.mocked(db.medicationStockEvent.findMany).mockResolvedValue([
      {
        id: 'event_1',
        stock_item_id: 'stock_urgent',
        event_type: 'visit_observation',
        event_at: new Date('2026-07-06T09:00:00Z'),
        recorded_at: new Date('2026-07-06T09:05:00Z'),
        quantity_kind: 'observed_absolute',
        quantity_delta: null,
        observed_quantity: '4',
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
        source_entity_type: 'visit_record',
        source_entity_id: 'visit_record_1',
      },
    ] as never);

    const result = await getPatientMedicationStockSummary(db, {
      ...args,
      itemLimit: 10,
      eventLimit: 5,
    });

    expect(result?.data.patient_id).toBe('patient_1');
    expect(result?.data.summary).toMatchObject({
      total_item_count: 3,
      visible_item_count: 2,
      active_item_count: 3,
      urgent_count: 1,
      unknown_risk_count: 1,
      usage_unknown_count: 1,
      equivalence_review_count: 1,
      pending_external_observation_count: 1,
      last_observed_at: '2026-07-06T09:00:00.000Z',
    });
    expect(result?.data.items[0]).toMatchObject({
      id: 'stock_urgent',
      display_name: '湿布',
      snapshot: {
        current_quantity: 2,
        last_observed_quantity: 4,
        stock_risk_level: 'urgent',
      },
    });
    expect(result?.data.recent_events[0]).toMatchObject({
      id: 'event_1',
      observed_quantity: 4,
      has_source_entity: true,
    });
    expect(result?.meta).toMatchObject({
      item_limit: 10,
      event_limit: 5,
      visible_count: 2,
      hidden_count: 1,
      count_basis: 'limited_items',
      partial_failures: [],
    });

    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          active: true,
          OR: [{ case_id: null }, { case_id: { in: ['case_1'] } }],
        },
        take: 10,
        orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
        select: expect.objectContaining({
          id: true,
          display_name: true,
          updated_at: true,
        }),
      }),
    );
    expect(db.medicationStockEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          stock_item_id: { in: ['stock_urgent', 'stock_ok'] },
        },
        orderBy: [{ event_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    );
    expect(db.medicationStockSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        stock_item_id: { in: ['stock_urgent', 'stock_ok'] },
      },
      select: {
        stock_item_id: true,
        current_quantity: true,
        unit: true,
        last_observed_quantity: true,
        last_observed_at: true,
        estimated_daily_usage: true,
        usage_confidence: true,
        estimated_stockout_date: true,
        days_until_stockout: true,
        stock_risk_level: true,
        risk_reason_code: true,
        calculated_at: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('visit_record_1');
  });
});
