import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  importSskDrugMaster,
  parseSskDrugMasterZip,
  previewSskDrugMasterImport,
  resolveLatestSskDrugMasterZipUrl,
} from './ssk';

function toZipBlob(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function buildRow(overrides: Record<number, string>) {
  const row = Array.from({ length: 42 }, () => '');
  row[0] = '0';
  row[1] = 'Y';

  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }

  return row.map((value) => `"${value}"`).join(',');
}

function buildSskZip(csv: string) {
  return zipSync({
    'y_ALL_test.csv': Buffer.from(csv, 'utf8'),
  });
}

function buildZipFetch(zipped: Uint8Array): typeof fetch {
  return async () =>
    new Response(toZipBlob(zipped), {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    });
}

describe('resolveLatestSskDrugMasterZipUrl', () => {
  it('extracts the latest full ZIP url from the SSK page html', () => {
    const html = `
      <table>
        <tr>
          <td><a href="/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260319.zip">全件ファイル(ZIP:795KB)</a></td>
        </tr>
      </table>
    `;

    expect(resolveLatestSskDrugMasterZipUrl(html)).toBe(
      'https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260319.zip',
    );
  });

  it('rejects credential-bearing ZIP links before they can become job dedupe keys', () => {
    const html = `
      <table>
        <tr>
          <td><a href="https://importer:secret@www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/kihonmasta_04.files/y_ALL20260319.zip">全件ファイル(ZIP:795KB)</a></td>
        </tr>
      </table>
    `;

    expect(() => resolveLatestSskDrugMasterZipUrl(html)).toThrow(
      '認証情報を含む取込URLは指定できません',
    );
  });
});

describe('parseSskDrugMasterZip', () => {
  it('parses a zipped CSV payload and prefers richer duplicates by yj_code', async () => {
    const csv = [
      buildRow({
        2: '123456789',
        4: 'DRUG-A',
        6: 'DRUG-A-KANA',
        9: 'TAB',
        11: '9.50',
        13: '1',
        16: '0',
        27: '1',
        31: '123456789012',
        34: 'DRUG-A',
      }),
      buildRow({
        2: '123456789',
        4: 'DRUG-A',
        6: 'DRUG-A-KANA',
        9: 'TAB',
        11: '9.50',
        13: '1',
        16: '1',
        27: '1',
        31: '123456789012',
        34: 'DRUG-A',
        37: 'GENERIC-A',
      }),
      buildRow({
        2: '998877665',
        4: 'DRUG-B',
        6: 'DRUG-B-KANA',
        9: 'CAP',
        11: '12.00',
        13: '5',
        16: '0',
        27: '4',
        31: '998877665544',
        34: 'DRUG-B',
      }),
    ].join('\r\n');

    const fetchImpl = buildZipFetch(buildSskZip(csv));

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.entryName).toBe('y_ALL_test.csv');
    expect(parsed.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '123456789012',
      receipt_code: '123456789',
      drug_name: 'DRUG-A',
      generic_name: 'GENERIC-A',
      is_generic: true,
      is_narcotic: true,
      is_psychotropic: false,
      therapeutic_category: '1234',
      unit: 'TAB',
      dosage_form: '内用薬',
      transitional_expiry_date: null,
    });
    expect(parsed.records[1]).toMatchObject({
      yj_code: '998877665544',
      is_narcotic: false,
      is_psychotropic: true,
      therapeutic_category: '9988',
      dosage_form: '注射薬',
    });
  });

  it('parses transitional expiry dates when the SSK row carries one', async () => {
    const csv = buildRow({
      2: '610412196',
      4: 'SOSEGON',
      6: 'ｿｾｺﾞﾝ',
      9: '錠',
      11: '10.00',
      13: '0',
      16: '0',
      27: '1',
      31: '1149034F1026',
      33: '20270331',
      34: 'ソセゴン錠２５ｍｇ',
    });

    const fetchImpl = buildZipFetch(buildSskZip(csv));

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.transitional_expiry_date?.toISOString()).toBe(
      '2027-03-31T00:00:00.000Z',
    );
  });

  it('quarantines a whole row when either SSK date has an invalid calendar value', async () => {
    const csv = [
      buildRow({
        2: '610412196',
        31: '1149034F1026',
        33: '20270331',
        34: 'VALID-DRUG',
        35: '20260228',
      }),
      buildRow({
        2: '610412197',
        31: '1149034F1027',
        33: '20270230',
        34: 'ROLLOVER-DRUG',
        35: '20260228',
      }),
      buildRow({
        2: '610412198',
        31: '1149034F1028',
        33: '0',
        34: 'SENTINEL-DRUG',
        35: '99999999',
      }),
    ].join('\r\n');

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
      fetchImpl: buildZipFetch(buildSskZip(csv)),
    });

    expect(parsed.records.map((record) => record.yj_code)).toEqual([
      '1149034F1026',
      '1149034F1028',
    ]);
    expect(parsed.candidateRecordCount).toBe(3);
    expect(parsed.dateQuarantine).toEqual({
      quarantinedDateRecords: 1,
      invalidFormatCount: 0,
      invalidCalendarDateCount: 1,
      invalidEraBoundaryCount: 0,
    });
    expect(JSON.stringify(parsed.dateQuarantine)).not.toMatch(/20270230|1149034F1027/);
  });

  it('derives 14-day max administration windows for newly listed drugs', async () => {
    const recentListingDate = new Date();
    recentListingDate.setUTCDate(recentListingDate.getUTCDate() - 30);

    const oldListingDate = new Date();
    oldListingDate.setUTCDate(oldListingDate.getUTCDate() - 400);

    const csv = [
      buildRow({
        2: '111111111',
        4: 'NEW-DRUG',
        6: 'NEW-DRUG',
        27: '1',
        31: '111111111111',
        34: 'NEW-DRUG',
        35: formatDate(recentListingDate),
      }),
      buildRow({
        2: '222222222',
        4: 'OLD-DRUG',
        6: 'OLD-DRUG',
        27: '1',
        31: '222222222222',
        34: 'OLD-DRUG',
        35: formatDate(oldListingDate),
      }),
    ].join('\r\n');

    const fetchImpl = buildZipFetch(buildSskZip(csv));

    const parsed = await parseSskDrugMasterZip({
      zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
      fetchImpl,
    });

    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]?.max_administration_days).toBe(14);
    expect(parsed.records[1]?.max_administration_days).toBeNull();
  });

  it('uses the JST business date for the inclusive day 0 through day 365 rule', async () => {
    vi.useFakeTimers();
    // 2026-07-15 00:30 JST is still 2026-07-14 in UTC.
    vi.setSystemTime(new Date('2026-07-14T15:30:00.000Z'));
    try {
      const listedDate = (daysFromToday: number) => {
        const date = new Date('2026-07-15T00:00:00.000Z');
        date.setUTCDate(date.getUTCDate() + daysFromToday);
        return formatDate(date);
      };
      const csv = [1, 0, -365, -366]
        .map((offset, index) =>
          buildRow({
            2: `61041220${index}`,
            31: `1149034F103${index}`,
            34: `BOUNDARY-${offset}`,
            35: listedDate(offset),
          }),
        )
        .join('\r\n');

      const parsed = await parseSskDrugMasterZip({
        zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      });

      expect(parsed.records.map((record) => record.max_administration_days)).toEqual([
        null,
        14,
        14,
        null,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects ZIP entries that exceed the configured expansion byte limit', async () => {
    const csv = buildRow({
      2: '123456789',
      4: 'DRUG-A',
      31: '123456789012',
      34: 'DRUG-A',
    });
    const zipped = buildSskZip(csv);

    await expect(
      parseSskDrugMasterZip({
        zipUrl: 'https://www.ssk.or.jp/y_ALL_test.zip',
        zipLimits: {
          maxEntries: 5,
          maxEntryBytes: 16,
          maxTotalBytes: 32,
        },
        fetchImpl: async () =>
          new Response(toZipBlob(zipped), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
      }),
    ).rejects.toThrow(/ZIP展開サイズが上限/);
  });

  it('records the source ZIP url and hash in the import log', async () => {
    const csv = buildRow({
      2: '123456789',
      4: 'DRUG-A',
      31: '123456789012',
      34: 'DRUG-A',
    });
    const zipped = buildSskZip(csv);
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'completed' }),
      },
      drugMaster: {
        upsert: vi.fn().mockResolvedValue({ id: 'drug_1' }),
      },
    };

    const result = await importSskDrugMaster(
      db as unknown as Parameters<typeof importSskDrugMaster>[0],
      {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260611.zip',
        fetchImpl: async () =>
          new Response(toZipBlob(zipped), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
      },
    );

    expect(result.importedCount).toBe(1);
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        source_url: 'https://www.ssk.or.jp/y_ALL20260611.zip',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_published_at: new Date(Date.UTC(2026, 5, 11)),
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 1,
          imported_records: 1,
          entry_name: 'y_ALL_test.csv',
        },
      }),
    });
  });

  it('imports valid SSK rows as partial while persisting only bounded quarantine counters', async () => {
    const csv = [
      buildRow({ 2: '610412196', 31: '1149034F1026', 34: 'VALID-DRUG', 33: '20270331' }),
      buildRow({
        2: '610412197',
        31: '1149034F1027',
        34: 'SECRET-DRUG',
        33: '20270230',
      }),
    ].join('\r\n');
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'completed' }),
      },
      drugMaster: { upsert: vi.fn().mockResolvedValue({ id: 'drug_1' }) },
    };

    const result = await importSskDrugMaster(
      db as unknown as Parameters<typeof importSskDrugMaster>[0],
      {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260715.zip',
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      },
    );

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
    expect(JSON.stringify(completedUpdate)).not.toMatch(/SECRET-DRUG|20270230|1149034F1027/);
  });

  it('fails before DrugMaster writes when every candidate date is quarantined', async () => {
    const csv = buildRow({
      2: '610412197',
      31: '1149034F1027',
      34: 'SECRET-DRUG',
      35: '20260230',
    });
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'failed' }),
      },
      drugMaster: { upsert: vi.fn() },
    };

    await expect(
      importSskDrugMaster(db as unknown as Parameters<typeof importSskDrugMaster>[0], {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260715.zip',
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      }),
    ).rejects.toThrow('DRUG_MASTER_DATE_ALL_ROWS_QUARANTINED');
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(db.drugMasterImportLog.update.mock.calls)).not.toMatch(
      /SECRET-DRUG|20260230|1149034F1027/,
    );
  });

  it('fails a matched-invalid source date before DrugMaster writes', async () => {
    const csv = buildRow({ 2: '610412196', 31: '1149034F1026', 34: 'VALID-DRUG' });
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'failed' }),
      },
      drugMaster: { upsert: vi.fn() },
    };

    await expect(
      importSskDrugMaster(db as unknown as Parameters<typeof importSskDrugMaster>[0], {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260230.zip',
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      }),
    ).rejects.toThrow('DRUG_MASTER_SOURCE_DATE_INVALID');
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
  });

  it('persists a safe failure message when SSK import upsert fails', async () => {
    const csv = buildRow({
      2: '123456789',
      4: 'DRUG-A',
      31: '123456789012',
      34: 'DRUG-A',
    });
    const upsertError = new Error('upsert failed patient=患者A token=secret yj_code=123456789012');
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'failed' }),
      },
      drugMaster: {
        upsert: vi.fn().mockRejectedValue(upsertError),
      },
    };

    await expect(
      importSskDrugMaster(db as unknown as Parameters<typeof importSskDrugMaster>[0], {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260611.zip',
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      }),
    ).rejects.toBe(upsertError);

    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: {
        status: 'failed',
        error_log: 'SSK取込に失敗しました',
      },
    });
    const failedUpdate = JSON.stringify(db.drugMasterImportLog.update.mock.calls.at(-1)?.[0]);
    expect(failedUpdate).not.toContain('患者A');
    expect(failedUpdate).not.toContain('secret');
    expect(failedUpdate).not.toContain('123456789012');
  });

  it('previews create/update/unchanged SSK rows without writing import logs or upserts', async () => {
    const csv = [
      buildRow({
        2: '111111111',
        31: '111111111111',
        34: 'UPDATED-DRUG',
      }),
      buildRow({
        2: '222222222',
        31: '222222222222',
        34: 'UNCHANGED-DRUG',
      }),
      buildRow({
        2: '333333333',
        31: '333333333333',
        34: 'NEW-DRUG',
      }),
    ].join('\r\n');
    const db = {
      drugMasterImportLog: {
        create: vi.fn(),
        update: vi.fn(),
      },
      drugMaster: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            yj_code: '111111111111',
            receipt_code: '111111111',
            drug_name: 'OLD-DRUG',
            drug_name_kana: null,
            generic_name: null,
            drug_price: null,
            unit: null,
            dosage_form: null,
            therapeutic_category: '1111',
            manufacturer: null,
            is_generic: false,
            is_narcotic: false,
            is_psychotropic: false,
            max_administration_days: null,
            transitional_expiry_date: null,
          },
          {
            yj_code: '222222222222',
            receipt_code: '222222222',
            drug_name: 'UNCHANGED-DRUG',
            drug_name_kana: null,
            generic_name: null,
            drug_price: null,
            unit: null,
            dosage_form: null,
            therapeutic_category: '2222',
            manufacturer: null,
            is_generic: false,
            is_narcotic: false,
            is_psychotropic: false,
            max_administration_days: null,
            transitional_expiry_date: null,
          },
        ]),
      },
    };

    const result = await previewSskDrugMasterImport(
      db as unknown as Parameters<typeof previewSskDrugMasterImport>[0],
      {
        zipUrl: 'https://www.ssk.or.jp/y_ALL20260611.zip',
        previewLimit: 10,
        fetchImpl: buildZipFetch(buildSskZip(csv)),
      },
    );

    expect(result).toMatchObject({
      dryRun: true,
      entryName: 'y_ALL_test.csv',
      zipUrl: 'https://www.ssk.or.jp/y_ALL20260611.zip',
      sourcePublishedAt: '2026-06-11T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 3,
          create_count: 1,
          update_count: 1,
          unchanged_count: 1,
          sampled_rows: 2,
        },
        rows: [
          {
            yj_code: '111111111111',
            drug_name: 'UPDATED-DRUG',
            action: 'update',
            changed_fields: ['drug_name'],
          },
          {
            yj_code: '333333333333',
            drug_name: 'NEW-DRUG',
            action: 'create',
          },
        ],
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.drugMaster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { yj_code: { in: ['111111111111', '222222222222', '333333333333'] } },
      }),
    );
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.drugMaster.upsert).not.toHaveBeenCalled();
  });
});
