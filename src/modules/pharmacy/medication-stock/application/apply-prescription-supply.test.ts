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
import {
  buildRequestFingerprint,
  createDb,
  createExternalLine,
  createIntake,
  createPackageLine,
  setupExactIdentity,
  setupPackageIdentity,
  setupSingleStockItem,
} from './apply-prescription-supply.test-support';

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
    setupSingleStockItem(db, { equivalence_review_status: 'needs_review' });
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

  it('constrains an explicit review selection to one prescription line and stock item', async () => {
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
        reviewSelection: {
          prescriptionLineId: 'line_1',
          stockItemId: 'stock_item_1',
        },
      },
    );

    expect(result.results[0]).toMatchObject({ kind: 'applied', idempotent_replay: true });
    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'stock_item_1' }),
      }),
    );
  });

  it('returns not found without stock queries when a selected prescription line is absent', async () => {
    const db = createDb();
    setupExactIdentity(db);

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
        reviewSelection: {
          prescriptionLineId: 'line_missing',
          stockItemId: 'stock_item_1',
        },
      },
    );

    expect(result.results).toEqual([
      {
        kind: 'not_found',
        prescription_line_id: 'line_missing',
        reason_code: 'prescription_line_not_found',
      },
    ]);
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.drugPackage.findMany).not.toHaveBeenCalled();
    expect(db.patientMedicationStockItem.findMany).not.toHaveBeenCalled();
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
        equivalence_review_status: 'not_required',
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
        equivalence_review_status: 'not_required',
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

  it.each(['needs_review', 'uncertain', 'legacy_none'])(
    'creates a review task instead of applying supply to a %s stock item',
    async (equivalenceReviewStatus) => {
      const db = createDb();
      setupExactIdentity(db);
      setupSingleStockItem(db, { equivalence_review_status: equivalenceReviewStatus });
      upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

      const result = await applyPrescriptionSupplyForIntake(
        db as unknown as ApplyPrescriptionSupplyDb,
        {
          orgId: 'org_1',
          userId: 'user_1',
          intakeId: 'intake_1',
        },
      );

      expect(result.results[0]).toEqual({
        kind: 'review_required',
        prescription_line_id: 'line_1',
        reason_code: 'equivalence_review_pending',
        task_id: 'task_1',
        candidate_count: 1,
      });
      expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
      expect(db.medicationStockSnapshot.upsert).not.toHaveBeenCalled();
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason_code: 'equivalence_review_pending',
            candidate_count: 1,
          }),
        }),
      );
    },
  );

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

  it('requires review when GS1/GTIN/JAN package evidence has no exact active package', async () => {
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
    db.drugPackage.findMany.mockResolvedValue([]);
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

  it('converts an exact sales-package count and applies it only to the matching package stock item', async () => {
    const db = createDb();
    setupPackageIdentity(db);
    setupSingleStockItem(db, { drug_package_id: 'drug_package_1' });
    db.medicationStockEvent.findFirst.mockResolvedValue(null);
    db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
    db.medicationStockEvent.findMany.mockResolvedValue([
      {
        id: 'stock_event_1',
        event_at: new Date('2026-07-07T00:00:00.000Z'),
        created_at: new Date('2026-07-07T09:00:10.000Z'),
        quantity_kind: 'delta',
        quantity_delta: '100',
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
        unit: 'sheet',
      },
    ]);
    db.medicationStockSnapshot.upsert.mockResolvedValue({
      current_quantity: '100',
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
      },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'applied',
      stock_item_id: 'stock_item_1',
      snapshot: { current_quantity: 100 },
    });
    expect(db.drugPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_active: true,
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
            {
              OR: [
                { effective_from: null },
                { effective_from: { lte: new Date('2026-07-07T00:00:00.000Z') } },
              ],
            },
            {
              OR: [
                { effective_to: null },
                { effective_to: { gte: new Date('2026-07-07T00:00:00.000Z') } },
              ],
            },
          ]),
        }),
      }),
    );
    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          drug_master_id: 'drug_master_1',
          drug_package_id: 'drug_package_1',
        }),
      }),
    );
    expect(db.medicationStockEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity_delta: expect.objectContaining({}),
          unit: 'sheet',
          request_fingerprint_hash: buildRequestFingerprint({
            prescriptionLineId: 'line_1',
            stockItemId: 'stock_item_1',
            drugMasterId: 'drug_master_1',
            drugCode: null,
            quantity: 100,
            unit: 'sheet',
            drugPackageId: 'drug_package_1',
          }),
        }),
      }),
    );
    const createdQuantity = db.medicationStockEvent.create.mock.calls[0][0].data.quantity_delta;
    expect(createdQuantity.toString()).toBe('100');
  });

  it('deduplicates JAN and zero-padded GTIN matches for the same package row', async () => {
    const db = createDb();
    setupPackageIdentity(
      db,
      createPackageLine({
        source_drug_code: '4987000000000',
        unit: '枚',
        quantity: 14,
      }),
      {
        gtin: '04987000000000',
        jan_code: '4987000000000',
      },
    );
    setupSingleStockItem(db, { drug_package_id: 'drug_package_1' });
    db.medicationStockEvent.findFirst.mockResolvedValue({
      id: 'stock_event_1',
      stock_item_id: 'stock_item_1',
      request_fingerprint_hash: buildRequestFingerprint({
        prescriptionLineId: 'line_1',
        stockItemId: 'stock_item_1',
        drugMasterId: 'drug_master_1',
        drugCode: null,
        quantity: 14,
        unit: 'sheet',
        drugPackageId: 'drug_package_1',
      }),
    });
    db.medicationStockSnapshot.findFirst.mockResolvedValue({
      current_quantity: '14',
      stock_risk_level: 'ok',
      calculated_at: new Date('2026-07-07T09:00:00.000Z'),
    });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.results[0]).toMatchObject({ kind: 'applied', idempotent_replay: true });
    expect(db.drugPackage.findMany).toHaveBeenCalledTimes(1);
  });

  it('requires review for ambiguous package identities without querying stock items', async () => {
    const db = createDb();
    setupPackageIdentity(db, createPackageLine({ source_drug_code: '4987000000000' }));
    db.drugPackage.findMany.mockResolvedValue([
      {
        id: 'drug_package_1',
        drug_master_id: 'drug_master_1',
        gtin: '14987000000007',
        jan_code: '4987000000000',
        package_level: 'sales',
        package_quantity: '100',
        package_quantity_unit: '枚',
      },
      {
        id: 'drug_package_2',
        drug_master_id: 'drug_master_2',
        gtin: '24987000000004',
        jan_code: '4987000000000',
        package_level: 'sales',
        package_quantity: '50',
        package_quantity_unit: '枚',
      },
    ]);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'ambiguous_package_identity',
      candidate_count: 2,
    });
    expect(db.patientMedicationStockItem.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ package_level: 'dispensing' }, 'package_level_unsupported'],
    [{ package_quantity: null }, 'package_metadata_missing'],
    [{ package_quantity_unit: null }, 'package_metadata_missing'],
    [{ package_quantity: '0' }, 'package_quantity_invalid'],
    [{ package_quantity: '0.00001' }, 'package_quantity_invalid'],
    [{ package_quantity: '100000000' }, 'package_quantity_invalid'],
  ])('requires review for unsafe package metadata %j', async (packageOverrides, reasonCode) => {
    const db = createDb();
    setupPackageIdentity(db, createPackageLine(), packageOverrides);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: reasonCode,
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('does not apply a package conversion to a stock item without the exact package link', async () => {
    const db = createDb();
    setupPackageIdentity(db);
    db.patientMedicationStockItem.findMany.mockResolvedValue([]);
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'existing_stock_item_missing',
    });
    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ drug_package_id: 'drug_package_1' }),
      }),
    );
  });

  it('batches package lookup across prescription lines', async () => {
    const db = createDb();
    const firstLine = createPackageLine({ id: 'line_1' });
    const secondLine = createPackageLine({
      id: 'line_2',
      source_drug_code: '24987000000004',
    });
    db.prescriptionIntake.findFirst.mockResolvedValue(
      createIntake(firstLine, { lines: [firstLine, secondLine] }),
    );
    db.drugPackage.findMany.mockResolvedValue([
      {
        id: 'drug_package_1',
        drug_master_id: 'drug_master_1',
        gtin: '14987000000007',
        jan_code: null,
        package_level: 'sales',
        package_quantity: '100',
        package_quantity_unit: '枚',
      },
      {
        id: 'drug_package_2',
        drug_master_id: 'drug_master_2',
        gtin: '24987000000004',
        jan_code: null,
        package_level: 'sales',
        package_quantity: '50',
        package_quantity_unit: '枚',
      },
    ]);
    db.patientMedicationStockItem.findMany.mockResolvedValue([]);
    upsertOperationalTaskMock
      .mockResolvedValueOnce({ id: 'task_1' })
      .mockResolvedValueOnce({ id: 'task_2' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.review_required_count).toBe(2);
    expect(db.drugPackage.findMany).toHaveBeenCalledTimes(1);
    expect(db.patientMedicationStockItem.findMany).toHaveBeenCalledTimes(2);
  });

  it('requires review when a package line uses an ambiguous non-container unit', async () => {
    const db = createDb();
    setupPackageIdentity(db, createPackageLine({ unit: '箱詰' }));
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });

    const result = await applyPrescriptionSupplyForIntake(
      db as unknown as ApplyPrescriptionSupplyDb,
      { orgId: 'org_1', userId: 'user_1', intakeId: 'intake_1' },
    );

    expect(result.results[0]).toMatchObject({
      kind: 'review_required',
      reason_code: 'unsupported_unit',
    });
    expect(db.patientMedicationStockItem.findMany).not.toHaveBeenCalled();
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
