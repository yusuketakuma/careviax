import { describe, expect, it, vi } from 'vitest';

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
  createPrescriptionSupplyStockItemForReview,
  previewPrescriptionSupplyReview,
  type ApplyPrescriptionSupplyDb,
} from './apply-prescription-supply';
import {
  createDb,
  createExternalLine,
  setupExactIdentity,
  setupSingleStockItem,
} from './apply-prescription-supply.test-support';

describe('previewPrescriptionSupplyReview', () => {
  it('returns side-effect-free exact candidates with applicability and current quantity', async () => {
    const db = createDb();
    setupExactIdentity(db);
    db.patientMedicationStockItem.findMany
      .mockResolvedValueOnce([
        {
          id: 'stock_item_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          drug_master_id: 'drug_master_1',
          drug_package_id: null,
          source_type: 'prescription',
          unit: 'sheet',
          default_usage_amount_per_day: '1',
          medication_category: 'external',
          equivalence_review_status: 'not_required',
        },
        {
          id: 'stock_item_2',
          patient_id: 'patient_1',
          case_id: null,
          drug_master_id: 'drug_master_1',
          drug_package_id: null,
          source_type: 'prescription',
          unit: 'sheet',
          default_usage_amount_per_day: '1',
          medication_category: 'external',
          equivalence_review_status: 'pending',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'stock_item_1',
          display_id: 'MSI-001',
          display_name: '湿布A 自宅保管',
          case_id: 'case_1',
          unit: 'sheet',
          dosage_form: '貼付剤',
          route: 'external',
          equivalence_review_status: 'not_required',
        },
        {
          id: 'stock_item_2',
          display_id: 'MSI-002',
          display_name: '湿布A 予備',
          case_id: null,
          unit: 'sheet',
          dosage_form: '貼付剤',
          route: 'external',
          equivalence_review_status: 'pending',
        },
      ]);
    db.medicationStockSnapshot.findMany.mockResolvedValue([
      {
        stock_item_id: 'stock_item_1',
        current_quantity: '4',
        unit: 'sheet',
        calculated_at: new Date('2026-07-17T00:00:00.000Z'),
      },
    ]);

    const result = await previewPrescriptionSupplyReview(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
        prescriptionLineId: 'line_1',
      },
    );

    expect(result).toEqual({
      kind: 'reviewable',
      line: expect.objectContaining({ id: 'line_1', drug_name: '湿布A' }),
      normalized_supply: { quantity: 10, unit: 'sheet' },
      candidates: [
        expect.objectContaining({
          id: 'stock_item_1',
          applicable: true,
          current_quantity: 4,
          snapshot_calculated_at: '2026-07-17T00:00:00.000Z',
        }),
        expect.objectContaining({
          id: 'stock_item_2',
          applicable: false,
          current_quantity: null,
        }),
      ],
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns the shared target-resolution reason without querying stock candidates', async () => {
    const db = createDb();
    setupExactIdentity(db, createExternalLine({ unit: 'unsupported' }));

    const result = await previewPrescriptionSupplyReview(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
        prescriptionLineId: 'line_1',
      },
    );

    expect(result).toMatchObject({ kind: 'blocked', reason_code: 'unsupported_unit' });
    expect(db.patientMedicationStockItem.findMany).not.toHaveBeenCalled();
  });
});

describe('createPrescriptionSupplyStockItemForReview', () => {
  it('creates a pharmacist-reviewed exact-code item when no matching ledger exists', async () => {
    const db = createDb();
    setupExactIdentity(db);
    db.patientMedicationStockItem.findMany.mockResolvedValue([]);
    db.patientMedicationStockItem.create.mockResolvedValue({ id: 'stock_created_1' });
    allocateDisplayIdMock.mockResolvedValueOnce('pmsi_001');

    const result = await createPrescriptionSupplyStockItemForReview(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
        prescriptionLineId: 'line_1',
        managingParty: 'patient',
      },
    );

    expect(result).toEqual({ kind: 'created', stock_item_id: 'stock_created_1' });
    expect(db.patientMedicationStockItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        display_id: 'pmsi_001',
        patient_id: 'patient_1',
        case_id: 'case_1',
        drug_master_id: 'drug_master_1',
        drug_package_id: null,
        source_type: 'prescription',
        medication_category: 'prn',
        display_name: '湿布A',
        unit: 'sheet',
        managing_party: 'patient',
        equivalence_review_status: 'reviewed',
        equivalence_confidence: 'exact_code',
        created_by: 'user_1',
      }),
      select: { id: true },
    });
  });

  it('refuses to create a duplicate when an exact patient ledger already exists', async () => {
    const db = createDb();
    setupExactIdentity(db);
    setupSingleStockItem(db);

    const result = await createPrescriptionSupplyStockItemForReview(
      db as unknown as ApplyPrescriptionSupplyDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
        prescriptionLineId: 'line_1',
        managingParty: 'patient',
      },
    );

    expect(result).toEqual({
      kind: 'review_required',
      reason_code: 'existing_stock_item_available',
    });
    expect(db.patientMedicationStockItem.create).not.toHaveBeenCalled();
  });
});
