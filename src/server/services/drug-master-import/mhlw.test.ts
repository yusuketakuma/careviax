import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importMhlwPriceList,
  importGenericNameMappings,
  parseMhlwPriceWorkbook,
  parseGenericNameWorkbook,
  resolveLatestGenericNameWorkbookUrl,
  resolveLatestMhlwPriceListPageUrl,
  resolveLatestMhlwPriceWorkbookUrl,
  resolveLatestMhlwPriceWorkbookUrls,
} from './mhlw';
import { buildWorkbookBuffer } from './excel';

async function workbookBlob(sheets: Record<string, (string | null)[][]>) {
  return buildWorkbookBuffer(sheets);
}

function toWorkbookResponse(buffer: Buffer) {
  return new Response(new Blob([new Uint8Array(buffer)]), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
}

describe('resolveLatestMhlwPriceWorkbookUrl', () => {
  it('extracts the latest price list detail page url from the MHLW index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リストについて（令和8年5月20日適用）</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceListPageUrl(html)).toBe(
      'https://www.mhlw.go.jp/topics/2026/04/tp20260401-01.html',
    );
  });

  it('extracts the latest price workbook url from the index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/xls/tp20260401-01_01.xlsx">Excel</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceWorkbookUrl(html)).toBe(
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260401-01_01.xlsx',
    );
  });

  it('extracts all listed price workbook urls from the current index page', () => {
    const html = `
      <ul>
        <li><a href="/topics/2026/04/xls/tp20260520-01_01.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_02.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_03.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260401-01_04.xlsx">Excel</a></li>
        <li><a href="/topics/2026/04/xls/tp20260520-01_05.xlsx">Excel</a></li>
      </ul>
    `;

    expect(resolveLatestMhlwPriceWorkbookUrls(html)).toEqual([
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_02.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_03.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260401-01_04.xlsx',
    ]);
  });
});

describe('resolveLatestGenericNameWorkbookUrl', () => {
  it('extracts the latest generic-name workbook url from the index page', () => {
    const html = `
      <ul>
        <li><a href="/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx">一般名</a></li>
      </ul>
    `;

    expect(resolveLatestGenericNameWorkbookUrl(html)).toBe(
      'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/dl/ippanmeishohoumaster_260401.xlsx',
    );
  });
});

describe('parseMhlwPriceWorkbook', () => {
  it('parses official-like price rows and generic indicators', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        [
          '区分',
          '薬価基準収載医薬品コード',
          '成分名',
          '規格',
          '品名',
          'メーカー名',
          '診療報酬において加算等の算定対象となる後発医薬品',
          '先発医薬品',
          '薬価',
          '経過措置による使用期限',
        ],
        [
          '内用薬',
          '1124001F1022',
          'エスタゾラム',
          '１ｍｇ１錠',
          'ユーロジン１ｍｇ錠',
          'Ｔ’ｓ製薬',
          null,
          '先発品',
          '6.30',
          null,
        ],
        [
          '内用薬',
          '1124001F1030',
          'エスタゾラム',
          '１ｍｇ１錠',
          'エスタゾラム錠１ｍｇ「アメル」',
          '共和薬品工業',
          '後発品',
          null,
          '6.30',
          '2027/03/31',
        ],
      ],
    });

    const parsed = await parseMhlwPriceWorkbook({
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '1124001F1022',
      drug_name: 'ユーロジン１ｍｇ錠',
      generic_name: 'エスタゾラム',
      manufacturer: 'Ｔ’ｓ製薬',
      unit: '１ｍｇ１錠',
      dosage_form: '内用薬',
      therapeutic_category: '1124',
      is_generic: false,
    });
    expect(parsed.records[1]).toMatchObject({
      yj_code: '1124001F1030',
      is_generic: true,
    });
    expect(parsed.records[1]?.transitional_expiry_date?.toISOString()).toBe(
      '2027-03-31T00:00:00.000Z',
    );
  });

  it('finds the price sheet even when it is not the first worksheet', async () => {
    const workbook = await workbookBlob({
      概要: [['このシートは無関係です']],
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', 'メーカー名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', 'Ｔ’ｓ製薬', '6.30'],
      ],
    });

    const parsed = await parseMhlwPriceWorkbook({
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '1124001F1022',
      drug_name: 'ユーロジン１ｍｇ錠',
      manufacturer: 'Ｔ’ｓ製薬',
    });
  });
});

describe('importMhlwPriceList', () => {
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
    db.drugMaster.findMany.mockResolvedValue([]);
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMasterChangeEvent.create.mockResolvedValue({ id: 'change_1' });
  });

  it('imports all MHLW price category workbooks by default', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '成分名', '規格', '品名', 'メーカー名', '薬価'],
        ['内用薬', '1124001F1022', 'エスタゾラム', '１ｍｇ１錠', 'ユーロジン１ｍｇ錠', 'Ｔ’ｓ製薬', '6.30'],
      ],
    });
    const indexHtml = `
      <a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リスト</a>
    `;
    const detailHtml = `
      <a href="/topics/2026/04/xls/tp20260520-01_01.xlsx">Excel</a>
      <a href="/topics/2026/04/xls/tp20260520-01_02.xlsx">Excel</a>
    `;
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith('0000078916.html')) {
        return new Response(indexHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('tp20260401-01.html')) {
        return new Response(detailHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return toWorkbookResponse(workbook);
    });

    const result = await importMhlwPriceList(db as never, { fetchImpl });

    expect(result.importedCount).toBe(2);
    expect(result.workbookUrls).toEqual([
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_02.xlsx',
    ]);
    expect(db.drugMaster.upsert).toHaveBeenCalledTimes(2);
    expect(db.drugMaster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          unit: '１ｍｇ１錠',
          therapeutic_category: '1124',
        }),
        update: expect.objectContaining({
          unit: '１ｍｇ１錠',
          therapeutic_category: '1124',
        }),
      }),
    );
  });

  it('records price and transitional-expiry changes during import', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        [
          '区分',
          '薬価基準収載医薬品コード',
          '成分名',
          '規格',
          '品名',
          'メーカー名',
          '薬価',
          '経過措置による使用期限',
        ],
        [
          '内用薬',
          '1124001F1022',
          'エスタゾラム',
          '１ｍｇ１錠',
          'ユーロジン１ｍｇ錠',
          'Ｔ’ｓ製薬',
          '7.10',
          '2027/03/31',
        ],
      ],
    });
    db.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1124001F1022',
        drug_price: { toString: () => '6.30' },
        transitional_expiry_date: null,
      },
    ]);

    await importMhlwPriceList(db as never, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(db.drugMasterChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          import_log_id: 'log_1',
          source: 'mhlw_price',
          yj_code: '1124001F1022',
          drug_master_id: 'drug_1',
          change_type: 'price_changed',
          previous_value: { drug_price: '6.30' },
          current_value: { drug_price: '7.1' },
        }),
      }),
    );
    expect(db.drugMasterChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          change_type: 'transitional_expiry_changed',
          previous_value: { transitional_expiry_date: null },
          current_value: { transitional_expiry_date: '2027-03-31T00:00:00.000Z' },
        }),
      }),
    );
  });
});

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

    const result = await importGenericNameMappings(db as never, {
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
