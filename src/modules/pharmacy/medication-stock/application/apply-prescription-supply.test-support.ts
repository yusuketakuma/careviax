import { createHash } from 'node:crypto';

import { vi } from 'vitest';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

export function buildRequestFingerprint(input: {
  prescriptionLineId: string;
  stockItemId: string;
  drugMasterId: string | null;
  drugCode: string | null;
  quantity: number;
  unit: string;
  drugPackageId?: string;
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
        ...(input.drugPackageId ? { drug_package_id: input.drugPackageId } : {}),
      }),
    )
    .digest('hex')}`;
}

export function createDb() {
  return {
    drugMaster: {
      findMany: vi.fn(),
    },
    drugPackage: {
      findMany: vi.fn(),
    },
    medicationStockEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    medicationStockSnapshot: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    patientMedicationStockItem: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    prescriptionIntake: {
      findFirst: vi.fn(),
    },
    task: {},
  };
}

export function createExternalLine(overrides: Partial<Record<string, unknown>> = {}) {
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

export function createIntake(
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

export function setupExactIdentity(
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

export function setupSingleStockItem(
  db: ReturnType<typeof createDb>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  db.patientMedicationStockItem.findMany.mockResolvedValue([
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
      ...overrides,
    },
  ]);
}

export function createPackageLine(overrides: Partial<Record<string, unknown>> = {}) {
  return createExternalLine({
    drug_master_id: null,
    drug_code: null,
    source_drug_code: '14987000000007',
    source_drug_code_type: 'gs1',
    quantity: 1,
    unit: '箱',
    ...overrides,
  });
}

export function setupPackageIdentity(
  db: ReturnType<typeof createDb>,
  line = createPackageLine(),
  packageOverrides: Partial<Record<string, unknown>> = {},
) {
  db.prescriptionIntake.findFirst.mockResolvedValue(createIntake(line));
  db.drugPackage.findMany.mockResolvedValue([
    {
      id: 'drug_package_1',
      drug_master_id: 'drug_master_1',
      gtin: '14987000000007',
      jan_code: null,
      package_level: 'sales',
      package_quantity: '100',
      package_quantity_unit: '枚',
      ...packageOverrides,
    },
  ]);
}
