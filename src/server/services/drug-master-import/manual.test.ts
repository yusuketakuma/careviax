import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { importManualClinicalRules } from './manual';

describe('importManualClinicalRules', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    drugPackageInsert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    drugAlertRule: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findFirst.mockResolvedValue({ id: 'drug_1' });
    db.drugMaster.update.mockResolvedValue({ id: 'drug_1' });
    db.drugPackageInsert.findFirst.mockResolvedValue(null);
    db.drugPackageInsert.create.mockResolvedValue({ id: 'insert_1' });
    db.drugPackageInsert.update.mockResolvedValue({ id: 'insert_1' });
    db.drugAlertRule.deleteMany.mockResolvedValue({ count: 0 });
    db.drugAlertRule.createMany.mockResolvedValue({ count: 2 });
  });

  it('replaces alert rules and stores renal adjustment payloads', async () => {
    const result = await importManualClinicalRules(db, {
      pim_rules: [
        {
          condition: { therapeutic_categories: ['1124'] },
          severity: 'warning',
          message: '高齢者では慎重投与',
        },
      ],
      high_risk_rules: [
        {
          condition: { yj_codes: ['123456789012'] },
          severity: 'warning',
          message: '特定薬剤管理指導加算対象',
        },
      ],
      renal_adjustments: [
        {
          yj_code: '123456789012',
          dosage_adjustment_renal: [
            {
              egfr_min: 0,
              egfr_max: 30,
              recommendation: '1日1回へ減量',
            },
          ],
          precautions_elderly: ['脱水に注意'],
        },
      ],
      drug_safety_overrides: [
        {
          yj_code: '123456789012',
          tall_man_name: 'DOBUTamine注',
          lasa_group_key: 'dobutamine_dopamine',
          is_lasa_risk: true,
          is_high_risk: true,
          outpatient_injection_eligible: true,
          outpatient_injection_note: '在宅自己注射対象として手動確認済み',
        },
      ],
    });

    expect(result.importedCount).toBe(4);
    expect(db.drugAlertRule.deleteMany).toHaveBeenCalledTimes(2);
    expect(db.drugAlertRule.deleteMany).toHaveBeenCalledWith({
      where: { alert_type: 'pim_elderly', org_id: null },
    });
    expect(db.drugAlertRule.deleteMany).toHaveBeenCalledWith({
      where: { alert_type: 'high_risk', org_id: null },
    });
    expect(db.drugAlertRule.createMany).toHaveBeenCalledTimes(2);
    expect(db.drugAlertRule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          alert_type: 'pim_elderly',
          org_id: null,
        }),
      ],
    });
    expect(db.drugAlertRule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          alert_type: 'high_risk',
          org_id: null,
        }),
      ],
    });
    expect(db.drugMaster.update).toHaveBeenCalledWith({
      where: { id: 'drug_1' },
      data: {
        tall_man_name: 'DOBUTamine注',
        lasa_group_key: 'dobutamine_dopamine',
        is_lasa_risk: true,
        is_high_risk: true,
        outpatient_injection_eligible: true,
        outpatient_injection_note: '在宅自己注射対象として手動確認済み',
      },
    });
    expect(db.drugPackageInsert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        drug_master_id: 'drug_1',
        dosage_adjustment_renal: [
          {
            egfr_min: 0,
            egfr_max: 30,
            recommendation: '1日1回へ減量',
          },
        ],
        precautions_elderly: ['脱水に注意'],
        source_format: 'pdf',
      }),
    });
  });

  it('stores JsonNull for omitted elderly precautions on new package inserts', async () => {
    await importManualClinicalRules(db, {
      renal_adjustments: [
        {
          yj_code: '123456789012',
          dosage_adjustment_renal: [{ recommendation: '腎機能を確認して調整' }],
        },
      ],
    });

    expect(db.drugPackageInsert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dosage_adjustment_renal: [{ recommendation: '腎機能を確認して調整' }],
        precautions_elderly: Prisma.JsonNull,
      }),
    });
  });

  it('canonicalizes elderly precaution notes on existing package updates', async () => {
    db.drugPackageInsert.findFirst.mockResolvedValueOnce({
      id: 'insert_1',
      contraindications: null,
      interactions: null,
      adverse_effects: null,
      dosage_adjustment_renal: null,
      precautions_elderly: null,
      document_version: null,
      revised_at: null,
      source_format: 'pdf',
    });

    await importManualClinicalRules(db, {
      renal_adjustments: [
        {
          yj_code: '123456789012',
          dosage_adjustment_renal: [{ recommendation: '投与間隔を延長' }],
          precautions_elderly: {
            notes: ['ふらつきに注意'],
            unsupported_marker: undefined,
          },
        },
      ],
    });

    expect(db.drugPackageInsert.update).toHaveBeenCalledWith({
      where: { id: 'insert_1' },
      data: {
        dosage_adjustment_renal: [{ recommendation: '投与間隔を延長' }],
        precautions_elderly: ['ふらつきに注意'],
      },
    });
  });

  it('rejects malformed elderly precaution payloads before package insert writes', async () => {
    await expect(
      importManualClinicalRules(db, {
        renal_adjustments: [
          {
            yj_code: '123456789012',
            dosage_adjustment_renal: [{ recommendation: '投与間隔を延長' }],
            precautions_elderly: [null, 42, { unsupported_marker: true }],
          },
        ],
      }),
    ).rejects.toThrow();

    expect(db.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    });
  });

  it('rejects drug-name-only renal adjustments before DrugMaster lookup', async () => {
    await expect(
      importManualClinicalRules(db, {
        renal_adjustments: [
          {
            drug_name: '同名リスク薬',
            dosage_adjustment_renal: [{ recommendation: '腎機能を確認して調整' }],
          },
        ],
      }),
    ).rejects.toThrow('手動臨床ルールの腎機能調整は yj_code が必要です');

    expect(db.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    });
  });

  it('rejects drug-name-only safety overrides before DrugMaster updates', async () => {
    await expect(
      importManualClinicalRules(db, {
        drug_safety_overrides: [
          {
            drug_name: '同名リスク薬',
            is_high_risk: true,
          },
        ],
      }),
    ).rejects.toThrow('手動臨床ルールの安全性 override は yj_code が必要です');

    expect(db.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(db.drugMaster.update).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    });
  });
});
