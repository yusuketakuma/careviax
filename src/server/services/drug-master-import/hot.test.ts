import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { buildWorkbookBuffer } from './excel';
import { importHotMaster, parseHotMasterFile } from './hot';

describe('parseHotMasterFile', () => {
  it('parses CSV-based HOT master content', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,メーカー名',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,Ｔ’ｓ製薬',
    ].join('\n');

    const parsed = await parseHotMasterFile({
      fileUrl: 'https://example.com/hot.csv',
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
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
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
      fileUrl: 'https://example.com/hot.xlsx',
      fetchImpl: async () =>
        new Response(new Blob([workbook]), {
          status: 200,
          headers: {
            'content-type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }),
    });

    expect(parsed.records).toEqual([
      {
        hot_code: '1234567890123',
        yj_code: '1124001F1022',
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
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
      fileUrl: 'https://example.com/hot.zip',
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
        drug_name: 'ユーロジン１ｍｇ錠',
        manufacturer: 'Ｔ’ｓ製薬',
      },
    ]);
  });

  it('surfaces workbook parsing failures for .xlsx files', async () => {
    await expect(
      parseHotMasterFile({
        fileUrl: 'https://example.com/broken.xlsx',
        fetchImpl: async () =>
          new Response(new Blob([Buffer.from('not-an-xlsx', 'utf8')]), {
            status: 200,
            headers: {
              'content-type':
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          }),
      })
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
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.upsert.mockResolvedValue({ id: 'drug_1' });
    db.drugMaster.findFirst.mockResolvedValue(null);
    db.drugMaster.update.mockResolvedValue({ id: 'drug_1' });
  });

  it('joins HOT codes onto DrugMaster by yj_code', async () => {
    const csv = [
      'HOTコード,YJコード,販売名,メーカー名',
      '1234567890123,1124001F1022,ユーロジン１ｍｇ錠,Ｔ’ｓ製薬',
    ].join('\n');

    const result = await importHotMaster(db as never, {
      fileUrl: 'https://example.com/hot.csv',
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
      })
    );
  });
});
