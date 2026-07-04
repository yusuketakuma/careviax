import { beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateGlobalDisplayIdMock } = vi.hoisted(() => ({
  allocateGlobalDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateGlobalDisplayId: allocateGlobalDisplayIdMock,
}));

import {
  importMhlwGenericFlags,
  importMhlwPriceList,
  importGenericNameMappings,
  parseMhlwPriceWorkbook,
  parseGenericNameWorkbook,
  previewGenericNameMappings,
  previewMhlwGenericFlags,
  previewMhlwPriceList,
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

async function genericNameWorkbookBlob(exceptionYjCodes: Array<string | null> = ['1124001F1030']) {
  return workbookBlob({
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
      ...exceptionYjCodes.map((yjCode, index) => [
        '内用薬',
        index === 0 ? '1124001F2ZZZ' : null,
        '【般】エスタゾラム錠１ｍｇ',
        'エスタゾラム',
        '１ｍｇ１錠',
        yjCode,
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
      ]),
    ],
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
    expect(parsed.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
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
    $queryRaw: vi.fn(),
    drugPriceVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([]);
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMasterChangeEvent.create.mockResolvedValue({ id: 'change_1' });
    let displayIdSequence = 0;
    allocateGlobalDisplayIdMock.mockImplementation(async () => {
      displayIdSequence += 1;
      return `dpv_${String(displayIdSequence).padStart(12, '0')}`;
    });
    db.drugPriceVersion.findUnique.mockResolvedValue(null);
    db.drugPriceVersion.create.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.update.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.findMany.mockResolvedValue([]);
  });

  it('imports all MHLW price category workbooks by default', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '成分名', '規格', '品名', 'メーカー名', '薬価'],
        [
          '内用薬',
          '1124001F1022',
          'エスタゾラム',
          '１ｍｇ１錠',
          'ユーロジン１ｍｇ錠',
          'Ｔ’ｓ製薬',
          '6.30',
        ],
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

    const result = await importMhlwPriceList(db, { fetchImpl });

    expect(result.importedCount).toBe(2);
    expect(result.workbookUrls).toEqual([
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_02.xlsx',
    ]);
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 2,
        source_url: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_published_at: new Date(Date.UTC(2026, 4, 20)),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          workbook_count: 2,
          parsed_records: 2,
          imported_records: 2,
          skipped_invalid_yj: 0,
          change_event_count: 0,
          price_version_effective_from_source: 'source_published_at',
          price_version_create_count: 2,
          price_version_update_count: 0,
          price_version_skipped_missing_effective_from: 0,
        },
      }),
    });
    expect(db.drugMaster.upsert).toHaveBeenCalledTimes(2);
    expect(db.drugPriceVersion.create).toHaveBeenCalledTimes(2);
    expect(db.drugPriceVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: expect.stringMatching(/^dpv_\d{12}$/),
          drug_master_id: 'drug_1',
          source: 'mhlw_price',
          source_published_at: new Date(Date.UTC(2026, 4, 20)),
          effective_from: new Date(Date.UTC(2026, 4, 20)),
          source_url: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
          source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
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

    await importMhlwPriceList(db, {
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

  it.each(['NOT_A_YJ', 'AAAAAAAAAAAA', '123456789012'])(
    'skips malformed non-empty YJ code %s before DrugMaster upsert',
    async (yjCode) => {
      const workbook = await workbookBlob({
        ＨＰ用: [
          ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
          ['内用薬', yjCode, '不正YJ薬', '7.10'],
        ],
      });

      const result = await importMhlwPriceList(db, {
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      });

      expect(result.importedCount).toBe(0);
      expect(db.drugMaster.findMany).not.toHaveBeenCalled();
      expect(db.drugMaster.upsert).not.toHaveBeenCalled();
      expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
      expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
        where: { id: 'log_1' },
        data: expect.objectContaining({
          record_count: 0,
          change_summary: expect.objectContaining({
            parsed_records: 0,
            imported_records: 0,
            skipped_invalid_yj: 1,
            change_event_count: 0,
            price_version_create_count: 0,
            price_version_update_count: 0,
            price_version_skipped_missing_effective_from: 0,
          }),
        }),
      });
    },
  );

  it('previews malformed same-length YJ skips without writing rows', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', 'AAAAAAAAAAAA', '不正YJ薬', '7.10'],
        ['内用薬', '123456789012', '数字のみ不正YJ薬', '8.20'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '6.30'],
      ],
    });

    const result = await previewMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      parsed_records: 1,
      drug_master_upsert_count: 1,
      skipped_invalid_yj: 2,
      records_with_change_event: 0,
      change_event_count: 0,
      price_version_create_count: 0,
      price_version_update_count: 0,
      price_version_skipped_missing_effective_from: 1,
      sampled_rows: 1,
    });
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        yj_code: '1124001F1022',
        action: 'upsert',
      }),
    ]);
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
  });

  it('previews MHLW price upserts and change events without writing rows', async () => {
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
        [
          '内用薬',
          '1124001F1030',
          'エスタゾラム',
          '１ｍｇ１錠',
          'エスタゾラム錠１ｍｇ「アメル」',
          '共和薬品工業',
          '6.30',
          null,
        ],
      ],
    });
    db.drugMaster.findMany.mockResolvedValueOnce([
      {
        id: 'drug_1',
        yj_code: '1124001F1022',
        drug_price: { toString: () => '6.30' },
        transitional_expiry_date: null,
      },
    ]);

    const result = await previewMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result).toMatchObject({
      dryRun: true,
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      workbookUrls: ['https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx'],
      sourcePublishedAt: '2026-05-20T00:00:00.000Z',
      preview: {
        summary: {
          workbook_count: 1,
          parsed_records: 2,
          drug_master_upsert_count: 2,
          skipped_invalid_yj: 0,
          records_with_change_event: 1,
          change_event_count: 2,
          price_version_create_count: 2,
          price_version_update_count: 0,
          price_version_skipped_missing_effective_from: 0,
          sampled_rows: 2,
        },
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        yj_code: '1124001F1022',
        action: 'upsert',
        price_version_action: 'create',
        price_version_effective_from: '2026-05-20T00:00:00.000Z',
        change_event_types: ['price_changed', 'transitional_expiry_changed'],
        previous_drug_price: '6.30',
        next_drug_price: '7.1',
        previous_transitional_expiry_date: null,
        next_transitional_expiry_date: '2027-03-31T00:00:00.000Z',
      }),
      expect.objectContaining({
        yj_code: '1124001F1030',
        action: 'upsert',
        price_version_action: 'create',
        price_version_effective_from: '2026-05-20T00:00:00.000Z',
        change_event_types: [],
      }),
    ]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
  });

  it('previews malformed short YJ skips without writing rows', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', 'NOT_A_YJ', '不正YJ薬', '7.10'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '6.30'],
      ],
    });

    const result = await previewMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      parsed_records: 1,
      drug_master_upsert_count: 1,
      skipped_invalid_yj: 1,
      records_with_change_event: 0,
      change_event_count: 0,
      price_version_create_count: 0,
      price_version_update_count: 0,
      price_version_skipped_missing_effective_from: 1,
      sampled_rows: 1,
    });
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        yj_code: '1124001F1022',
        action: 'upsert',
      }),
    ]);
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
  });
});

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
