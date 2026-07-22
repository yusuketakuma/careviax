import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    drugMaster: { findFirst: vi.fn(), findMany: vi.fn() },
    pharmacyDrugStock: { findFirst: vi.fn(), findMany: vi.fn() },
    prescriberInstitution: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { mapJahisToIntake } from '../qr-intake-mapper';
import type { JahisQRData } from '../jahis-qr';

type DrugMasterFindManyArgs = {
  where?: {
    id?: { in?: string[] };
    OR?: Array<Record<string, unknown>>;
  };
  select?: Record<string, boolean>;
};

type PharmacyDrugStockFindManyArgs = {
  where?: {
    org_id?: string;
    site_id?: string;
    drug_master_id?: string | { in?: string[] };
    is_stocked?: boolean;
    drug_master?: {
      generic_name?: { in?: string[] };
      is_generic?: boolean;
      id?: { notIn?: string[] };
    };
  };
};

// ── Shared helpers ──

function makeQrData(overrides: Partial<JahisQRData> = {}): JahisQRData {
  return {
    patient: {
      name: '山田太郎',
      nameKana: 'ヤマダタロウ',
      gender: 'male',
      birthDate: '1950-03-15',
    },
    medications: [],
    prescribingInstitution: {
      name: 'テスト医院',
      institutionCode: '1234567',
    },
    dispensingInstitution: {},
    prescribingDoctor: '鈴木医師',
    dispensingDate: '2026-04-01',
    remarks: [],
    patientNotes: [],
    rawText: 'JAHISTC08,1\n...',
    // backward-compat
    pharmacy: {
      institutionCode: '1234567',
      institutionName: 'テスト医院',
      doctorName: '鈴木医師',
    },
    prescriptionDate: undefined,
    ...overrides,
  };
}

function makeMed(
  overrides: Partial<import('../jahis-qr').JahisMedication>,
): import('../jahis-qr').JahisMedication {
  return {
    drugName: '不明薬剤',
    supplements: [],
    usageNotes: [],
    ...overrides,
  };
}

const baseInput = {
  orgId: 'org_1',
  siteId: 'site_1',
  patientId: 'patient_1',
  caseId: 'case_1',
  scannedBy: 'user_1',
};

const mockDrugMaster = {
  id: 'drug_1',
  yj_code: '123456789012',
  receipt_code: '123456789',
  hot_code: null,
  drug_name: 'アムロジピン錠5mg',
  generic_name: 'アムロジピン',
  dosage_form: '錠',
  is_generic: false,
};

const mockDrugMasterGeneric = {
  id: 'drug_generic_1',
  yj_code: '987654321098',
  receipt_code: '987654321',
  hot_code: null,
  drug_name: 'アムロジピン錠5mg「GE」',
  generic_name: 'アムロジピン',
  dosage_form: '錠',
  is_generic: true,
};

const mockStock = {
  id: 'stock_1',
  site_id: 'site_1',
  drug_master_id: 'drug_1',
  is_stocked: true,
  preferred_generic_id: 'drug_generic_1',
  stock_qty: 100,
};

const mockInstitution = {
  id: 'inst_1',
  org_id: 'org_1',
  name: 'テスト医院',
  institution_code: '1234567',
};

// ── Tests ──

describe('mapJahisToIntake', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.drugMaster.findMany.mockImplementation(async (args: DrugMasterFindManyArgs = {}) => {
      const idBatch = args.where?.id?.in;

      if (idBatch) {
        const rows = [];
        for (const id of idBatch) {
          const match = await prismaMock.drugMaster.findFirst({
            where: { id },
            select: args.select,
          });
          if (match) rows.push(match);
        }
        return rows;
      }

      const match = await prismaMock.drugMaster.findFirst(args);
      return match ? [match] : [];
    });
    prismaMock.pharmacyDrugStock.findMany.mockImplementation(
      async (args: PharmacyDrugStockFindManyArgs = {}) => {
        const drugMasterIdFilter = args.where?.drug_master_id;
        const drugMasterIds =
          typeof drugMasterIdFilter === 'object' && drugMasterIdFilter !== null
            ? (drugMasterIdFilter.in ?? [])
            : drugMasterIdFilter
              ? [drugMasterIdFilter]
              : [];

        if (args.where?.drug_master) {
          return [];
        }

        if (drugMasterIds.length === 0) {
          const match = await prismaMock.pharmacyDrugStock.findFirst(args);
          return match ? [match] : [];
        }

        const rows = [];
        for (const drugMasterId of drugMasterIds) {
          const match = await prismaMock.pharmacyDrugStock.findFirst({
            where: {
              ...args.where,
              drug_master_id: drugMasterId,
            },
          });
          if (match) rows.push(match);
        }
        return rows;
      },
    );
    // Default: institution found by code
    prismaMock.prescriberInstitution.findFirst.mockResolvedValue(mockInstitution);
  });

  describe('PharmacyDrugStock formulary matching', () => {
    it('marks drug as in-formulary when stock record exists', async () => {
      prismaMock.drugMaster.findFirst
        .mockResolvedValueOnce(mockDrugMaster) // main lookup
        .mockResolvedValueOnce(mockDrugMasterGeneric); // preferred generic lookup
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(mockStock);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.formularyStatus[0]).toMatchObject({
        lineIndex: 0,
        drugName: 'アムロジピン錠5mg',
        inFormulary: true,
        warningLevel: 'none',
        warningReason: null,
        preferredGenericId: 'drug_generic_1',
        preferredGenericName: 'アムロジピン錠5mg「GE」',
        stockQty: 100,
      });
    });

    it('marks drug as not-in-formulary when no stock record found', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.formularyStatus[0]).toMatchObject({
        lineIndex: 0,
        inFormulary: false,
        warningLevel: 'warning',
        warningReason: 'not_stocked',
        preferredGenericId: null,
        preferredGenericName: null,
        stockQty: null,
      });
    });

    it('suggests a stocked generic alternative when the prescribed drug is not in formulary', async () => {
      prismaMock.drugMaster.findMany
        .mockResolvedValueOnce([mockDrugMaster])
        .mockResolvedValueOnce([{ id: 'drug_generic_1', drug_name: 'アムロジピン錠5mg「GE」' }]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'stock_generic_1',
          site_id: 'site_1',
          drug_master_id: 'drug_generic_1',
          is_stocked: true,
          preferred_generic_id: null,
          stock_qty: 50,
          drug_master: mockDrugMasterGeneric,
        },
      ]);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);

      expect(result.formularyStatus[0]).toMatchObject({
        lineIndex: 0,
        drugName: 'アムロジピン錠5mg',
        inFormulary: false,
        warningLevel: 'warning',
        warningReason: 'stocked_generic_available',
        preferredGenericId: 'drug_generic_1',
        preferredGenericName: 'アムロジピン錠5mg「GE」',
        stockQty: 50,
      });
      expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            org_id: 'org_1',
            site_id: 'site_1',
            is_stocked: true,
            drug_master: {
              generic_name: { in: ['アムロジピン'] },
              is_generic: true,
              id: { notIn: ['drug_1'] },
            },
          }),
        }),
      );
    });

    it('sets preferredGenericName to null when stock has no preferred_generic_id', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce({
        ...mockStock,
        preferred_generic_id: null,
      });

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' })],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.formularyStatus[0].preferredGenericName).toBeNull();
      // Should not look up generic if no preferred_generic_id
      expect(prismaMock.drugMaster.findFirst).toHaveBeenCalledTimes(1);
    });

    it('queries PharmacyDrugStock with correct siteId and drug_master_id', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' })],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id: 'org_1',
            site_id: 'site_1',
            drug_master_id: { in: ['drug_1'] },
            is_stocked: true,
          },
        }),
      );
    });

    it('skips PharmacyDrugStock lookup when DrugMaster not found', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: undefined, drugName: '不明' })],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('line construction', () => {
    it('assigns sequential line_number starting at 1', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValue(null);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: undefined, drugName: '薬A', dose: '1', unit: '錠' }),
          makeMed({ drugCode: undefined, drugName: '薬B', dose: '2', unit: '錠' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].line_number).toBe(1);
      expect(result.lines[1].line_number).toBe(2);
    });

    it('builds dose string combining dose and unit', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].dose).toBe('5mg');
    });

    it('sets days from parseDaysOrTimes when daysOrTimes is "14日分"', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
            daysOrTimes: '14日分',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].days).toBe(14);
    });

    it('sets days to null for non-numeric daysOrTimes like "頓服"', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
            daysOrTimes: '頓服',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].days).toBeNull();
    });

    it('sets is_generic to true when DrugMaster indicates generic', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMasterGeneric);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '987654321098', drugName: 'アムロジピン錠5mg「GE」' })],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].is_generic).toBe(true);
    });

    it('parses dispensedQuantity as float into quantity', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
            dispensedQuantity: '70',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].quantity).toBe(70);
    });

    it('defaults route to internal when no external or injection hint exists', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' })],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].packaging_method).toBeNull();
      expect(result.lines[0].route).toBe('internal');
      expect(result.lines[0].dispensing_method).toBeNull();
    });
  });

  describe('auto-completion tracking', () => {
    it('tracks autoCompletedFields for dosage_form per line', async () => {
      prismaMock.drugMaster.findMany.mockResolvedValueOnce([mockDrugMaster, mockDrugMasterGeneric]);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValue(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' }),
          makeMed({ drugCode: '987654321098', drugName: 'アムロジピン錠5mg「GE」' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.autoCompletedFields).toHaveLength(2);
      expect(result.autoCompletedFields[0].lineIndex).toBe(0);
      expect(result.autoCompletedFields[1].lineIndex).toBe(1);
    });

    it('does not add autoCompletedFields when DrugMaster has no dosage_form', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce({
        ...mockDrugMaster,
        dosage_form: null,
      });
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' })],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.autoCompletedFields).toHaveLength(0);
    });
  });

  describe('unmatched drug detection', () => {
    it('collects unmatched drugs for multiple failed lookups', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValue(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: undefined, drugName: '薬A' }),
          makeMed({ drugCode: 'BADCODE', drugName: '薬B' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.unmatchedDrugs).toHaveLength(2);
      expect(result.unmatchedDrugs[0].reason).toBe('no_code_provided');
      expect(result.unmatchedDrugs[1].reason).toBe('code_not_found');
    });

    it('does not add an unmatched entry when DrugMaster is found', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [makeMed({ drugCode: '123456789012', drugName: 'アムロジピン錠5mg' })],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.unmatchedDrugs).toHaveLength(0);
    });
  });

  describe('route and packaging inference', () => {
    it('infers external route from dosage form and packaging instructions from notes', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce({
        ...mockDrugMaster,
        dosage_form: '軟膏',
      });
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'ヘパリン類似物質軟膏',
            usage: '1日2回患部に塗布',
            supplements: ['別包', '一包化しない'],
            usageNotes: ['冷所保管'],
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].route).toBe('external');
      expect(result.lines[0].packaging_instructions).toContain('別包');
      expect(result.lines[0].packaging_instruction_tags).toContain('separate_pack');
      expect(result.lines[0].notes).toContain('冷所保管');
    });

    it('keeps expanded packaging work instructions from QR remarks', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            supplements: ['PTPヒート管理', '混合', '賦形', '脱カプセル'],
            usageNotes: ['一包化しない', '手まき manual PTP'],
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].packaging_instructions).toContain('PTPヒート管理');
      expect(result.lines[0].packaging_instruction_tags).toEqual([
        'ptp',
        'mixing',
        'excipient',
        'decapsulation',
        'no_unit_dose',
        'manual_ptp',
      ]);
      expect(result.lines[0].packaging_instruction_tags).not.toContain('unit_dose');
    });

    it('does not convert no-unit-dose QR remarks into unit-dose instructions', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            supplements: ['一包化不可', '分包不要'],
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].packaging_method).toBe('other');
      expect(result.lines[0].packaging_instruction_tags).toEqual(['no_unit_dose']);
      expect(result.lines[0].packaging_instruction_tags).not.toContain('unit_dose');
    });

    it('maps crushing instructions into packaging and dispensing flags', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            supplements: ['粉砕'],
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].packaging_method).toBe('crush_and_pack');
      expect(result.lines[0].dispensing_method).toBe('crushed');
    });
  });
});
