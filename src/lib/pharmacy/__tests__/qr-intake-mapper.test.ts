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

  describe('with empty medications', () => {
    it('returns empty lines array', async () => {
      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines).toHaveLength(0);
    });

    it('maps prescriber info from qrData', async () => {
      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.prescribedDate).toBe('2026-04-01');
      expect(result.prescriberName).toBe('鈴木医師');
      expect(result.prescriberInstitution).toBe('テスト医院');
      expect(result.prescriberInstitutionCode).toBe('1234567');
    });

    it('returns empty autoCompletedFields and unmatchedDrugs', async () => {
      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.autoCompletedFields).toHaveLength(0);
      expect(result.unmatchedDrugs).toHaveLength(0);
      expect(result.formularyStatus).toHaveLength(0);
    });

    it('returns null for prescribedDate when qrData has no dispensingDate', async () => {
      const qrData = makeQrData({ medications: [], dispensingDate: undefined });
      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.prescribedDate).toBeNull();
    });
  });

  describe('PrescriberInstitution resolution', () => {
    it('resolves institution by institution_code (most reliable)', async () => {
      prismaMock.prescriberInstitution.findFirst.mockResolvedValueOnce(mockInstitution);

      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.prescriberInstitution.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { org_id: 'org_1', institution_code: '1234567' },
        }),
      );
      expect(result.prescriberInstitutionId).toBe('inst_1');
      expect(result.prescriberInstitution).toBe('テスト医院');
      expect(result.isNewInstitution).toBe(false);
    });

    it('falls back to name lookup when not found by code', async () => {
      // Code lookup misses, name lookup hits
      prismaMock.prescriberInstitution.findFirst
        .mockResolvedValueOnce(null) // by code: miss
        .mockResolvedValueOnce(mockInstitution); // by name: hit

      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);

      expect(result.prescriberInstitutionId).toBe('inst_1');
      expect(result.isNewInstitution).toBe(false);
    });

    it('auto-registers institution when not found by code or name', async () => {
      prismaMock.prescriberInstitution.findFirst.mockResolvedValue(null);
      prismaMock.prescriberInstitution.create.mockResolvedValueOnce({
        id: 'inst_new',
        name: 'テスト医院',
        institution_code: '1234567',
      });

      const qrData = makeQrData({ medications: [] });
      const result = await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.prescriberInstitution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            name: 'テスト医院',
            institution_code: '1234567',
          }),
        }),
      );
      expect(result.prescriberInstitutionId).toBe('inst_new');
      expect(result.isNewInstitution).toBe(true);
    });

    it('returns null institution IDs when QR has no institution name or code', async () => {
      const qrData = makeQrData({
        medications: [],
        prescribingInstitution: { name: undefined, institutionCode: undefined },
      });
      const result = await mapJahisToIntake(qrData, baseInput);

      expect(result.prescriberInstitutionId).toBeNull();
      expect(result.isNewInstitution).toBe(false);
      expect(prismaMock.prescriberInstitution.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.prescriberInstitution.create).not.toHaveBeenCalled();
    });

    it('uses generated name when only institutionCode is available during auto-registration', async () => {
      prismaMock.prescriberInstitution.findFirst.mockResolvedValue(null);
      prismaMock.prescriberInstitution.create.mockResolvedValueOnce({
        id: 'inst_new',
        name: '医療機関 (9999999)',
        institution_code: '9999999',
      });

      const qrData = makeQrData({
        medications: [],
        prescribingInstitution: { name: undefined, institutionCode: '9999999' },
      });
      const result = await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.prescriberInstitution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: '医療機関 (9999999)' }),
        }),
      );
      expect(result.prescriberInstitutionId).toBe('inst_new');
      expect(result.isNewInstitution).toBe(true);
    });
  });

  describe('DrugMaster lookup — YJ code (12-digit)', () => {
    it('looks up drug by YJ code when drugCode is 12 digits', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
            usage: '1日1回朝食後',
            daysOrTimes: '14日分',
            dispensedQuantity: '70',
          }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ yj_code: '123456789012' }]),
          }),
        }),
      );
    });

    it('sets drug_code to yj_code from DrugMaster when found', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789012',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
            usage: '1日1回朝食後',
            daysOrTimes: '14日分',
          }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.lines[0].drug_code).toBe('123456789012');
    });

    it('auto-completes dosage_form from DrugMaster', async () => {
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
      expect(result.lines[0].dosage_form).toBe('錠');
      expect(result.autoCompletedFields).toContainEqual(
        expect.objectContaining({
          lineIndex: 0,
          field: 'dosage_form',
          value: '錠',
          source: 'drug_master',
        }),
      );
    });
  });

  describe('DrugMaster lookup — receipt code (9-digit)', () => {
    it('looks up drug by receipt_code when drugCode is 9 digits', async () => {
      prismaMock.drugMaster.findFirst.mockReset();
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({
            drugCode: '123456789',
            drugName: 'アムロジピン錠5mg',
            dose: '5',
            unit: 'mg',
          }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ receipt_code: '123456789' }]),
          }),
        }),
      );
    });
  });

  describe('DrugMaster lookup — drugCodeType-aware', () => {
    it('uses receipt_code lookup when drugCodeType=2', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789', drugCodeType: 2, drugName: 'アムロジピン錠5mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ receipt_code: '123456789' }]),
          }),
        }),
      );
    });

    it('uses yj_code lookup when drugCodeType=4', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789012', drugCodeType: 4, drugName: 'アムロジピン錠5mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ yj_code: '123456789012' }]),
          }),
        }),
      );
    });

    it('uses hot_code lookup when drugCodeType=6', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '1234567890123', drugCodeType: 6, drugName: 'アムロジピン錠5mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ hot_code: '1234567890123' }]),
          }),
        }),
      );
    });

    it('uses OR lookup when drugCodeType=3 (厚労省コード)', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789012', drugCodeType: 3, drugName: 'アムロジピン錠5mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { yj_code: '123456789012' },
              { receipt_code: '123456789012' },
            ]),
          }),
        }),
      );
    });

    it('skips type-specific lookup and falls back to length heuristic when drugCodeType=1 (no code)', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789012', drugCodeType: 1, drugName: 'アムロジピン錠5mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      // drugCodeType=1 means "no code" → should fall through to length-heuristic (12-digit = yj_code)
      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ yj_code: '123456789012' }]),
          }),
        }),
      );
    });

    it('batches DrugMaster and formulary lookups for multiple medication lines', async () => {
      const drugA = {
        ...mockDrugMaster,
        id: 'drug_a',
        yj_code: '111111111111',
        receipt_code: '111111111',
        drug_name: '薬A',
      };
      const drugB = {
        ...mockDrugMasterGeneric,
        id: 'drug_b',
        yj_code: '222222222222',
        receipt_code: '222222222',
        drug_name: '薬B',
      };
      prismaMock.drugMaster.findMany.mockResolvedValueOnce([drugA, drugB]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValueOnce([]);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '111111111111', drugName: '薬A' }),
          makeMed({ drugCode: '222222222222', drugName: '薬B' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);

      expect(result.lines.map((line) => line.drug_code)).toEqual(['111111111111', '222222222222']);
      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ yj_code: '111111111111' }, { yj_code: '222222222222' }]),
          }),
        }),
      );
      expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenCalledTimes(2);
      expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            org_id: 'org_1',
            site_id: 'site_1',
            drug_master_id: { in: ['drug_a', 'drug_b'] },
            is_stocked: true,
          },
        }),
      );
      expect(prismaMock.pharmacyDrugStock.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            org_id: 'org_1',
            site_id: 'site_1',
            is_stocked: true,
            drug_master: expect.objectContaining({
              generic_name: { in: ['アムロジピン'] },
              is_generic: true,
            }),
          }),
        }),
      );
      expect(prismaMock.drugMaster.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.pharmacyDrugStock.findFirst).not.toHaveBeenCalled();
    });

    it('preserves drugCodeType precedence when batched candidates include lower-priority matches', async () => {
      const receiptCandidate = {
        ...mockDrugMaster,
        id: 'receipt_candidate',
        yj_code: '000000000000',
        receipt_code: '123456789012',
        drug_name: 'Receipt Candidate',
        dosage_form: '散',
        is_generic: false,
      };
      const yjCandidate = {
        ...mockDrugMaster,
        id: 'yj_candidate',
        yj_code: '123456789012',
        receipt_code: '999999999',
        drug_name: 'YJ Candidate',
        dosage_form: '錠',
        is_generic: true,
      };
      prismaMock.drugMaster.findMany.mockResolvedValueOnce([receiptCandidate, yjCandidate]);
      prismaMock.pharmacyDrugStock.findMany.mockResolvedValueOnce([]);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: '123456789012', drugCodeType: 4, drugName: 'YJ Candidate' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);

      expect(result.lines[0]).toMatchObject({
        drug_code: '123456789012',
        dosage_form: '錠',
        is_generic: true,
      });
    });
  });

  describe('DrugMaster lookup — name fallback', () => {
    it('falls back to name search when no drugCode is provided', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(mockDrugMaster);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: undefined, drugName: 'アムロジピン錠5mg', dose: '5', unit: 'mg' }),
        ],
      });

      await mapJahisToIntake(qrData, baseInput);

      expect(prismaMock.drugMaster.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([{ drug_name: { contains: 'アムロジピン錠5mg' } }]),
          }),
        }),
      );
    });

    it('marks drug as unmatched with reason "no_code_provided" when name fallback also fails', async () => {
      prismaMock.drugMaster.findFirst.mockResolvedValueOnce(null);
      prismaMock.pharmacyDrugStock.findFirst.mockResolvedValueOnce(null);

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: undefined, drugName: '不明薬剤', dose: '1', unit: '錠' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.unmatchedDrugs).toHaveLength(1);
      expect(result.unmatchedDrugs[0]).toMatchObject({
        lineIndex: 0,
        drugName: '不明薬剤',
        drugCode: null,
        reason: 'no_code_provided',
      });
    });

    it('marks drug as unmatched with reason "code_not_found" when code provided but no match', async () => {
      // For a non-12-digit, non-9-digit code, it tries OR lookup then name fallback
      prismaMock.drugMaster.findFirst
        .mockResolvedValueOnce(null) // OR lookup miss
        .mockResolvedValueOnce(null); // name fallback miss

      const qrData = makeQrData({
        medications: [
          makeMed({ drugCode: 'BADCODE', drugName: '存在しない薬剤', dose: '1', unit: '錠' }),
        ],
      });

      const result = await mapJahisToIntake(qrData, baseInput);
      expect(result.unmatchedDrugs).toHaveLength(1);
      expect(result.unmatchedDrugs[0]).toMatchObject({
        lineIndex: 0,
        drugCode: 'BADCODE',
        reason: 'code_not_found',
      });
    });
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
        preferredGenericId: null,
        preferredGenericName: null,
        stockQty: null,
      });
    });

    it('suggests a stocked generic alternative when the prescribed drug is not in formulary', async () => {
      prismaMock.drugMaster.findMany
        .mockResolvedValueOnce([mockDrugMaster])
        .mockResolvedValueOnce([{ id: 'drug_generic_1', drug_name: 'アムロジピン錠5mg「GE」' }]);
      prismaMock.pharmacyDrugStock.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
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
