import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { importPmdaPackageInserts, parsePmdaPackageInsertArchive } from './pmda';

function toZipBlob(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <header>
    <drug_code>123456789012</drug_code>
    <drug_name>サンプル錠５ｍｇ</drug_name>
    <revision_date>2026/03/01</revision_date>
    <version>1.0</version>
  </header>
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
    <revision_date>2026/03/01</revision_date>
    <version>1.0</version>
  </header>
  <section>
    <title>禁忌</title>
    <item>重篤な肝障害の患者</item>
  </section>
</document>`;

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
    expect(parsed.records[0]).toMatchObject({
      yj_code: '123456789012',
      drug_name: 'サンプル錠５ｍｇ',
      document_version: '1.0',
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
      data: {
        status: 'completed',
        record_count: 0,
      },
    });
  });
});
