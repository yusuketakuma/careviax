import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMhlwTestSupport } from './mhlw.test-support';

const { importMhlwGenericFlags, previewMhlwGenericFlags, toWorkbookResponse, workbookBlob } =
  getMhlwTestSupport();

describe('importMhlwGenericFlags', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    drugMasterChangeEvent: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    drugPriceVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([]);
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMasterChangeEvent.create.mockResolvedValue({ id: 'change_1' });
    db.drugPriceVersion.findUnique.mockResolvedValue(null);
    db.drugPriceVersion.create.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.update.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.updateMany.mockResolvedValue({ count: 0 });
  });

  it('imports generic flags while reporting malformed YJ skips', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        [
          '区分',
          '薬価基準収載医薬品コード',
          '品名',
          '診療報酬において加算等の算定対象となる後発医薬品',
        ],
        ['内用薬', 'NOT_A_YJ', '不正YJ薬', '後発品'],
        ['内用薬', '1124001F1030', 'エスタゾラム錠１ｍｇ「アメル」', '後発品'],
      ],
    });

    const result = await importMhlwGenericFlags(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugMaster.upsert).toHaveBeenCalledOnce();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        record_count: 1,
        change_summary: {
          mode: 'full',
          operation: 'generic_flags',
          parsed_records: 1,
          imported_records: 1,
          skipped_invalid_yj: 1,
        },
      }),
    });
  });

  it('fails matched-invalid generic-flag provenance before DrugMaster writes', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名'],
        ['内用薬', '1124001F1030', 'エスタゾラム錠'],
      ],
    });

    await expect(
      importMhlwGenericFlags(db, {
        workbookUrl: 'https://www.mhlw.go.jp/topics/xls/tp20260230-01_01.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      }),
    ).rejects.toThrow('DRUG_MASTER_SOURCE_DATE_INVALID');
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
  });
});

describe('previewMhlwGenericFlags', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    drugMasterChangeEvent: {
      create: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([
      { yj_code: '1124001F1022', is_generic: false },
      { yj_code: '1124001F1030', is_generic: false },
    ]);
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMasterChangeEvent.create.mockResolvedValue({ id: 'change_1' });
  });

  it('previews generic flag updates without writing import logs or drug masters', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        [
          '区分',
          '薬価基準収載医薬品コード',
          '品名',
          '診療報酬において加算等の算定対象となる後発医薬品',
        ],
        ['内用薬', 'NOT_A_YJ', '不正YJ薬', '後発品'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', null],
        ['内用薬', '1124001F1030', 'エスタゾラム錠１ｍｇ「アメル」', '後発品'],
      ],
    });

    const result = await previewMhlwGenericFlags(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result).toMatchObject({
      dryRun: true,
      operation: 'generic_flags',
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      sourcePublishedAt: '2026-05-20T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 2,
          drug_master_upsert_count: 2,
          skipped_invalid_yj: 1,
          changed_flag_count: 1,
          sampled_rows: 2,
        },
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.preview.rows).toEqual([
      {
        yj_code: '1124001F1022',
        drug_name: 'ユーロジン１ｍｇ錠',
        action: 'upsert_generic_flag',
        previous_is_generic: false,
        next_is_generic: false,
      },
      {
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        action: 'upsert_generic_flag',
        previous_is_generic: false,
        next_is_generic: true,
      },
    ]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
  });
});
