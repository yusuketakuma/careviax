import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
  type DrugIdentityResolution,
  type DrugIdentityResolutionMaster,
  type ResolvedDrugIdentity,
} from '@/lib/pharmacy/drug-identity-resolution';

type BackfillMode = 'dry-run';

export type PrescriptionLineDrugMasterBackfillOptions = {
  mode: BackfillMode;
  maxRows: number;
  sampleLimit: number;
  orgId: string | null;
  jsonOutputPath: string | null;
  markdownOutputPath: string | null;
};

type PgClientLike = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
};

export type PrescriptionLineDrugIdentityBackfillRow = {
  id: string;
  orgId: string;
  patientId: string | null;
  cycleId: string | null;
  intakeId: string;
  lineNumber: number;
  drugName: string;
  drugCode: string | null;
  drugMasterId: string | null;
  sourceDrugCode: string | null;
  sourceDrugCodeType: string | null;
  drugResolutionStatus: string | null;
};

export type DrugMasterBackfillRow = DrugIdentityResolutionMaster;

export type PrescriptionLineDrugMasterBackfillClassification =
  | 'already_resolved'
  | 'backfillable'
  | 'missing_code'
  | 'code_not_found'
  | 'ambiguous_code'
  | 'conflict';

export type PrescriptionLineDrugMasterBackfillFinding = {
  classification: PrescriptionLineDrugMasterBackfillClassification;
  reason: string;
  lineId: string;
  orgId: string;
  patientId: string | null;
  cycleId: string | null;
  intakeId: string;
  lineNumber: number;
  drugName: string;
  drugCode: string | null;
  sourceDrugCode: string | null;
  sourceDrugCodeType: string | null;
  existingDrugMasterId: string | null;
  resolvedDrugMasterId: string | null;
  resolvedDrugCode: string | null;
  matchedCode: string | null;
  matchedCodeSystem: string | null;
  candidateCount: number | null;
  wouldUpdate: boolean;
};

export type PrescriptionLineDrugMasterBackfillCounts = Record<
  PrescriptionLineDrugMasterBackfillClassification,
  number
> & {
  scannedRows: number;
};

export type PrescriptionLineDrugMasterBackfillResult = {
  ok: boolean;
  mode: BackfillMode;
  dryRun: true;
  applyReady: boolean;
  generatedAt: string;
  resolverVersion: 'drug-identity-resolution-v1';
  scannedRows: number;
  maxRows: number;
  orgId: string | null;
  truncated: boolean;
  counts: PrescriptionLineDrugMasterBackfillCounts;
  blockingIssues: string[];
  samples: Record<
    PrescriptionLineDrugMasterBackfillClassification,
    PrescriptionLineDrugMasterBackfillFinding[]
  >;
};

const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const USAGE = [
  'Usage: pnpm db:prescription-line-drug-master:backfill [--dry-run] [--max-rows N] [--sample-limit N] [--org-id ORG] [--json-output PATH] [--markdown-output PATH]',
  'Default mode is --dry-run. This helper is intentionally read-only; --apply is not implemented.',
].join('\n');

function readValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | null, name: string, fallback: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parsePrescriptionLineDrugMasterBackfillArgs(
  argv: string[],
): PrescriptionLineDrugMasterBackfillOptions {
  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }
  if (argv.includes('--apply')) {
    throw new Error('Apply mode is not implemented for PrescriptionLine drug_master_id backfill');
  }

  return {
    mode: 'dry-run',
    maxRows: parsePositiveInt(readValue(argv, '--max-rows'), '--max-rows', DEFAULT_MAX_ROWS),
    sampleLimit: parsePositiveInt(
      readValue(argv, '--sample-limit'),
      '--sample-limit',
      DEFAULT_SAMPLE_LIMIT,
    ),
    orgId: readValue(argv, '--org-id'),
    jsonOutputPath: readValue(argv, '--json-output'),
    markdownOutputPath: readValue(argv, '--markdown-output'),
  };
}

function normalizeRowCode(value: string | null | undefined) {
  return normalizeMedicationCode(value) ?? null;
}

function resolvedFinding(
  line: PrescriptionLineDrugIdentityBackfillRow,
  classification: PrescriptionLineDrugMasterBackfillClassification,
  reason: string,
  resolution: ResolvedDrugIdentity | null,
  candidateCount: number | null = null,
): PrescriptionLineDrugMasterBackfillFinding {
  return {
    classification,
    reason,
    lineId: line.id,
    orgId: line.orgId,
    patientId: line.patientId,
    cycleId: line.cycleId,
    intakeId: line.intakeId,
    lineNumber: line.lineNumber,
    drugName: line.drugName,
    drugCode: normalizeRowCode(line.drugCode),
    sourceDrugCode: normalizeRowCode(line.sourceDrugCode),
    sourceDrugCodeType: line.sourceDrugCodeType,
    existingDrugMasterId: line.drugMasterId,
    resolvedDrugMasterId: resolution?.drug.id ?? null,
    resolvedDrugCode: resolution?.canonicalDrugCode ?? null,
    matchedCode: resolution?.sourceCode ?? null,
    matchedCodeSystem: resolution?.sourceCodeSystem ?? null,
    candidateCount,
    wouldUpdate: classification === 'backfillable',
  };
}

function selectLineResolution(
  line: PrescriptionLineDrugIdentityBackfillRow,
  resolutions: Map<string, DrugIdentityResolution>,
) {
  const sourceCode = normalizeRowCode(line.sourceDrugCode);
  const drugCode = normalizeRowCode(line.drugCode);
  const primaryCode = sourceCode ?? drugCode;
  if (!primaryCode) return resolveMedicationCode(null, resolutions);
  return resolveMedicationCode(primaryCode, resolutions);
}

export function classifyPrescriptionLineDrugMasterBackfillRows(
  lines: PrescriptionLineDrugIdentityBackfillRow[],
  drugMasters: DrugMasterBackfillRow[],
) {
  const resolutions = buildDrugIdentityResolutionByCode(drugMasters);
  const masterById = new Map(drugMasters.map((master) => [master.id, master]));

  return lines.map((line): PrescriptionLineDrugMasterBackfillFinding => {
    const sourceCode = normalizeRowCode(line.sourceDrugCode);
    const drugCode = normalizeRowCode(line.drugCode);
    const primaryResolution = selectLineResolution(line, resolutions);
    const drugCodeResolution = drugCode ? resolveMedicationCode(drugCode, resolutions) : null;
    const existingMaster = line.drugMasterId ? masterById.get(line.drugMasterId) : null;

    if (line.drugMasterId) {
      if (!existingMaster) {
        return resolvedFinding(line, 'conflict', 'existing_drug_master_id_not_found', null);
      }

      const canonicalCode = normalizeRowCode(existingMaster.yj_code);
      if (drugCode && canonicalCode && drugCode !== canonicalCode) {
        return resolvedFinding(line, 'conflict', 'drug_code_conflicts_with_existing_master', {
          status: 'resolved',
          sourceCode: canonicalCode,
          sourceCodeSystem: 'yj',
          canonicalDrugCode: canonicalCode,
          drug: { id: existingMaster.id, yj_code: canonicalCode },
        });
      }

      if (
        primaryResolution.status === 'resolved' &&
        primaryResolution.drug.id !== line.drugMasterId
      ) {
        return resolvedFinding(
          line,
          'conflict',
          'source_code_resolves_to_different_drug_master',
          primaryResolution,
        );
      }
      if (primaryResolution.status === 'ambiguous_code') {
        return resolvedFinding(
          line,
          'conflict',
          'source_code_is_ambiguous_for_existing_master',
          null,
          primaryResolution.candidateCount,
        );
      }

      return resolvedFinding(line, 'already_resolved', 'drug_master_id_already_matches_identity', {
        status: 'resolved',
        sourceCode: canonicalCode ?? '',
        sourceCodeSystem: 'yj',
        canonicalDrugCode: canonicalCode ?? '',
        drug: { id: existingMaster.id, yj_code: canonicalCode ?? '' },
      });
    }

    if (primaryResolution.status === 'missing_code') {
      return resolvedFinding(line, 'missing_code', 'no_drug_code_or_source_drug_code', null);
    }

    if (primaryResolution.status === 'ambiguous_code') {
      return resolvedFinding(
        line,
        'ambiguous_code',
        'source_code_matches_multiple_drug_masters',
        null,
        primaryResolution.candidateCount,
      );
    }

    if (primaryResolution.status === 'code_not_found') {
      if (
        sourceCode &&
        drugCode &&
        sourceCode !== drugCode &&
        drugCodeResolution?.status === 'resolved'
      ) {
        return resolvedFinding(
          line,
          'conflict',
          'source_code_not_found_but_drug_code_resolves',
          drugCodeResolution,
        );
      }
      return resolvedFinding(line, 'code_not_found', 'source_code_not_found_in_drug_master', null);
    }

    if (sourceCode && drugCode && sourceCode !== drugCode) {
      if (
        drugCodeResolution?.status === 'resolved' &&
        drugCodeResolution.drug.id !== primaryResolution.drug.id
      ) {
        return resolvedFinding(
          line,
          'conflict',
          'source_code_and_drug_code_resolve_to_different_masters',
          primaryResolution,
        );
      }
      if (drugCodeResolution?.status === 'ambiguous_code') {
        return resolvedFinding(
          line,
          'conflict',
          'drug_code_is_ambiguous_while_source_code_resolves',
          primaryResolution,
          drugCodeResolution.candidateCount,
        );
      }
    }

    return resolvedFinding(
      line,
      'backfillable',
      'resolved_drug_master_candidate',
      primaryResolution,
    );
  });
}

export function summarizePrescriptionLineDrugMasterBackfillFindings(
  findings: PrescriptionLineDrugMasterBackfillFinding[],
  options: PrescriptionLineDrugMasterBackfillOptions,
): PrescriptionLineDrugMasterBackfillResult {
  const counts: PrescriptionLineDrugMasterBackfillCounts = {
    scannedRows: findings.length,
    already_resolved: 0,
    backfillable: 0,
    missing_code: 0,
    code_not_found: 0,
    ambiguous_code: 0,
    conflict: 0,
  };
  const samples: PrescriptionLineDrugMasterBackfillResult['samples'] = {
    already_resolved: [],
    backfillable: [],
    missing_code: [],
    code_not_found: [],
    ambiguous_code: [],
    conflict: [],
  };

  for (const finding of findings) {
    counts[finding.classification] += 1;
    const bucket = samples[finding.classification];
    if (bucket.length < options.sampleLimit) bucket.push(finding);
  }

  const blockingIssues = [
    counts.conflict > 0 ? `${counts.conflict} prescription lines have identity conflicts` : null,
    counts.ambiguous_code > 0
      ? `${counts.ambiguous_code} prescription lines resolve to ambiguous DrugMaster candidates`
      : null,
    counts.code_not_found > 0
      ? `${counts.code_not_found} prescription lines have codes not found in DrugMaster`
      : null,
    counts.missing_code > 0
      ? `${counts.missing_code} prescription lines have no source_drug_code or drug_code`
      : null,
  ].filter((issue): issue is string => issue !== null);

  return {
    ok: blockingIssues.length === 0,
    mode: options.mode,
    dryRun: true,
    applyReady: blockingIssues.length === 0,
    generatedAt: new Date().toISOString(),
    resolverVersion: 'drug-identity-resolution-v1',
    scannedRows: findings.length,
    maxRows: options.maxRows,
    orgId: options.orgId,
    truncated: findings.length >= options.maxRows,
    counts,
    blockingIssues,
    samples,
  };
}

function markdownTableCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

const BACKFILL_CLASSIFICATION_ORDER: PrescriptionLineDrugMasterBackfillClassification[] = [
  'backfillable',
  'conflict',
  'ambiguous_code',
  'code_not_found',
  'missing_code',
  'already_resolved',
];

export function renderPrescriptionLineDrugMasterBackfillMarkdown(
  result: PrescriptionLineDrugMasterBackfillResult,
) {
  const lines: string[] = [
    '# PrescriptionLine DrugMaster Backfill Dry-Run Review',
    '',
    '## Summary',
    '',
    `- generated_at: ${result.generatedAt}`,
    `- resolver_version: ${result.resolverVersion}`,
    `- org_id: ${result.orgId ?? 'all'}`,
    `- scanned_rows: ${result.scannedRows}`,
    `- max_rows: ${result.maxRows}`,
    `- truncated: ${result.truncated ? 'yes' : 'no'}`,
    `- ok: ${result.ok ? 'yes' : 'no'}`,
    `- apply_ready: ${result.applyReady ? 'yes' : 'no'}`,
    '',
    'Apply mode is intentionally disabled. Use this report to review safe candidates and blockers before any separately approved migration or manual correction.',
    '',
    '## Counts',
    '',
    '| classification | count |',
    '| --- | ---: |',
  ];

  for (const classification of BACKFILL_CLASSIFICATION_ORDER) {
    lines.push(`| ${classification} | ${result.counts[classification]} |`);
  }
  lines.push(`| scannedRows | ${result.counts.scannedRows} |`, '');

  lines.push('## Blocking Issues', '');
  if (result.blockingIssues.length === 0) {
    lines.push('- None', '');
  } else {
    for (const issue of result.blockingIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  lines.push('## Samples', '');
  for (const classification of BACKFILL_CLASSIFICATION_ORDER) {
    const samples = result.samples[classification];
    if (samples.length === 0) continue;
    lines.push(`### ${classification}`, '');
    lines.push(
      '| line_id | org_id | patient_id | intake_id | line | drug_name | source_code | drug_code | existing_master | resolved_master | resolved_yj | reason | would_update |',
    );
    lines.push('| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const sample of samples) {
      lines.push(
        [
          sample.lineId,
          sample.orgId,
          sample.patientId,
          sample.intakeId,
          sample.lineNumber,
          sample.drugName,
          sample.sourceDrugCode,
          sample.drugCode,
          sample.existingDrugMasterId,
          sample.resolvedDrugMasterId,
          sample.resolvedDrugCode,
          sample.reason,
          sample.wouldUpdate ? 'yes' : 'no',
        ]
          .map(markdownTableCell)
          .join(' | ')
          .replace(/^/, '| ')
          .replace(/$/, ' |'),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeTextArtifact(filePath: string, content: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writePrescriptionLineDrugMasterBackfillArtifacts(
  result: PrescriptionLineDrugMasterBackfillResult,
  options: PrescriptionLineDrugMasterBackfillOptions,
) {
  if (options.jsonOutputPath) {
    await writeTextArtifact(options.jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.markdownOutputPath) {
    await writeTextArtifact(
      options.markdownOutputPath,
      renderPrescriptionLineDrugMasterBackfillMarkdown(result),
    );
  }
}

async function readPrescriptionLineCandidates(
  client: PgClientLike,
  options: PrescriptionLineDrugMasterBackfillOptions,
) {
  const values: unknown[] = [];
  const filters = [
    `(
      line."drug_master_id" IS NULL
      OR line."drug_resolution_status" IS DISTINCT FROM 'resolved'
      OR line."source_drug_code" IS NOT NULL
      OR line."drug_code" IS NOT NULL
    )`,
  ];
  if (options.orgId) {
    values.push(options.orgId);
    filters.push(`line."org_id" = $${values.length}`);
  }
  values.push(options.maxRows);

  const result = await client.query<PrescriptionLineDrugIdentityBackfillRow>(
    `
      SELECT
        line."id",
        line."org_id" AS "orgId",
        cycle."patient_id" AS "patientId",
        intake."cycle_id" AS "cycleId",
        line."intake_id" AS "intakeId",
        line."line_number" AS "lineNumber",
        line."drug_name" AS "drugName",
        line."drug_code" AS "drugCode",
        line."drug_master_id" AS "drugMasterId",
        line."source_drug_code" AS "sourceDrugCode",
        line."source_drug_code_type" AS "sourceDrugCodeType",
        line."drug_resolution_status" AS "drugResolutionStatus"
      FROM "PrescriptionLine" line
      INNER JOIN "PrescriptionIntake" intake
        ON intake."id" = line."intake_id"
      LEFT JOIN "MedicationCycle" cycle
        ON cycle."id" = intake."cycle_id"
      WHERE ${filters.join(' AND ')}
      ORDER BY line."org_id", line."intake_id", line."line_number", line."id"
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows;
}

async function readDrugMastersForLines(
  client: PgClientLike,
  lines: PrescriptionLineDrugIdentityBackfillRow[],
) {
  const masterIds = Array.from(
    new Set(lines.map((line) => line.drugMasterId).filter((id): id is string => Boolean(id))),
  );
  const codes = Array.from(
    new Set(
      lines
        .flatMap((line) => [line.sourceDrugCode, line.drugCode])
        .map(normalizeRowCode)
        .filter((code): code is string => Boolean(code)),
    ),
  );

  const result = await client.query<DrugMasterBackfillRow>(
    `
      SELECT
        "id",
        "yj_code",
        "receipt_code",
        "hot_code",
        "jan_code"
      FROM "DrugMaster"
      WHERE "id" = ANY($1::text[])
         OR "yj_code" = ANY($2::text[])
         OR "receipt_code" = ANY($2::text[])
         OR "hot_code" = ANY($2::text[])
      ORDER BY "yj_code", "id"
    `,
    [masterIds, codes],
  );
  return result.rows;
}

export async function runPrescriptionLineDrugMasterBackfill(
  client: PgClientLike,
  options: PrescriptionLineDrugMasterBackfillOptions,
) {
  const lines = await readPrescriptionLineCandidates(client, options);
  const drugMasters = await readDrugMastersForLines(client, lines);
  const findings = classifyPrescriptionLineDrugMasterBackfillRows(lines, drugMasters);
  return summarizePrescriptionLineDrugMasterBackfillFindings(findings, options);
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parsePrescriptionLineDrugMasterBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const result = await runPrescriptionLineDrugMasterBackfill(client, options);
    await writePrescriptionLineDrugMasterBackfillArtifacts(result, options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : inspect(error, { depth: 2 }),
      }),
    );
    process.exit(1);
  });
}
