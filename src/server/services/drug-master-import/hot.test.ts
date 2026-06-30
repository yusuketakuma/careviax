import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { buildWorkbookBuffer } from './excel';
import { importHotMaster, parseHotMasterFile, previewHotMaster } from './hot';

describe('parseHotMasterFile', () => {
  it('parses CSV-based HOT master content', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,メーカー名',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,Ｔ’ｓ製薬',
    ].join('\n');

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(parsed.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        package_code: null,
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
        package_quantity: null,
        package_quantity_unit: null,
      },
    ]);
  });

  it('parses XLSX-based HOT master content', async () => {
    const workbook = await buildWorkbookBuffer({
      HOT: [
        ['HOTコード', 'YJコード', '販売名', 'メーカー名'],
        ['1234567890123', '1124001F1022', 'ユーロジン１ｍｇ錠', 'Ｔ’ｓ製薬'],
      ],
    });

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.xlsx',
      fetchImpl: async () =>
        new Response(new Blob([workbook]), {
          status: 200,
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }),
    });

    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        package_code: null,
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
        package_quantity: null,
        package_quantity_unit: null,
      },
    ]);
  });

  it('parses ZIP archives that contain a CSV hot master', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,メーカー名',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,Ｔ’ｓ製薬',
    ].join('\n');
    const zip = zipSync({
      'hot.csv': new TextEncoder().encode(csv),
    });

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.zip',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(zip)]), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        package_code: null,
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
        package_quantity: null,
        package_quantity_unit: null,
      },
    ]);
  });

  it('parses HOT package JAN and package quantity columns when present', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード,包装数量,包装単位,販売会社',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000,100,錠,Ｔ’ｓ販売',
    ].join('\n');

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        package_code: '4900000000000',
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ販売',
        package_quantity: '100',
        package_quantity_unit: '錠',
      },
    ]);
  });

  it('does not reuse package-code columns as package quantity units', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,販売包装単位コード',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000',
    ].join('\n');

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        package_code: '4900000000000',
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: null,
        package_quantity: null,
        package_quantity_unit: null,
      },
    ]);
  });

  it('detects a distinct package quantity unit column', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,販売包装単位コード,包装単位',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000,錠',
    ].join('\n');

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(parsed.records[0]).toMatchObject({
      package_code: '4900000000000',
      package_quantity_unit: '錠',
    });
  });

  it('rejects ZIP archives that exceed the configured entry count limit', async () => {
    const zip = zipSync({
      'hot-a.csv': new TextEncoder().encode('HOTコード,YJコード\n1,2'),
      'hot-b.csv': new TextEncoder().encode('HOTコード,YJコード\n3,4'),
    });

    await expect(
      parseHotMasterFile({
        fileUrl: 'https://www.medis.or.jp/hot.zip',
        zipLimits: {
          maxEntries: 1,
          maxEntryBytes: 1024,
          maxTotalBytes: 2048,
        },
        fetchImpl: async () =>
          new Response(new Blob([Buffer.from(zip)]), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
      }),
    ).rejects.toThrow(/エントリ数が上限/);
  });

  it('surfaces workbook parsing failures for .xlsx files', async () => {
    await expect(
      parseHotMasterFile({
        fileUrl: 'https://www.medis.or.jp/broken.xlsx',
        fetchImpl: async () =>
          new Response(new Blob([Buffer.from('not-an-xlsx', 'utf8')]), {
            status: 200,
            headers: {
              'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          }),
      }),
    ).rejects.toThrow();
  });
});

describe('importHotMaster', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    drugPackage: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMaster.findFirst.mockResolvedValue(null);
    db.drugMaster.update.mockResolvedValue({ id: 'drug_1' });
    db.drugPackage.findMany.mockResolvedValue([]);
    db.drugPackage.upsert.mockResolvedValue({ id: 'package_1' });
  });

  it('joins HOT codes onto DrugMaster by yj_code', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,メーカー名',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,Ｔ’ｓ製薬',
    ].join('\n');

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugMaster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { yj_code: '1124001F1022' },
        update: expect.objectContaining({
          hot_code: '1234567890123',
        }),
      }),
    );
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        source_url: 'https://www.medis.or.jp/hot_20260611.csv',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_published_at: new Date(Date.UTC(2026, 5, 11)),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 1,
          imported_records: 1,
          package_records: 0,
          skipped_missing_yj: 0,
          skipped_invalid_yj: 0,
          skipped_invalid_package_code: 0,
          skipped_package_conflict_count: 0,
        },
      }),
    });
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
  });

  it('upserts DrugPackage rows from HOT package JAN columns', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード,包装数量,包装単位,販売会社',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000,100,錠,Ｔ’ｓ販売',
    ].join('\n');

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(result.packageImportedCount).toBe(1);
    expect(db.drugPackage.upsert).toHaveBeenCalledWith({
      where: { gtin: '04900000000000' },
      create: expect.objectContaining({
        drug_master_id: 'drug_1',
        gtin: '04900000000000',
        jan_code: '4900000000000',
        package_level: 'sales',
        package_quantity: expect.any(Object),
        package_quantity_unit: '錠',
        manufacturer: 'Ｔ’ｓ販売',
        source: 'hot',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_record_id: '1234567890123',
        is_active: true,
      }),
      update: expect.objectContaining({
        drug_master_id: 'drug_1',
        jan_code: '4900000000000',
        package_level: 'sales',
        package_quantity: expect.any(Object),
        package_quantity_unit: '錠',
        manufacturer: 'Ｔ’ｓ販売',
        source: 'hot',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_record_id: '1234567890123',
        is_active: true,
      }),
    });
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        change_summary: expect.objectContaining({
          package_records: 1,
          skipped_invalid_package_code: 0,
        }),
      }),
    });
  });

  it('does not upsert DrugPackage rows for invalid HOT package codes', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,JAN001',
    ].join('\n');

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(result.packageImportedCount).toBe(0);
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        change_summary: expect.objectContaining({
          package_records: 0,
          skipped_invalid_package_code: 1,
          skipped_package_conflict_count: 0,
        }),
      }),
    });
  });

  it('skips non-empty malformed YJ codes instead of creating DrugMaster or DrugPackage rows', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード',
      '1234567890123,NOT_A_YJ,ユーロジン１ｍｇ錠,4900000000000',
    ].join('\n');

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(0);
    expect(result.packageImportedCount).toBe(0);
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        change_summary: expect.objectContaining({
          skipped_missing_yj: 0,
          skipped_invalid_yj: 1,
          skipped_invalid_package_code: 0,
          skipped_package_conflict_count: 0,
        }),
      }),
    });
  });

  it('does not reassign an existing GTIN to a different DrugMaster', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000',
    ].join('\n');
    db.drugPackage.findMany.mockResolvedValueOnce([
      {
        gtin: '04900000000000',
        drug_master_id: 'drug_other',
        source: 'hot',
        source_record_id: 'other_hot',
        is_active: true,
        drug_master: { yj_code: '9999999F9999' },
      },
    ]);

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(result.packageImportedCount).toBe(0);
    expect(db.drugMaster.upsert).toHaveBeenCalled();
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        change_summary: expect.objectContaining({
          package_records: 0,
          skipped_package_conflict_count: 1,
        }),
      }),
    });
  });

  it('skips HOT records without YJ code instead of linking by drug name', async () => {
    const csv = ['HOTコード,YJコード,販売名,メーカー名', '1234567890123,,同名薬,Ｔ’ｓ製薬'].join(
      '\n',
    );

    const result = await importHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    });

    expect(result.importedCount).toBe(0);
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugMaster.findFirst).not.toHaveBeenCalled();
    expect(db.drugMaster.update).not.toHaveBeenCalled();
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
  });

  it('previews HOT master and package upserts without writing import logs or rows', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード,包装数量,包装単位,販売会社',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,4900000000000,100,錠,Ｔ’ｓ販売',
      '2234567890123,2124001F1022,サンプル錠,JAN001,20,錠,サンプル販売',
      '3234567890123,,同名薬,4900000000000,50,錠,同名販売',
    ].join('\n');

    const result = await previewHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
      previewLimit: 10,
    });

    expect(result).toMatchObject({
      dryRun: true,
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      sourcePublishedAt: '2026-06-11T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 3,
          drug_master_upsert_count: 2,
          package_upsert_count: 1,
          skipped_missing_yj: 1,
          skipped_invalid_yj: 0,
          skipped_invalid_package_code: 1,
          skipped_package_conflict_count: 0,
          sampled_rows: 3,
        },
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        drug_master_action: 'upsert',
        package_action: 'upsert',
        gtin: '04900000000000',
        jan_code: '4900000000000',
      }),
      expect.objectContaining({
        hot_code: '2234567890123',
        yj_code: '2124001F1022',
        drug_master_action: 'upsert',
        package_action: 'skip_invalid_code',
        gtin: null,
        jan_code: null,
      }),
      expect.objectContaining({
        hot_code: '3234567890123',
        yj_code: null,
        drug_master_action: 'skip_missing_yj',
        package_action: 'none',
      }),
    ]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
  });

  it('previews invalid YJ and existing GTIN conflicts without writing rows', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,JANコード',
      '1234567890123,NOT_A_YJ,ユーロジン１ｍｇ錠,4900000000000',
      '2234567890123,1124001F1022,サンプル錠,4900000000000',
    ].join('\n');
    db.drugPackage.findMany.mockResolvedValueOnce([
      {
        gtin: '04900000000000',
        drug_master_id: 'drug_other',
        source: 'hot',
        source_record_id: 'other_hot',
        is_active: true,
        drug_master: { yj_code: '9999999F9999' },
      },
    ]);

    const result = await previewHotMaster(db, {
      fileUrl: 'https://www.medis.or.jp/hot_20260611.csv',
      fetchImpl: async () =>
        new Response(new Blob([Buffer.from(csv, 'utf8')]), {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
      previewLimit: 10,
    });

    expect(result.preview.summary).toEqual({
      parsed_records: 2,
      drug_master_upsert_count: 1,
      package_upsert_count: 0,
      skipped_missing_yj: 0,
      skipped_invalid_yj: 1,
      skipped_invalid_package_code: 0,
      skipped_package_conflict_count: 1,
      sampled_rows: 2,
    });
    expect(result.preview.rows).toEqual([
      expect.objectContaining({
        hot_code: '1234567890123',
        yj_code: 'NOT_A_YJ',
        drug_master_action: 'skip_invalid_yj',
        package_action: 'none',
      }),
      expect.objectContaining({
        hot_code: '2234567890123',
        yj_code: '1124001F1022',
        drug_master_action: 'upsert',
        package_action: 'conflict_existing_gtin',
        gtin: '04900000000000',
      }),
    ]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(db.drugPackage.upsert).not.toHaveBeenCalled();
  });
});
