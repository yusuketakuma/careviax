import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMhlwTestSupport } from './mhlw.test-support';

const {
  allocateGlobalDisplayIdMock,
  importMhlwPriceList,
  previewMhlwPriceList,
  toWorkbookResponse,
  workbookBlob,
} = getMhlwTestSupport();

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
    $transaction: vi.fn(),
    drugPriceVersion: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
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
    let displayIdSequence = 0;
    allocateGlobalDisplayIdMock.mockImplementation(async () => {
      displayIdSequence += 1;
      return `dpv_${String(displayIdSequence).padStart(12, '0')}`;
    });
    db.drugPriceVersion.findUnique.mockResolvedValue(null);
    db.drugPriceVersion.create.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.update.mockResolvedValue({ id: 'dpv_1' });
    db.drugPriceVersion.findMany.mockResolvedValue([]);
    db.drugPriceVersion.updateMany.mockResolvedValue({ count: 0 });
    db.$transaction.mockImplementation(async (callback) => callback(db));
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
          price_version_close_count: 0,
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

  it('quarantines invalid date rows and persists a bounded partial-import summary', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価', '経過措置による使用期限'],
        ['内用薬', '1124001F1022', 'VALID-DRUG', '6.30', '2027/03/31'],
        ['内用薬', '1124001F1030', 'SECRET-DRUG', '7.10', '2027/02/30'],
      ],
    });

    const result = await importMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugMaster.upsert).toHaveBeenCalledOnce();
    const completedUpdate = db.drugMasterImportLog.update.mock.calls.at(-1)?.[0];
    expect(completedUpdate).toEqual({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        import_mode: 'partial',
        change_summary: expect.objectContaining({
          mode: 'partial',
          parsed_records: 1,
          imported_records: 1,
          quarantined_date_records: 1,
          quarantine_invalid_format_count: 0,
          quarantine_invalid_calendar_date_count: 1,
          quarantine_invalid_era_boundary_count: 0,
        }),
      }),
    });
    expect(JSON.stringify(completedUpdate)).not.toMatch(/SECRET-DRUG|2027\/02\/30|1124001F1030/);
  });

  it('fails before price or version writes when all candidate dates are quarantined', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価', '経過措置による使用期限'],
        ['内用薬', '1124001F1030', 'SECRET-DRUG', '7.10', '2027/02/30'],
      ],
    });

    await expect(
      importMhlwPriceList(db, {
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      }),
    ).rejects.toThrow('DRUG_MASTER_DATE_ALL_ROWS_QUARANTINED');
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugPriceVersion.create).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
    expect(JSON.stringify(db.drugMasterImportLog.update.mock.calls)).not.toMatch(
      /SECRET-DRUG|2027\/02\/30|1124001F1030/,
    );
  });

  it('fails a matched-invalid workbook date before fetch or database writes', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      importMhlwPriceList(db, {
        workbookUrl: 'https://www.mhlw.go.jp/topics/xls/tp20260230-01_01.xlsx',
        fetchImpl,
      }),
    ).rejects.toThrow('DRUG_MASTER_SOURCE_DATE_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
  });

  it('closes prior open price versions in the same transaction when creating a newer version', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '7.10'],
      ],
    });
    const tx = {
      $queryRaw: vi.fn(),
      drugPriceVersion: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'dpv_new' }),
        update: vi.fn().mockResolvedValue({ id: 'dpv_new' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    db.$transaction.mockImplementationOnce(async (callback) => callback(tx));
    db.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1124001F1022',
        drug_price: { toString: () => '6.30' },
        transitional_expiry_date: null,
      },
    ]);

    await importMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260501-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
    });

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(allocateGlobalDisplayIdMock).toHaveBeenCalledWith(tx, 'DrugPriceVersion');
    expect(tx.drugPriceVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          drug_master_id: 'drug_1',
          effective_from: new Date(Date.UTC(2026, 4, 1)),
        }),
      }),
    );
    expect(tx.drugPriceVersion.updateMany).toHaveBeenCalledWith({
      where: {
        drug_master_id: 'drug_1',
        effective_from: { lt: new Date(Date.UTC(2026, 4, 1)) },
        effective_to: null,
      },
      data: {
        effective_to: new Date(Date.UTC(2026, 3, 30)),
      },
    });
    expect(tx.drugPriceVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.drugPriceVersion.updateMany.mock.invocationCallOrder[0],
    );
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        change_summary: expect.objectContaining({
          price_version_create_count: 1,
          price_version_close_count: 1,
        }),
      }),
    });
  });

  it('fails closed when prior-version close fails after creating a newer version', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '7.10'],
      ],
    });
    const closeError = new Error('close failed');
    const tx = {
      $queryRaw: vi.fn(),
      drugPriceVersion: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'dpv_new' }),
        update: vi.fn().mockResolvedValue({ id: 'dpv_new' }),
        updateMany: vi.fn().mockRejectedValue(closeError),
      },
    };
    db.$transaction.mockImplementationOnce(async (callback) => callback(tx));

    await expect(
      importMhlwPriceList(db, {
        workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260501-01_01.xlsx',
        fetchImpl: async () => toWorkbookResponse(workbook),
      }),
    ).rejects.toThrow(closeError);

    expect(tx.drugPriceVersion.create).toHaveBeenCalledOnce();
    expect(tx.drugPriceVersion.updateMany).toHaveBeenCalledOnce();
    expect(db.drugMasterImportLog.update).toHaveBeenLastCalledWith({
      where: { id: 'log_1' },
      data: {
        status: 'failed',
        error_log: '医薬品マスタ取込に失敗しました',
      },
    });
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
            price_version_close_count: 0,
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
      price_version_close_count: 0,
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

  it('exposes only bounded date-quarantine counters in the price preview', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価', '経過措置による使用期限'],
        ['内用薬', '1124001F1022', 'VALID-DRUG', '6.30', '2027/03/31'],
        ['内用薬', '1124001F1030', 'SECRET-DRUG', '7.10', '2027/02/30'],
      ],
    });

    const result = await previewMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      parsed_records: 1,
      drug_master_upsert_count: 1,
      quarantined_date_records: 1,
      quarantine_invalid_format_count: 0,
      quarantine_invalid_calendar_date_count: 1,
      quarantine_invalid_era_boundary_count: 0,
    });
    expect(result.preview.rows).toHaveLength(1);
    expect(JSON.stringify(result.preview)).not.toMatch(/SECRET-DRUG|2027\/02\/30|1124001F1030/);
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
          price_version_close_count: 0,
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

  it('previews prior open price-version closes without writing rows', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '7.10'],
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
    db.drugPriceVersion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        drug_master_id: 'drug_1',
        effective_from: new Date(Date.UTC(2026, 3, 1)),
      },
    ]);

    const result = await previewMhlwPriceList(db, {
      workbookUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260501-01_01.xlsx',
      fetchImpl: async () => toWorkbookResponse(workbook),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      price_version_create_count: 1,
      price_version_close_count: 1,
      price_version_update_count: 0,
    });
    expect(result.preview.rows[0]).toMatchObject({
      price_version_action: 'create',
      price_version_effective_from: '2026-05-01T00:00:00.000Z',
      price_version_close_count: 1,
      price_version_close_effective_to: '2026-04-30T00:00:00.000Z',
    });
    expect(db.drugPriceVersion.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          drug_master_id: { in: ['drug_1'] },
          effective_from: { lt: new Date(Date.UTC(2026, 4, 1)) },
          effective_to: null,
        },
      }),
    );
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugPriceVersion.updateMany).not.toHaveBeenCalled();
    expect(db.drugMasterChangeEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the workbook tp date ahead of a mismatched page applicable date', async () => {
    const workbook = await workbookBlob({
      ＨＰ用: [
        ['区分', '薬価基準収載医薬品コード', '品名', '薬価'],
        ['内用薬', '1124001F1022', 'ユーロジン１ｍｇ錠', '6.30'],
      ],
    });
    const indexHtml = `
      <a href="/topics/2026/04/tp20260401-01.html">薬価基準収載品目リストについて（令和8年5月20日適用）</a>
    `;
    const detailHtml = `<a href="/topics/2026/04/xls/tp20260401-01_01.xlsx">Excel</a>`;
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

    const result = await previewMhlwPriceList(db, { fetchImpl, previewLimit: 10 });

    expect(result.sourcePublishedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(result.preview.rows[0]).toMatchObject({
      price_version_action: 'create',
      price_version_effective_from: '2026-04-01T00:00:00.000Z',
    });
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
      price_version_close_count: 0,
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
