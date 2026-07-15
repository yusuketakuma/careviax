import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  importPmdaPackageInserts,
  parsePmdaPackageInsertArchive,
  previewPmdaPackageInserts,
} from './pmda';

function toZipBlob(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <header>
    <drug_code>123456789012</drug_code>
    <drug_name>サンプル錠５ｍｇ</drug_name>
  </header>
  <DateOfPreparationOrRevision>
    <PreparationOrRevision id="今回">
      <YearMonth>2026-03-01</YearMonth>
      <Version>1.0</Version>
    </PreparationOrRevision>
    <PreparationOrRevision id="前回">
      <YearMonth>2025-12</YearMonth>
      <Version>0.9</Version>
    </PreparationOrRevision>
  </DateOfPreparationOrRevision>
  <section>
    <title>禁忌</title>
    <item>重篤な肝障害の患者</item>
  </section>
  <section>
    <title>併用禁忌</title>
    <interaction>
      <drug_name>ワルファリン</drug_name>
      <drug_code>987654321098</drug_code>
      <mechanism>代謝阻害</mechanism>
      <effect>出血リスク増大</effect>
    </interaction>
  </section>
  <section>
    <title>併用注意</title>
    <interaction>
      <drug_name>アスピリン</drug_name>
      <mechanism>相加作用</mechanism>
      <effect>出血傾向増強</effect>
    </interaction>
  </section>
  <section>
    <title>重大な副作用</title>
    <item>ショック、アナフィラキシー</item>
  </section>
  <section>
    <title>用法及び用量</title>
    <item>通常、成人には1日1回経口投与する。</item>
  </section>
</document>`;

const nameOnlyPrimaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <header>
    <drug_name>サンプル錠５ｍｇ</drug_name>
  </header>
  <DateOfPreparationOrRevision>
    <PreparationOrRevision id="今回">
      <YearMonth>2026-03-01</YearMonth>
      <Version>1.0</Version>
    </PreparationOrRevision>
  </DateOfPreparationOrRevision>
  <section>
    <title>禁忌</title>
    <item>重篤な肝障害の患者</item>
  </section>
</document>`;

const secondPrimaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <header>
    <drug_code>111111111111</drug_code>
    <drug_name>アスピリン錠１００ｍｇ</drug_name>
  </header>
  <DateOfPreparationOrRevision>
    <PreparationOrRevision id="今回">
      <YearMonth>2026-04-01</YearMonth>
      <Version>2.0</Version>
    </PreparationOrRevision>
  </DateOfPreparationOrRevision>
  <section>
    <title>禁忌</title>
    <item>出血傾向のある患者</item>
  </section>
</document>`;

const invalidRevisionXml = secondPrimaryXml.replace(
  '<YearMonth>2026-04-01</YearMonth>',
  '<YearMonth>2026-02-30</YearMonth>',
);

const monthPrecisionRevisionXml = secondPrimaryXml.replace(
  '<YearMonth>2026-04-01</YearMonth>',
  '<YearMonth id="current-month">2026-04</YearMonth>',
);

const invalidMonthRevisionXml = secondPrimaryXml.replace(
  '<YearMonth>2026-04-01</YearMonth>',
  '<YearMonth>2026-13</YearMonth>',
);

describe('parsePmdaPackageInsertArchive', () => {
  it('parses XML ZIP payloads into structured sections', async () => {
    const zipped = zipSync({
      'sample.xml': Buffer.from(sampleXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.records[0]).toMatchObject({
      yj_code: '123456789012',
      drug_name: 'サンプル錠５ｍｇ',
      document_version: '1.0',
      revision_date_precision: 'exact',
      revision_month_key: '2026-03',
      revised_at: new Date('2026-03-01T00:00:00.000Z'),
      contraindications: expect.arrayContaining(['重篤な肝障害の患者']),
      adverse_effects: expect.arrayContaining(['ショック、アナフィラキシー']),
    });
    expect(parsed.records[0]?.interaction_candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'contraindicated',
          counterpart_yj_codes: ['987654321098'],
          mechanism: '代謝阻害',
        }),
      ]),
    );
  });

  it('recognizes the official current YearMonth at month precision without inventing a day', async () => {
    const zipped = zipSync({
      'month.xml': Buffer.from(monthPrecisionRevisionXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      revision_date_precision: 'month',
      revision_month_key: '2026-04',
      revised_at: null,
    });
    expect(parsed.recognizedMonthPrecisionCount).toBe(1);
    expect(parsed.dateQuarantine.quarantinedDateRecords).toBe(0);
  });

  it('selects the current revision version when the previous entry appears first', async () => {
    const previousFirstXml = sampleXml.replace(
      `    <PreparationOrRevision id="今回">
      <YearMonth>2026-03-01</YearMonth>
      <Version>1.0</Version>
    </PreparationOrRevision>
    <PreparationOrRevision id="前回">
      <YearMonth>2025-12</YearMonth>
      <Version>0.9</Version>
    </PreparationOrRevision>`,
      `    <PreparationOrRevision id="前回">
      <YearMonth>2025-12</YearMonth>
      <Version>9.9</Version>
    </PreparationOrRevision>
    <PreparationOrRevision id="今回">
      <YearMonth>2026-03-01</YearMonth>
      <Version>2.0</Version>
    </PreparationOrRevision>`,
    );
    const zipped = zipSync({
      'previous-first.xml': Buffer.from(previousFirstXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records[0]).toMatchObject({
      document_version: '2.0',
      revision_date_precision: 'exact',
      revised_at: new Date('2026-03-01T00:00:00.000Z'),
    });
  });

  it('does not project the previous revision version when the current version is missing', async () => {
    const missingCurrentVersionXml = sampleXml.replace('<Version>1.0</Version>', '');
    const zipped = zipSync({
      'missing-version.xml': Buffer.from(missingCurrentVersionXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records[0]?.document_version).toBeNull();
  });

  it('quarantines an official current YearMonth with an invalid month', async () => {
    const zipped = zipSync({
      'valid.xml': Buffer.from(sampleXml, 'utf8'),
      'invalid-month.xml': Buffer.from(invalidMonthRevisionXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.dateQuarantine).toEqual({
      quarantinedDateRecords: 1,
      invalidFormatCount: 0,
      invalidCalendarDateCount: 1,
      invalidEraBoundaryCount: 0,
    });
  });

  it('keeps an empty official current YearMonth as missing', async () => {
    const emptyRevisionXml = secondPrimaryXml.replace(
      '<YearMonth>2026-04-01</YearMonth>',
      '<YearMonth></YearMonth>',
    );
    const zipped = zipSync({
      'empty.xml': Buffer.from(emptyRevisionXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records[0]).toMatchObject({
      revision_date_precision: 'missing',
      revision_month_key: null,
      revised_at: null,
    });
    expect(parsed.recognizedMonthPrecisionCount).toBe(0);
    expect(parsed.dateQuarantine.quarantinedDateRecords).toBe(0);
  });

  it('rejects ZIP archives that exceed the configured entry count limit', async () => {
    const zipped = zipSync({
      'sample-a.xml': Buffer.from(sampleXml, 'utf8'),
      'sample-b.xml': Buffer.from(sampleXml, 'utf8'),
    });

    await expect(
      parsePmdaPackageInsertArchive({
        zipUrl: 'https://www.pmda.go.jp/pmda.zip',
        zipLimits: {
          maxEntries: 1,
          maxEntryBytes: 1024 * 1024,
          maxTotalBytes: 2 * 1024 * 1024,
        },
        fetchImpl: async () =>
          new Response(toZipBlob(zipped), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
      }),
    ).rejects.toThrow(/エントリ数が上限/);
  });

  it('quarantines an entire XML record with a rollover revision date', async () => {
    const zipped = zipSync({
      'valid.xml': Buffer.from(sampleXml, 'utf8'),
      'secret-invalid.xml': Buffer.from(invalidRevisionXml, 'utf8'),
    });

    const parsed = await parsePmdaPackageInsertArchive({
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.candidateRecordCount).toBe(2);
    expect(parsed.dateQuarantine).toEqual({
      quarantinedDateRecords: 1,
      invalidFormatCount: 0,
      invalidCalendarDateCount: 1,
      invalidEraBoundaryCount: 0,
    });
    expect(JSON.stringify(parsed.dateQuarantine)).not.toMatch(/2026\/02\/30|secret|111111111111/);
  });

  it('fails a matched-invalid archive date before fetching the source', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      parsePmdaPackageInsertArchive({
        zipUrl: 'https://www.pmda.go.jp/package-20260230.zip',
        fetchImpl,
      }),
    ).rejects.toThrow('DRUG_MASTER_SOURCE_DATE_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('importPmdaPackageInserts', () => {
  const db = {
    drugMasterImportLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    drugMaster: {
      findMany: vi.fn(),
    },
    drugPackageInsert: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    drugInteraction: {
      upsert: vi.fn(),
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    db.drugMasterImportLog.create.mockResolvedValue({ id: 'log_1', status: 'running' });
    db.drugMasterImportLog.update.mockResolvedValue({ id: 'log_1', status: 'completed' });
    db.drugMaster.findMany.mockResolvedValue([
      {
        id: 'drug_primary',
        yj_code: '123456789012',
        drug_name: 'サンプル錠５ｍｇ',
        generic_name: 'サンプル',
      },
      {
        id: 'drug_warfarin',
        yj_code: '987654321098',
        drug_name: 'ワルファリン',
        generic_name: 'ワルファリン',
      },
      {
        id: 'drug_aspirin',
        yj_code: '111111111111',
        drug_name: 'アスピリン',
        generic_name: 'アスピリン',
      },
    ]);
    db.drugPackageInsert.findMany.mockResolvedValue([]);
    db.drugPackageInsert.findFirst.mockResolvedValue(null);
    db.drugPackageInsert.create.mockResolvedValue({ id: 'package_1' });
    db.drugPackageInsert.update.mockResolvedValue({ id: 'package_1' });
    db.drugInteraction.upsert.mockResolvedValue({ id: 'interaction_1' });
  });

  it('stores package insert payloads and expands interaction pairs', async () => {
    const zipped = zipSync({
      'sample.xml': Buffer.from(sampleXml, 'utf8'),
    });

    const result = await importPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugPackageInsert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        drug_master_id: 'drug_primary',
        contraindications: expect.arrayContaining(['重篤な肝障害の患者']),
        source_format: 'xml',
      }),
    });
    expect(db.drugInteraction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          drug_a_id_drug_b_id_source: {
            drug_a_id: 'drug_primary',
            drug_b_id: 'drug_warfarin',
            source: 'pmda_xml',
          },
        },
        create: expect.objectContaining({
          source: 'pmda_xml',
          severity: 'contraindicated',
        }),
      }),
    );
    expect(db.drugInteraction.upsert).toHaveBeenCalledTimes(1);
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        change_summary: {
          mode: 'full',
          parsed_records: 1,
          imported_records: 1,
          skipped_unmatched_primary_records: 0,
          create_count: 1,
          update_count: 0,
          unchanged_count: 0,
          matched_interaction_pair_count: 1,
        },
      }),
    });
  });

  it('imports valid package inserts as partial without writing quarantined interactions', async () => {
    const zipped = zipSync({
      'valid.xml': Buffer.from(sampleXml, 'utf8'),
      'secret-invalid.xml': Buffer.from(invalidRevisionXml, 'utf8'),
    });

    const result = await importPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda_20260715.zip',
      mode: 'delta',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugPackageInsert.create).toHaveBeenCalledOnce();
    expect(db.drugInteraction.upsert).toHaveBeenCalledOnce();
    const completedUpdate = db.drugMasterImportLog.update.mock.calls.at(-1)?.[0];
    expect(completedUpdate).toEqual({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        import_mode: 'partial',
        change_summary: expect.objectContaining({
          mode: 'partial',
          requested_mode: 'delta',
          parsed_records: 1,
          imported_records: 1,
          quarantined_date_records: 1,
          quarantine_invalid_format_count: 0,
          quarantine_invalid_calendar_date_count: 1,
          quarantine_invalid_era_boundary_count: 0,
        }),
      }),
    });
    expect(JSON.stringify(completedUpdate)).not.toMatch(/secret-invalid|2026\/02\/30|111111111111/);
  });

  it('fails before package, interaction, or lookup writes when every date is quarantined', async () => {
    const zipped = zipSync({
      'secret-invalid.xml': Buffer.from(invalidRevisionXml, 'utf8'),
    });

    await expect(
      importPmdaPackageInserts(db, {
        zipUrl: 'https://www.pmda.go.jp/pmda_20260715.zip',
        fetchImpl: async () =>
          new Response(toZipBlob(zipped), {
            status: 200,
            headers: { 'content-type': 'application/zip' },
          }),
      }),
    ).rejects.toThrow('DRUG_MASTER_DATE_ALL_ROWS_QUARANTINED');
    expect(db.drugMaster.findMany).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugInteraction.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(db.drugMasterImportLog.update.mock.calls)).not.toMatch(
      /secret-invalid|2026\/02\/30|111111111111/,
    );
  });

  it('does not update an unchanged package insert during import', async () => {
    const zipped = zipSync({
      'second.xml': Buffer.from(secondPrimaryXml, 'utf8'),
    });
    db.drugPackageInsert.findFirst.mockResolvedValueOnce({
      id: 'package_existing',
      contraindications: ['禁忌', '出血傾向のある患者'],
      interactions: {
        contraindicated: [],
        caution: [],
      },
      adverse_effects: [],
      document_version: '2.0',
      revised_at: new Date('2026-04-01T00:00:00.000Z'),
      source_format: 'xml',
    });

    const result = await importPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugPackageInsert.findFirst).toHaveBeenCalledWith({
      where: { drug_master_id: 'drug_aspirin' },
      orderBy: [{ revised_at: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        contraindications: true,
        interactions: true,
        adverse_effects: true,
        document_version: true,
        revised_at: true,
        source_format: true,
      },
    });
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugInteraction.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 1,
        change_summary: {
          mode: 'full',
          parsed_records: 1,
          imported_records: 1,
          skipped_unmatched_primary_records: 0,
          create_count: 0,
          update_count: 0,
          unchanged_count: 1,
          matched_interaction_pair_count: 0,
        },
      }),
    });
  });

  it('preserves an existing exact revised_at when the current source has month precision', async () => {
    const zipped = zipSync({
      'month.xml': Buffer.from(monthPrecisionRevisionXml, 'utf8'),
    });
    db.drugPackageInsert.findFirst.mockResolvedValueOnce({
      id: 'package_existing',
      contraindications: ['older-content'],
      interactions: {
        contraindicated: [],
        caution: [],
      },
      adverse_effects: [],
      document_version: '1.0',
      revised_at: new Date('2026-04-15T00:00:00.000Z'),
      source_format: 'xml',
    });

    const result = await importPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(result.importedCount).toBe(1);
    expect(db.drugPackageInsert.update).toHaveBeenCalledOnce();
    const updateData = db.drugPackageInsert.update.mock.calls[0]?.[0].data;
    expect(updateData).not.toHaveProperty('revised_at');
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        change_summary: expect.objectContaining({
          recognized_month_precision: 1,
          update_count: 1,
        }),
      }),
    });
  });

  it('skips name-only primary package inserts instead of selecting DrugMaster by fuzzy name', async () => {
    const zipped = zipSync({
      'name-only.xml': Buffer.from(nameOnlyPrimaryXml, 'utf8'),
    });

    const result = await importPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
    });

    expect(result.importedCount).toBe(0);
    expect(db.drugPackageInsert.findFirst).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugInteraction.upsert).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: expect.objectContaining({
        status: 'completed',
        record_count: 0,
        source_url: 'https://www.pmda.go.jp/pmda.zip',
        source_file_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        source_published_at: null,
        import_mode: 'full',
        change_summary: {
          mode: 'full',
          parsed_records: 1,
          imported_records: 0,
          skipped_unmatched_primary_records: 1,
          create_count: 0,
          update_count: 0,
          unchanged_count: 0,
          matched_interaction_pair_count: 0,
        },
      }),
    });
  });

  it('previews unchanged package inserts without reporting a write', async () => {
    const zipped = zipSync({
      'second.xml': Buffer.from(secondPrimaryXml, 'utf8'),
    });
    db.drugPackageInsert.findMany.mockResolvedValue([
      {
        id: 'package_existing',
        drug_master_id: 'drug_aspirin',
        contraindications: ['禁忌', '出血傾向のある患者'],
        interactions: {
          contraindicated: [],
          caution: [],
        },
        adverse_effects: [],
        document_version: '2.0',
        revised_at: new Date('2026-04-01T00:00:00.000Z'),
        source_format: 'xml',
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    const result = await previewPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
      previewLimit: 10,
    });

    expect(result.preview.summary).toEqual({
      parsed_records: 1,
      matched_primary_records: 1,
      skipped_unmatched_primary_records: 0,
      create_count: 0,
      update_count: 0,
      unchanged_count: 1,
      matched_interaction_pair_count: 0,
      sampled_rows: 0,
    });
    expect(result.preview.rows).toEqual([]);
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.findFirst).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugInteraction.upsert).not.toHaveBeenCalled();
  });

  it('exposes bounded quarantine counters without previewing invalid PMDA content', async () => {
    const zipped = zipSync({
      'valid.xml': Buffer.from(sampleXml, 'utf8'),
      'secret-invalid.xml': Buffer.from(invalidRevisionXml, 'utf8'),
    });

    const result = await previewPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda_20260715.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
      previewLimit: 10,
    });

    expect(result.preview.summary).toMatchObject({
      parsed_records: 1,
      quarantined_date_records: 1,
      quarantine_invalid_format_count: 0,
      quarantine_invalid_calendar_date_count: 1,
      quarantine_invalid_era_boundary_count: 0,
    });
    expect(result.preview.rows).toHaveLength(1);
    expect(JSON.stringify(result.preview)).not.toMatch(/secret-invalid|2026\/02\/30|111111111111/);
  });

  it('previews package insert changes without writing import logs or upserting rows', async () => {
    const zipped = zipSync({
      'sample.xml': Buffer.from(sampleXml, 'utf8'),
      'second.xml': Buffer.from(secondPrimaryXml, 'utf8'),
      'name-only.xml': Buffer.from(nameOnlyPrimaryXml, 'utf8'),
    });
    db.drugPackageInsert.findMany.mockResolvedValue([
      {
        id: 'package_existing',
        drug_master_id: 'drug_primary',
        contraindications: ['旧禁忌'],
        interactions: {
          contraindicated: [],
          caution: [],
        },
        adverse_effects: [],
        document_version: '0.9',
        revised_at: new Date('2026-02-01T00:00:00.000Z'),
        source_format: 'xml',
        created_at: new Date('2026-02-01T00:00:00.000Z'),
      },
    ]);

    const result = await previewPmdaPackageInserts(db, {
      zipUrl: 'https://www.pmda.go.jp/pmda_20260612.zip',
      fetchImpl: async () =>
        new Response(toZipBlob(zipped), {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }),
      previewLimit: 10,
      mode: 'delta',
    });

    expect(result).toMatchObject({
      dryRun: true,
      zipUrl: 'https://www.pmda.go.jp/pmda_20260612.zip',
      mode: 'delta',
      sourcePublishedAt: '2026-06-12T00:00:00.000Z',
      preview: {
        summary: {
          parsed_records: 3,
          matched_primary_records: 2,
          skipped_unmatched_primary_records: 1,
          create_count: 1,
          update_count: 1,
          unchanged_count: 0,
          matched_interaction_pair_count: 1,
          sampled_rows: 3,
        },
      },
    });
    expect(result.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          yj_code: '123456789012',
          drug_master_id: 'drug_primary',
          action: 'update',
          changed_fields: expect.arrayContaining(['contraindications', 'document_version']),
          matched_interaction_pair_count: 1,
        }),
        expect.objectContaining({
          yj_code: '111111111111',
          drug_master_id: 'drug_aspirin',
          action: 'create',
        }),
        expect.objectContaining({
          yj_code: null,
          drug_master_id: null,
          action: 'skip_unmatched_primary',
        }),
      ]),
    );
    expect(db.drugPackageInsert.findMany).toHaveBeenCalledWith({
      where: { drug_master_id: { in: ['drug_primary', 'drug_aspirin'] } },
      orderBy: [{ drug_master_id: 'asc' }, { revised_at: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        drug_master_id: true,
        contraindications: true,
        interactions: true,
        adverse_effects: true,
        document_version: true,
        revised_at: true,
        source_format: true,
        created_at: true,
      },
    });
    expect(db.drugMasterImportLog.create).not.toHaveBeenCalled();
    expect(db.drugMasterImportLog.update).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.findFirst).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.create).not.toHaveBeenCalled();
    expect(db.drugPackageInsert.update).not.toHaveBeenCalled();
    expect(db.drugInteraction.upsert).not.toHaveBeenCalled();
  });
});
