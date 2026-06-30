import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyPrescriptionLineDrugMasterBackfillRows,
  parsePrescriptionLineDrugMasterBackfillArgs,
  runPrescriptionLineDrugMasterBackfill,
  renderPrescriptionLineDrugMasterBackfillMarkdown,
  summarizePrescriptionLineDrugMasterBackfillFindings,
  type DrugMasterBackfillRow,
  type PrescriptionLineDrugIdentityBackfillRow,
} from './backfill-prescription-line-drug-master-ids';

function line(
  overrides: Partial<PrescriptionLineDrugIdentityBackfillRow>,
): PrescriptionLineDrugIdentityBackfillRow {
  return {
    id: overrides.id ?? 'line_1',
    orgId: overrides.orgId ?? 'org_1',
    patientId: overrides.patientId ?? 'patient_1',
    cycleId: overrides.cycleId ?? 'cycle_1',
    intakeId: overrides.intakeId ?? 'intake_1',
    lineNumber: overrides.lineNumber ?? 1,
    drugName: overrides.drugName ?? 'アムロジピン錠',
    drugCode: overrides.drugCode ?? null,
    drugMasterId: overrides.drugMasterId ?? null,
    sourceDrugCode: overrides.sourceDrugCode ?? null,
    sourceDrugCodeType: overrides.sourceDrugCodeType ?? null,
    drugResolutionStatus: overrides.drugResolutionStatus ?? null,
  };
}

const masters: DrugMasterBackfillRow[] = [
  {
    id: 'drug_yj',
    yj_code: 'YJ001',
    receipt_code: 'RC001',
    hot_code: 'HOT001',
    jan_code: 'JAN001',
  },
  {
    id: 'drug_hot',
    yj_code: 'YJ002',
    receipt_code: 'RC002',
    hot_code: 'HOT002',
    jan_code: null,
  },
  {
    id: 'drug_dup_a',
    yj_code: 'YJ003',
    receipt_code: 'RC_DUP',
    hot_code: null,
    jan_code: null,
  },
  {
    id: 'drug_dup_b',
    yj_code: 'YJ004',
    receipt_code: 'RC_DUP',
    hot_code: null,
    jan_code: null,
  },
];

describe('backfill-prescription-line-drug-master-ids', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to bounded dry-run and rejects apply mode', () => {
    expect(parsePrescriptionLineDrugMasterBackfillArgs([])).toEqual({
      mode: 'dry-run',
      maxRows: 5000,
      sampleLimit: 20,
      orgId: null,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });
    expect(
      parsePrescriptionLineDrugMasterBackfillArgs([
        '--dry-run',
        '--max-rows',
        '25',
        '--sample-limit',
        '3',
        '--org-id',
        'org_1',
        '--json-output',
        'tmp/backfill.json',
        '--markdown-output',
        'tmp/backfill.md',
      ]),
    ).toEqual({
      mode: 'dry-run',
      maxRows: 25,
      sampleLimit: 3,
      orgId: 'org_1',
      jsonOutputPath: 'tmp/backfill.json',
      markdownOutputPath: 'tmp/backfill.md',
    });
    expect(() => parsePrescriptionLineDrugMasterBackfillArgs(['--apply'])).toThrow(
      /Apply mode is not implemented/,
    );
    expect(() => parsePrescriptionLineDrugMasterBackfillArgs(['--max-rows', '0'])).toThrow(
      /positive integer/,
    );
  });

  it('classifies safe YJ, receipt, and HOT candidates without using JAN', () => {
    const findings = classifyPrescriptionLineDrugMasterBackfillRows(
      [
        line({ id: 'line_yj', drugCode: 'YJ001' }),
        line({
          id: 'line_receipt',
          sourceDrugCode: 'RC001',
          sourceDrugCodeType: 'receipt',
          drugCode: 'YJ001',
        }),
        line({ id: 'line_hot', sourceDrugCode: 'HOT002', sourceDrugCodeType: 'hot' }),
        line({ id: 'line_jan', sourceDrugCode: 'JAN001', sourceDrugCodeType: 'jan' }),
      ],
      masters,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        classification: 'backfillable',
        lineId: 'line_yj',
        resolvedDrugMasterId: 'drug_yj',
        resolvedDrugCode: 'YJ001',
        matchedCodeSystem: 'yj',
        wouldUpdate: true,
      }),
      expect.objectContaining({
        classification: 'backfillable',
        lineId: 'line_receipt',
        resolvedDrugMasterId: 'drug_yj',
        resolvedDrugCode: 'YJ001',
        matchedCode: 'RC001',
        matchedCodeSystem: 'receipt',
        wouldUpdate: true,
      }),
      expect.objectContaining({
        classification: 'backfillable',
        lineId: 'line_hot',
        resolvedDrugMasterId: 'drug_hot',
        resolvedDrugCode: 'YJ002',
        matchedCodeSystem: 'hot',
        wouldUpdate: true,
      }),
      expect.objectContaining({
        classification: 'code_not_found',
        lineId: 'line_jan',
        resolvedDrugMasterId: null,
        wouldUpdate: false,
      }),
    ]);
  });

  it('classifies ambiguous, missing, unknown, and conflict rows as non-updateable', () => {
    const findings = classifyPrescriptionLineDrugMasterBackfillRows(
      [
        line({ id: 'line_ambiguous', sourceDrugCode: 'RC_DUP', sourceDrugCodeType: 'receipt' }),
        line({ id: 'line_missing' }),
        line({ id: 'line_unknown', drugCode: 'YJ_UNKNOWN' }),
        line({
          id: 'line_existing_conflict',
          drugMasterId: 'drug_yj',
          drugCode: 'YJ002',
        }),
        line({
          id: 'line_source_conflict',
          sourceDrugCode: 'RC001',
          sourceDrugCodeType: 'receipt',
          drugCode: 'YJ002',
        }),
      ],
      masters,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        classification: 'ambiguous_code',
        lineId: 'line_ambiguous',
        candidateCount: 2,
        wouldUpdate: false,
      }),
      expect.objectContaining({
        classification: 'missing_code',
        lineId: 'line_missing',
        wouldUpdate: false,
      }),
      expect.objectContaining({
        classification: 'code_not_found',
        lineId: 'line_unknown',
        wouldUpdate: false,
      }),
      expect.objectContaining({
        classification: 'conflict',
        lineId: 'line_existing_conflict',
        reason: 'drug_code_conflicts_with_existing_master',
        wouldUpdate: false,
      }),
      expect.objectContaining({
        classification: 'conflict',
        lineId: 'line_source_conflict',
        reason: 'source_code_and_drug_code_resolve_to_different_masters',
        wouldUpdate: false,
      }),
    ]);
  });

  it('summarizes dry-run output with bounded samples and no mutation contract', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T09:15:00.000Z'));
    const findings = classifyPrescriptionLineDrugMasterBackfillRows(
      [
        line({ id: 'line_yj', drugCode: 'YJ001' }),
        line({ id: 'line_unknown', drugCode: 'YJ_UNKNOWN' }),
        line({ id: 'line_missing' }),
      ],
      masters,
    );

    const summary = summarizePrescriptionLineDrugMasterBackfillFindings(findings, {
      mode: 'dry-run',
      maxRows: 10,
      sampleLimit: 1,
      orgId: 'org_1',
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(summary).toMatchObject({
      ok: false,
      mode: 'dry-run',
      dryRun: true,
      applyReady: false,
      generatedAt: '2026-06-29T09:15:00.000Z',
      resolverVersion: 'drug-identity-resolution-v1',
      orgId: 'org_1',
      counts: {
        scannedRows: 3,
        backfillable: 1,
        code_not_found: 1,
        missing_code: 1,
      },
      blockingIssues: [
        '1 prescription lines have codes not found in DrugMaster',
        '1 prescription lines have no source_drug_code or drug_code',
      ],
    });
    expect(summary.samples.backfillable).toHaveLength(1);
    expect(summary.samples.code_not_found).toHaveLength(1);
    expect(summary.samples.missing_code).toHaveLength(1);
  });

  it('renders a reviewable markdown report without enabling apply mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T09:15:00.000Z'));
    const findings = classifyPrescriptionLineDrugMasterBackfillRows(
      [
        line({ id: 'line_yj', drugName: '薬剤|A', drugCode: 'YJ001' }),
        line({ id: 'line_unknown', drugCode: 'YJ_UNKNOWN' }),
      ],
      masters,
    );
    const summary = summarizePrescriptionLineDrugMasterBackfillFindings(findings, {
      mode: 'dry-run',
      maxRows: 10,
      sampleLimit: 2,
      orgId: null,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    const markdown = renderPrescriptionLineDrugMasterBackfillMarkdown(summary);

    expect(markdown).toContain('# PrescriptionLine DrugMaster Backfill Dry-Run Review');
    expect(markdown).toContain('Apply mode is intentionally disabled');
    expect(markdown).toContain('| backfillable | 1 |');
    expect(markdown).toContain('| code_not_found | 1 |');
    expect(markdown).toContain('- 1 prescription lines have codes not found in DrugMaster');
    expect(markdown).toContain('薬剤\\|A');
    expect(markdown).toContain('| line_yj | org_1 | patient_1 | intake_1 | 1 |');
  });

  it('runs dry-run without issuing PrescriptionLine mutation queries', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('FROM "PrescriptionLine"')) {
          return {
            rows: [
              line({
                id: 'line_yj',
                drugCode: 'YJ001',
                orgId: 'org_1',
              }),
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM "DrugMaster"')) {
          return { rows: masters, rowCount: masters.length };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await runPrescriptionLineDrugMasterBackfill(
      client as unknown as Parameters<typeof runPrescriptionLineDrugMasterBackfill>[0],
      {
        mode: 'dry-run',
        maxRows: 2,
        sampleLimit: 5,
        orgId: 'org_1',
        jsonOutputPath: null,
        markdownOutputPath: null,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      counts: {
        scannedRows: 1,
        backfillable: 1,
      },
    });
    expect(queries.some((query) => /UPDATE|DELETE|INSERT|UPSERT/i.test(query.sql))).toBe(false);
    expect(queries[0].sql).toContain('line."org_id" = $1');
    expect(queries[0].sql).toContain('LIMIT $2');
    expect(queries[0].values).toEqual(['org_1', 2]);
  });
});
