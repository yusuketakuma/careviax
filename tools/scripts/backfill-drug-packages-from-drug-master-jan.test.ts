import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  classifyDrugPackageJanBackfillRows,
  parseDrugPackageJanBackfillArgs,
  renderDrugPackageJanBackfillMarkdown,
  runDrugPackageJanBackfill,
  summarizeDrugPackageJanBackfillFindings,
  type DrugMasterJanBackfillRow,
  type DrugPackageBackfillRow,
} from './backfill-drug-packages-from-drug-master-jan';

type BackfillClient = Parameters<typeof runDrugPackageJanBackfill>[0];

function master(overrides: Partial<DrugMasterJanBackfillRow>): DrugMasterJanBackfillRow {
  return {
    drugMasterId: overrides.drugMasterId ?? 'drug_master_1',
    yjCode: overrides.yjCode ?? 'YJ001',
    janCode: overrides.janCode ?? '4900000000000',
    drugName: overrides.drugName ?? 'テスト薬',
    manufacturer: overrides.manufacturer ?? 'テスト製薬',
  };
}

function drugPackage(overrides: Partial<DrugPackageBackfillRow>): DrugPackageBackfillRow {
  return {
    id: overrides.id ?? 'pkg_1',
    drugMasterId: overrides.drugMasterId ?? 'drug_master_1',
    gtin: overrides.gtin ?? '04900000000000',
    janCode: overrides.janCode ?? '4900000000000',
    isActive: overrides.isActive ?? true,
  };
}

describe('backfill-drug-packages-from-drug-master-jan', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to bounded dry-run and rejects apply mode', () => {
    expect(parseDrugPackageJanBackfillArgs([])).toEqual({
      mode: 'dry-run',
      maxRows: 10000,
      sampleLimit: 20,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });
    expect(
      parseDrugPackageJanBackfillArgs([
        '--dry-run',
        '--max-rows',
        '50',
        '--sample-limit',
        '4',
        '--json-output',
        'tmp/package.json',
        '--markdown-output',
        'tmp/package.md',
      ]),
    ).toEqual({
      mode: 'dry-run',
      maxRows: 50,
      sampleLimit: 4,
      jsonOutputPath: 'tmp/package.json',
      markdownOutputPath: 'tmp/package.md',
    });
    expect(() => parseDrugPackageJanBackfillArgs(['--apply'])).toThrow(
      /Apply mode is not implemented/,
    );
    expect(() => parseDrugPackageJanBackfillArgs(['--sample-limit', '0'])).toThrow(
      /positive integer/,
    );
    expect(() => parseDrugPackageJanBackfillArgs(['--max-row', '50'])).toThrow(
      /Unknown option: --max-row/,
    );
  });

  it('classifies legacy JAN rows for safe package backfill review', () => {
    const findings = classifyDrugPackageJanBackfillRows(
      [
        master({ drugMasterId: 'backfillable', yjCode: 'YJ001', janCode: '4900000000000' }),
        master({ drugMasterId: 'present', yjCode: 'YJ002', janCode: '4900000000001' }),
        master({ drugMasterId: 'dup_a', yjCode: 'YJ003', janCode: '4900000000002' }),
        master({ drugMasterId: 'dup_b', yjCode: 'YJ004', janCode: '4900000000002' }),
        master({ drugMasterId: 'invalid', yjCode: 'YJ005', janCode: 'JAN001' }),
        master({ drugMasterId: 'conflict', yjCode: 'YJ006', janCode: '4900000000003' }),
      ],
      [
        drugPackage({
          id: 'pkg_present',
          drugMasterId: 'present',
          gtin: '04900000000001',
          janCode: '4900000000001',
        }),
        drugPackage({
          id: 'pkg_conflict',
          drugMasterId: 'other_master',
          gtin: '04900000000003',
          janCode: '4900000000003',
        }),
      ],
    );

    expect(findings).toEqual([
      expect.objectContaining({
        classification: 'backfillable',
        drugMasterId: 'backfillable',
        normalizedJanCode: '4900000000000',
        proposedGtin: '04900000000000',
        wouldInsert: true,
      }),
      expect.objectContaining({
        classification: 'already_present',
        drugMasterId: 'present',
        existingPackageIds: ['pkg_present'],
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'duplicate_jan',
        drugMasterId: 'dup_a',
        existingPackageDrugMasterIds: expect.arrayContaining(['dup_a', 'dup_b']),
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'duplicate_jan',
        drugMasterId: 'dup_b',
        existingPackageDrugMasterIds: expect.arrayContaining(['dup_a', 'dup_b']),
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'invalid_jan',
        drugMasterId: 'invalid',
        proposedGtin: null,
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'package_conflict',
        drugMasterId: 'conflict',
        existingPackageIds: ['pkg_conflict'],
        existingPackageDrugMasterIds: ['other_master'],
        wouldInsert: false,
      }),
    ]);
  });

  it('treats 14-digit GTIN values as package codes without forcing JAN normalization', () => {
    const findings = classifyDrugPackageJanBackfillRows(
      [
        master({ drugMasterId: 'gtin14_backfillable', yjCode: 'YJ101', janCode: '14900000000000' }),
        master({ drugMasterId: 'gtin14_present', yjCode: 'YJ102', janCode: '14900000000001' }),
        master({ drugMasterId: 'gtin14_dup_a', yjCode: 'YJ103', janCode: '14900000000002' }),
        master({ drugMasterId: 'gtin14_dup_b', yjCode: 'YJ104', janCode: '14900000000002' }),
      ],
      [
        drugPackage({
          id: 'pkg_gtin14_present',
          drugMasterId: 'gtin14_present',
          gtin: '14900000000001',
          janCode: null,
        }),
      ],
    );

    expect(findings).toEqual([
      expect.objectContaining({
        classification: 'backfillable',
        drugMasterId: 'gtin14_backfillable',
        normalizedJanCode: null,
        proposedGtin: '14900000000000',
        wouldInsert: true,
      }),
      expect.objectContaining({
        classification: 'already_present',
        drugMasterId: 'gtin14_present',
        normalizedJanCode: null,
        proposedGtin: '14900000000001',
        existingPackageIds: ['pkg_gtin14_present'],
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'duplicate_jan',
        drugMasterId: 'gtin14_dup_a',
        normalizedJanCode: null,
        proposedGtin: '14900000000002',
        existingPackageDrugMasterIds: expect.arrayContaining(['gtin14_dup_a', 'gtin14_dup_b']),
        wouldInsert: false,
      }),
      expect.objectContaining({
        classification: 'duplicate_jan',
        drugMasterId: 'gtin14_dup_b',
        normalizedJanCode: null,
        proposedGtin: '14900000000002',
        existingPackageDrugMasterIds: expect.arrayContaining(['gtin14_dup_a', 'gtin14_dup_b']),
        wouldInsert: false,
      }),
    ]);
  });

  it('renders a reviewable markdown report without enabling apply mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T02:50:00.000Z'));
    const findings = classifyDrugPackageJanBackfillRows(
      [master({ drugName: '薬剤|A' }), master({ drugMasterId: 'bad', janCode: 'bad-code' })],
      [],
    );
    const summary = summarizeDrugPackageJanBackfillFindings(findings, {
      mode: 'dry-run',
      maxRows: 10,
      sampleLimit: 2,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    const markdown = renderDrugPackageJanBackfillMarkdown(summary);

    expect(markdown).toContain('# DrugPackage JAN Backfill Dry-Run Review');
    expect(markdown).toContain('Apply mode is intentionally disabled');
    expect(markdown).toContain('| backfillable | 1 |');
    expect(markdown).toContain('| invalid_jan | 1 |');
    expect(markdown).toContain('薬剤\\|A');
    expect(markdown).toContain('04900000000000');
  });

  it('runs dry-run without issuing DrugPackage mutation queries', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client: BackfillClient = {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes('FROM "DrugMaster"')) {
          return {
            rows: [
              master({ drugMasterId: 'drug_master_1', janCode: '4900000000000' }) as unknown as T,
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM "DrugPackage"')) {
          return { rows: [] as T[], rowCount: 0 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const summary = await runDrugPackageJanBackfill(client, {
      mode: 'dry-run',
      maxRows: 5,
      sampleLimit: 2,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(summary.counts.backfillable).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.sql).join('\n')).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b/i,
    );
  });

  it('uses a maxRows plus one probe so exact-size scans are not marked truncated', async () => {
    const createClient = (drugMasterRows: DrugMasterJanBackfillRow[]) => {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const client: BackfillClient = {
        query: async <T extends QueryResultRow = QueryResultRow>(
          sql: string,
          values?: unknown[],
        ) => {
          queries.push({ sql, values });
          if (sql.includes('FROM "DrugMaster"')) {
            return { rows: drugMasterRows as unknown as T[], rowCount: drugMasterRows.length };
          }
          if (sql.includes('FROM "DrugPackage"')) {
            return { rows: [] as T[], rowCount: 0 };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      return { client, queries };
    };

    const exact = createClient([
      master({ drugMasterId: 'drug_master_1', janCode: '4900000000000' }),
      master({ drugMasterId: 'drug_master_2', janCode: '4900000000001' }),
    ]);
    const exactSummary = await runDrugPackageJanBackfill(exact.client, {
      mode: 'dry-run',
      maxRows: 2,
      sampleLimit: 2,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(exactSummary.scannedRows).toBe(2);
    expect(exactSummary.truncated).toBe(false);
    expect(exact.queries[0]?.values).toEqual([3]);

    const truncated = createClient([
      master({ drugMasterId: 'drug_master_1', janCode: '4900000000000' }),
      master({ drugMasterId: 'drug_master_2', janCode: '4900000000001' }),
      master({ drugMasterId: 'drug_master_3', janCode: '4900000000002' }),
    ]);
    const truncatedSummary = await runDrugPackageJanBackfill(truncated.client, {
      mode: 'dry-run',
      maxRows: 2,
      sampleLimit: 2,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(truncatedSummary.scannedRows).toBe(2);
    expect(truncatedSummary.truncated).toBe(true);
    expect(truncated.queries[0]?.values).toEqual([3]);
    expect(truncated.queries[1]?.values).toEqual([
      ['4900000000000', '04900000000000', '4900000000001', '04900000000001'],
    ]);
  });
});
