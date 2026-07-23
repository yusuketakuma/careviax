import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMhlwTestSupport } from './mhlw.test-support';

const {
  genericNameWorkbookBlob,
  importGenericNameMappings,
  parseGenericNameWorkbook,
  previewGenericNameMappings,
  toWorkbookResponse,
  workbookBlob,
} = getMhlwTestSupport();

describe('importGenericNameMappings', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
    },
    genericDrugMapping: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1124001F1022',
        drug_name: 'ユーロジン１ｍｇ錠',
        generic_name: 'エスタゾラム',
        manufacturer: 'Ｔ’ｓ製薬',
      },
      {
        id: 'drug_2',
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        generic_name: 'エスタゾラム',
        manufacturer: '共和薬品工業',
      },
      {
        id: 'drug_name_only',
        yj_code: '9999001F1020',
        drug_name: 'エスタゾラム配合注意薬',
        generic_name: null,
        manufacturer: '誤候補製薬',
      },
    ]);
    db.genericDrugMapping.deleteMany.mockResolvedValue({ count: 0 });
    db.genericDrugMapping.create.mockResolvedValue({ id: 'mapping_1' });
  });

  it('rebuilds GenericDrugMapping entries from the workbook', async () => {
    const workbook = await workbookBlob({
      '一般名処方マスタ（R8.4.1版） 全体': [
        ['一般名処方マスタ'],
        [null, null, null, null, null, null, null, null, '令和8年4月1日適用'],
        [
          '区分',
          '一般名コード',
          '一般名処方の標準的な記載',
          '成分名',
          '規格',
          '一般名処方加算対象',
          '例外コード',
          '同一剤形・規格内の最低薬価',
          '備考',
        ],
        [
          '内用薬',
          '1124001F2ZZZ',
          '【般】エスタゾラム錠１ｍｇ',
          'エスタゾラム',
          '１ｍｇ１錠',
          '加算1,2',
          null,
          '6.30',
          null,
        ],
      ],
      例外コード品目対照表: [
        ['一般名処方マスタ（例外コード表）'],
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          '令和8年4月1日適用',
        ],
        [
          '区分',
          '一般名コード',
          '一般名処方の標準的な記載',
          '成分名',
          '規格',
          '薬価基準収載医薬品コード',
          '品名',
          null,
          null,
          null,
          'メーカー名',
          null,
          '先発医薬品',
          '同一剤形・規格の後発医薬品がある先発医薬品',
          '薬価',
          '経過措置による使用期限',
          '備考',
        ],
        [
          '内用薬',
          '1124001F2ZZZ',
          '【般】エスタゾラム錠１ｍｇ',
          'エスタゾラム',
          '１ｍｇ１錠',
          '1124001F1030',
          null,
          null,
          null,
          null,
          '共和薬品工業',
          null,
          '後発品',
          null,
          '6.30',
          null,
          null,
        ],
      ],
    });

    const result = await importGenericNameMappings(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(result.importedCount).toBe(1);
    expect(db.genericDrugMapping.deleteMany).toHaveBeenCalledOnce();
    expect(db.genericDrugMapping.create).toHaveBeenCalledWith({
      data: {
        generic_name: 'エスタゾラム',
        brand_drug_ids: ['drug_1', 'drug_2'],
        price_comparison: expect.objectContaining({
          general_name_code: '1124001F2ZZZ',
          standard_name: '【般】エスタゾラム錠１ｍｇ',
          exception_codes: ['1124001F1030'],
        }),
      },
    });
  });

  it('skips malformed exception YJ codes before mapping brand candidates', async () => {
    db.drugMaster.findMany.mockResolvedValueOnce([
      {
        id: 'drug_valid',
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        generic_name: null,
        manufacturer: '共和薬品工業',
      },
      {
        id: 'drug_invalid',
        yj_code: 'NOT_A_YJ',
        drug_name: '不正YJ候補',
        generic_name: null,
        manufacturer: '誤候補製薬',
      },
      {
        id: 'drug_same_length_invalid',
        yj_code: 'AAAAAAAAAAAA',
        drug_name: '不正同桁候補',
        generic_name: null,
        manufacturer: '誤候補製薬',
      },
    ]);
    const workbook = await genericNameWorkbookBlob([
      'NOT_A_YJ',
      'AAAAAAAAAAAA',
      '123456789012',
      '1124001F1030',
    ]);

    const result = await importGenericNameMappings(db, {
      workbookUrl:
        'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(result.importedCount).toBe(1);
    expect(db.genericDrugMapping.create).toHaveBeenCalledWith({
      data: {
        generic_name: 'エスタゾラム',
        brand_drug_ids: ['drug_valid'],
        price_comparison: expect.objectContaining({
          exception_codes: ['1124001F1030'],
          brand_candidates: [
            {
              yj_code: '1124001F1030',
              drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
              manufacturer: '共和薬品工業',
            },
          ],
        }),
      },
    });
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        change_summary: expect.objectContaining({
          parsed_records: 1,
          imported_records: 1,
          brand_candidate_count: 1,
          skipped_invalid_yj: 3,
        }),
      }),
    });
  });

  it('fails matched-invalid mapping provenance before replacing any mappings', async () => {
    const workbook = await genericNameWorkbookBlob();

    await expect(
      importGenericNameMappings(db, {
        workbookUrl:
          'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260230.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      }),
    ).rejects.toThrow('DRUG_MASTER_SOURCE_DATE_INVALID');
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.genericDrugMapping.deleteMany).not.toHaveBeenCalled();
    expect(db.genericDrugMapping.create).not.toHaveBeenCalled();
  });
});

describe('previewGenericNameMappings', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
    },
    genericDrugMapping: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1124001F1022',
        drug_name: 'ユーロジン１ｍｇ錠',
        generic_name: 'エスタゾラム',
        manufacturer: 'Ｔ’ｓ製薬',
      },
      {
        id: 'drug_2',
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        generic_name: 'エスタゾラム',
        manufacturer: '共和薬品工業',
      },
    ]);
    db.genericDrugMapping.deleteMany.mockResolvedValue({ count: 0 });
    db.genericDrugMapping.create.mockResolvedValue({ id: 'mapping_1' });
  });

  it('previews generic-name mapping rebuilds without deleting or creating mappings', async () => {
    const workbook = await genericNameWorkbookBlob();

    const result = await previewGenericNameMappings(db, {
      workbookUrl:
        'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result).toMatchObject({
      dryRun: true,
      operation: 'generic_mapping',
      workbookUrl:
        'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
      sourcePublishedAt: '2026-04-01T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 1,
          generic_mapping_replace_count: 1,
          brand_candidate_count: 2,
          sampled_rows: 1,
        },
        rows: [
          {
            generic_name: 'エスタゾラム',
            standard_name: '【般】エスタゾラム錠１ｍｇ',
            action: 'replace_mapping',
            brand_candidate_count: 2,
            exception_code_count: 1,
            lowest_price: '6.3',
            add_on_scope: '加算1,2',
          },
        ],
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.preview.rows[0]?.brand_candidates).toEqual([
      {
        yj_code: '1124001F1022',
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
      },
      {
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        manufacturer: '共和薬品工業',
      },
    ]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.genericDrugMapping.deleteMany).not.toHaveBeenCalled();
    expect(db.genericDrugMapping.create).not.toHaveBeenCalled();
  });

  it('previews malformed exception YJ skips without mapping polluted DrugMaster rows', async () => {
    db.drugMaster.findMany.mockResolvedValueOnce([
      {
        id: 'drug_valid',
        yj_code: '1124001F1030',
        drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
        generic_name: null,
        manufacturer: '共和薬品工業',
      },
      {
        id: 'drug_invalid',
        yj_code: 'NOT_A_YJ',
        drug_name: '不正YJ候補',
        generic_name: null,
        manufacturer: '誤候補製薬',
      },
      {
        id: 'drug_same_length_invalid',
        yj_code: 'AAAAAAAAAAAA',
        drug_name: '不正同桁候補',
        generic_name: null,
        manufacturer: '誤候補製薬',
      },
    ]);
    const workbook = await genericNameWorkbookBlob([
      'NOT_A_YJ',
      'AAAAAAAAAAAA',
      '123456789012',
      '1124001F1030',
    ]);

    const result = await previewGenericNameMappings(db, {
      workbookUrl:
        'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      parsed_records: 1,
      generic_mapping_replace_count: 1,
      brand_candidate_count: 1,
      skipped_invalid_yj: 3,
      sampled_rows: 1,
    });
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        generic_name: 'エスタゾラム',
        exception_code_count: 1,
        brand_candidate_count: 1,
        brand_candidates: [
          {
            yj_code: '1124001F1030',
            drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
            manufacturer: '共和薬品工業',
          },
        ],
      }),
    ]);
    expect(db.genericDrugMapping.deleteMany).not.toHaveBeenCalled();
    expect(db.genericDrugMapping.create).not.toHaveBeenCalled();
  });
});

describe('parseGenericNameWorkbook', () => {
  it('fails when the expected named worksheets are missing', async () => {
    const workbook = await workbookBlob({
      Other: [['header']],
    });

    await expect(
      parseGenericNameWorkbook({
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/generic.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      }),
    ).rejects.toThrow(
      "Excel ワークシート '一般名処方マスタ（R8.4.1版） 全体' を解決できませんでした",
    );
  });
});
