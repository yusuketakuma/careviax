import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateDisplayIdMock, upsertOperationalTaskMock } = vi.hoisted(() => ({
  allocateDisplayIdMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import {
  applyPrescriptionSupplyForIntake,
  type ApplyPrescriptionSupplyDb,
} from './apply-prescription-supply';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function buildRequestFingerprint(input: {
  prescriptionLineId: string;
  stockItemId: string;
  drugMasterId: string | null;
  drugCode: string | null;
  quantity: number;
  unit: string;
}) {
  return `medication-stock-prescription-supply-request:v1:${createHash('sha256')
    .update(
      stableStringify({
        prescription_line_id: input.prescriptionLineId,
        stock_item_id: input.stockItemId,
        drug_master_id: input.drugMasterId,
        drug_code: input.drugCode,
        quantity: input.quantity,
        unit: input.unit,
        event_type: 'prescription_supply',
      }),
    )
    .digest('hex')}`;
}

function createDb() {
  return {
    drugMaster: {
      findMany: vi.fn(),
    },
    medicationStockEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    medicationStockSnapshot: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    patientMedicationStockItem: {
      findMany: vi.fn(),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
    },
    task: {},
  };
}

function createExternalLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'line_1',
    drug_name: '湿布A',
    drug_code: '2649735S1010',
    drug_master_id: 'drug_master_1',
    source_drug_code: null,
    source_drug_code_type: null,
    dosage_form: '貼付剤',
    dose: '1回1枚',
    frequency: '疼痛時',
    days: 7,
    quantity: 10,
    unit: '枚',
    route: 'external',
    ...overrides,
  };
}

function createIntake(
  line = createExternalLine(),
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'intake_1',
    source_type: 'paper',
    prescribed_date: new Date('2026-07-07T00:00:00.000Z'),
    refill_next_dispense_date: null,
    split_dispense_total: null,
    split_dispense_current: null,
    split_next_dispense_date: null,
    cycle: {
      id: 'cycle_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
    },
    lines: [line],
    ...overrides,
  };
}

function setupExactIdentity(
  db: ReturnType<typeof createDb>,
  line = createExternalLine(),
  intakeOverrides: Partial<Record<string, unknown>> = {},
) {
  db.prescriptionIntake.findFirst.mockResolvedValue(createIntake(line, intakeOverrides));
  db.drugMaster.findMany.mockResolvedValue([
    {
      id: 'drug_master_1',
      yj_code: '2649735S1010',
      receipt_code: '640453123',
      hot_code: '123456701',
      jan_code: '4987000000000',
      drug_name: '湿布A',
      generic_name: 'ケトプロフェンテープ',
      dosage_form: '貼付剤',
      manufacturer: 'Example',
    },
  ]);
}

function setupSingleStockItem(
  db: ReturnType<typeof createDb>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  db.patientMedicationStockItem.findMany.mockResolvedValue([
    {
      id: 'stock_item_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      drug_master_id: 'drug_master_1',
      source_type: 'prescription',
      unit: 'sheet',
      default_usage_amount_per_day: '1',
      medication_category: 'external',
      ...overrides,
    },
  ]);
}

describe('applyPrescriptionSupplyForIntake', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T09:00:00.000Z'));
    vi.clearAllMocks();
    allocateDisplayIdMock.mockReset();
    upsertOperationalTaskMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-applies prescription supply only when drug identity, unit, and existing stock item are exact', async () => {
    const db = createDb();
    setupExactIdentity(db);
    setupSingleStockItem(db);
    db.medicationStockEvent.findFirst.mockResolvedValue(null);
    db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
    db.medicationStockEvent.findMany.mockResolvedValue([
      {
        id: 'observed_1',
        event_at: new Date('2026-07-06T09:00:00.000Z'),
        created_at: new Date('2026-07-06T09:00:10.000Z'),
        quantity_kind: 'observed_absolute',
        quantity_delta: null,
        observed_quantity: '4',
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
      {
        id: 'stock_event_1',
        event_at: new Date('2026-07-07T00:00:00.000Z'),
        created_at: new Date('2026-07-07T09:00:10.000Z'),
        quantity_kind: 'delta',
        quantity_delta: '10',
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
    ]);
    db.medicationStockSnapshot.upsert.mockResolvedValue({
      current_quantity: '14',
      stock_risk_level: 'ok',
      calculated_at: new Date('2026-07-07T09:00:00.000Z'),
    });
    allocateDisplayIdMock
      .mockResolvedValueOnce('msev0000000001')
      .mockResolvedValueOnce('mss0000000001');

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
      },
    );

    expect(result).toMatchObject({
      intake_id: 'intake_1',
      applied_count: 1,
      review_required_count: 0,
      skipped_count: 0,
      results: [
        {
          kind: 'applied',
          prescription_line_id: 'line_1',
          stock_item_id: 'stock_item_1',
          stock_event_id: 'stock_event_1',
          snapshot: {
            current_quantity: 14,
            stock_risk_level: 'ok',
          },
          idempotent_replay: false,
        },
      ],
    });
    expect(db.medicationStockEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          stock_item_id: 'stock_item_1',
          event_type: 'prescription_supply',
          recorded_by: 'user_1',
          quantity_kind: 'delta',
          quantity_delta: expect.anything(),
          unit: 'sheet',
          source_entity_type: 'prescription_line',
          source_entity_id: 'line_1',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('uses a structured future refill date as replenishment horizon only for exact prescription stock items', async () => {
    const db = createDb();
    setupExactIdentity(db, createExternalLine({ quantity: 1 }), {
      source_type: 'refill',
      refill_next_dispense_date: new Date('2026-07-12T00:00:00.000Z'),
    });
    setupSingleStockItem(db, { medication_category: 'regular_leftover' });
    db.medicationStockEvent.findFirst.mockResolvedValue(null);
    db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
    db.medicationStockEvent.findMany.mockResolvedValue([
      {
        id: 'observed_1',
        event_at: new Date('2026-07-06T09:00:00.000Z'),
        created_at: new Date('2026-07-06T09:00:10.000Z'),
        quantity_kind: 'observed_absolute',
        quantity_delta: null,
        observed_quantity: '1',
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
      {
        id: 'stock_event_1',
        event_at: new Date('2026-07-07T00:00:00.000Z'),
        created_at: new Date('2026-07-07T09:00:10.000Z'),
        quantity_kind: 'delta',
        quantity_delta: '1',
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
    ]);
    db.medicationStockSnapshot.upsert.mockResolvedValue({
      current_quantity: '2',
      stock_risk_level: 'shortage_expected',
      calculated_at: new Date('2026-07-07T09:00:00.000Z'),
    });
    allocateDisplayIdMock
      .mockResolvedValueOnce('msev0000000001')
      .mockResolvedValueOnce('mss0000000001');

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'applied',
      snapshot: {
        stock_risk_level: 'shortage_expected',
      },
    });
    expect(db.prescriptionIntake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          source_type: true,
          refill_next_dispense_date: true,
          split_dispense_total: true,
          split_dispense_current: true,
          split_next_dispense_date: true,
        }),
      }),
    );
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          estimated_stockout_date: new Date('2026-07-09T00:00:00.000Z'),
          stock_risk_level: 'shortage_expected',
        }),
      }),
    );
  });

  it('does not apply prescription replenishment horizons to non-prescription stock items', async () => {
    const db = createDb();
    setupExactIdentity(db, createExternalLine({ quantity: 1 }), {
      source_type: 'refill',
      refill_next_dispense_date: new Date('2026-07-12T00:00:00.000Z'),
    });
    setupSingleStockItem(db, {
      source_type: 'otc',
      medication_category: 'regular_leftover',
    });
    db.medicationStockEvent.findFirst.mockResolvedValue(null);
    db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
    db.medicationStockEvent.findMany.mockResolvedValue([
      {
        id: 'observed_1',
        event_at: new Date('2026-07-06T09:00:00.000Z'),
        created_at: new Date('2026-07-06T09:00:10.000Z'),
        quantity_kind: 'observed_absolute',
        quantity_delta: null,
        observed_quantity: '1',
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
      {
        id: 'stock_event_1',
        event_at: new Date('2026-07-07T00:00:00.000Z'),
        created_at: new Date('2026-07-07T09:00:10.000Z'),
        quantity_kind: 'delta',
        quantity_delta: '1',
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
    ]);
    db.medicationStockSnapshot.upsert.mockResolvedValue({
      current_quantity: '2',
      stock_risk_level: 'watch',
      calculated_at: new Date('2026-07-07T09:00:00.000Z'),
    });
    allocateDisplayIdMock
      .mockResolvedValueOnce('msev0000000001')
      .mockResolvedValueOnce('mss0000000001');

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'applied',
      snapshot: {
        stock_risk_level: 'watch',
      },
    });
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          estimated_stockout_date: new Date('2026-07-09T00:00:00.000Z'),
          stock_risk_level: 'watch',
        }),
      }),
    );
  });

  it('returns idempotent applied result without creating another event', async () => {
    const db = createDb();
    setupExactIdentity(db);
    setupSingleStockItem(db);
    db.medicationStockEvent.findFirst.mockResolvedValue({
      id: 'stock_event_1',
      stock_item_id: 'stock_item_1',
      request_fingerprint_hash: buildRequestFingerprint({
        prescriptionLineId: 'line_1',
        stockItemId: 'stock_item_1',
        drugMasterId: 'drug_master_1',
        drugCode: '2649735S1010',
        quantity: 10,
        unit: 'sheet',
      }),
    });
    db.medicationStockSnapshot.findFirst.mockResolvedValue({
      current_quantity: '14',
      stock_risk_level: 'ok',
      calculated_at: new Date('2026-07-07T09:00:00.000Z'),
    });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'applied',
      stock_event_id: 'stock_event_1',
      idempotent_replay: true,
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('requires review when exact stock item candidates are ambiguous', async () => {
    const db = createDb();
    setupExactIdentity(db);
    db.patientMedicationStockItem.findMany.mockResolvedValue([
      {
        id: 'stock_item_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        drug_master_id: 'drug_master_1',
        source_type: 'prescription',
        unit: 'sheet',
        default_usage_amount_per_day: null,
        medication_category: 'external',
      },
      {
        id: 'stock_item_2',
        patient_id: 'patient_1',
        case_id: null,
        drug_master_id: 'drug_master_1',
        source_type: 'prescription',
        unit: 'sheet',
        default_usage_amount_per_day: null,
        medication_category: 'external',
      },
    ]);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'ambiguous_stock_item',
      task_id: 'task_1',
      candidate_count: 2,
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('does not auto-create stock items when no exact stock item exists', async () => {
    const db = createDb();
    setupExactIdentity(db);
    db.patientMedicationStockItem.findMany.mockResolvedValue([]);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'existing_stock_item_missing',
      task_id: 'task_1',
    });
    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalled();
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('treats GS1/GTIN/JAN package-only evidence as review-only', async () => {
    const db = createDb();
    setupExactIdentity(
      db,
      createExternalLine({
        drug_master_id: null,
        drug_code: null,
        source_drug_code: '14987000000007',
        source_drug_code_type: 'gs1',
      }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'package_only_identity',
      task_id: 'task_1',
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('requires review for unsupported units and does not leak drug name or dose text into task metadata', async () => {
    const db = createDb();
    setupExactIdentity(
      db,
      createExternalLine({
        unit: '箱',
      }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'unsupported_unit',
      task_id: 'task_1',
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relatedEntityType: 'prescription_line',
        relatedEntityId: 'line_1',
        metadata: expect.objectContaining({
          prescription_line_id: 'line_1',
          reason_code: 'unsupported_unit',
        }),
      }),
    );
    const metadataText = JSON.stringify(upsertOperationalTaskMock.mock.calls[0][1].metadata);
    expect(metadataText).not.toContain('湿布A');
    expect(metadataText).not.toContain('1回1枚');
    expect(metadataText).not.toContain('疼痛時');
  });
});
