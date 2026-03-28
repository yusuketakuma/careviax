import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importManualClinicalRules } from './manual';

describe('importManualClinicalRules', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findFirst: vi.fn(),
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
    db.drugPackageInsert.findFirst.mockResolvedValue(null);
    db.drugPackageInsert.create.mockResolvedValue({ id: 'insert_1' });
    db.drugPackageInsert.update.mockResolvedValue({ id: 'insert_1' });
    db.drugAlertRule.deleteMany.mockResolvedValue({ count: 0 });
    db.drugAlertRule.createMany.mockResolvedValue({ count: 2 });
  });

  it('replaces alert rules and stores renal adjustment payloads', async () => {
    const result = await importManualClinicalRules(db as never, {
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
    });

    expect(result.importedCount).toBe(3);
    expect(db.drugAlertRule.deleteMany).toHaveBeenCalledTimes(2);
    expect(db.drugAlertRule.createMany).toHaveBeenCalledTimes(2);
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
});
