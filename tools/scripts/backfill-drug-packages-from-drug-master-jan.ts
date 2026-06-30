import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';
import {
  buildPackageCodeCandidates,
  normalizePackageCodeIdentity,
} from '@/lib/pharmacy/package-code';

type BackfillMode = 'dry-run';

export type DrugPackageJanBackfillOptions = {
  mode: BackfillMode;
  maxRows: number;
  sampleLimit: number;
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

export type DrugMasterJanBackfillRow = {
  drugMasterId: string;
  yjCode: string;
  janCode: string | null;
  drugName: string;
  manufacturer: string | null;
};

export type DrugPackageBackfillRow = {
  id: string;
  drugMasterId: string;
  gtin: string;
  janCode: string | null;
  isActive: boolean;
};

export type DrugPackageJanBackfillClassification =
  | 'backfillable'
  | 'already_present'
  | 'duplicate_jan'
  | 'invalid_jan'
  | 'package_conflict';

export type DrugPackageJanBackfillFinding = {
  classification: DrugPackageJanBackfillClassification;
  reason: string;
  drugMasterId: string;
  yjCode: string;
  drugName: string;
  manufacturer: string | null;
  sourceJanCode: string | null;
  normalizedJanCode: string | null;
  proposedGtin: string | null;
  existingPackageIds: string[];
  existingPackageDrugMasterIds: string[];
  wouldInsert: boolean;
};

export type DrugPackageJanBackfillCounts = Record<DrugPackageJanBackfillClassification, number> & {
  scannedRows: number;
};

export type DrugPackageJanBackfillResult = {
  ok: boolean;
  mode: BackfillMode;
  dryRun: true;
  applyReady: boolean;
  generatedAt: string;
  scannedRows: number;
  maxRows: number;
  truncated: boolean;
  counts: DrugPackageJanBackfillCounts;
  blockingIssues: string[];
  samples: Record<DrugPackageJanBackfillClassification, DrugPackageJanBackfillFinding[]>;
};

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const USAGE = [
  'Usage: pnpm db:drug-packages:backfill-from-drug-master-jan [--dry-run] [--max-rows N] [--sample-limit N] [--json-output PATH] [--markdown-output PATH]',
  'Default mode is --dry-run. This helper is intentionally read-only; --apply is not implemented.',
].join('\n');

const BACKFILL_CLASSIFICATION_ORDER: DrugPackageJanBackfillClassification[] = [
  'backfillable',
  'already_present',
  'duplicate_jan',
  'invalid_jan',
  'package_conflict',
];

const FLAGS_WITH_VALUES = new Set([
  '--max-rows',
  '--sample-limit',
  '--json-output',
  '--markdown-output',
]);
const KNOWN_FLAGS = new Set(['--dry-run', '--help', '--apply', ...FLAGS_WITH_VALUES]);

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

export function parseDrugPackageJanBackfillArgs(argv: string[]): DrugPackageJanBackfillOptions {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (FLAGS_WITH_VALUES.has(arg)) index += 1;
  }

  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }
  if (argv.includes('--apply')) {
    throw new Error('Apply mode is not implemented for DrugPackage JAN backfill');
  }

  return {
    mode: 'dry-run',
    maxRows: parsePositiveInt(readValue(argv, '--max-rows'), '--max-rows', DEFAULT_MAX_ROWS),
    sampleLimit: parsePositiveInt(
      readValue(argv, '--sample-limit'),
      '--sample-limit',
      DEFAULT_SAMPLE_LIMIT,
    ),
    jsonOutputPath: readValue(argv, '--json-output'),
    markdownOutputPath: readValue(argv, '--markdown-output'),
  };
}

function findingBase(row: DrugMasterJanBackfillRow) {
  const proposed = normalizePackageCodeIdentity(row.janCode);
  return {
    drugMasterId: row.drugMasterId,
    yjCode: row.yjCode,
    drugName: row.drugName,
    manufacturer: row.manufacturer,
    sourceJanCode: row.janCode,
    normalizedJanCode: proposed.janCode,
    proposedGtin: proposed.gtin,
  };
}

export function classifyDrugPackageJanBackfillRows(
  drugMasters: DrugMasterJanBackfillRow[],
  drugPackages: DrugPackageBackfillRow[],
) {
  const masterIdsByJan = new Map<string, Set<string>>();
  for (const row of drugMasters) {
    const proposed = normalizePackageCodeIdentity(row.janCode);
    const duplicateKey = proposed.janCode ?? proposed.gtin;
    if (!proposed.valid || !duplicateKey) continue;
    const ids = masterIdsByJan.get(duplicateKey) ?? new Set<string>();
    ids.add(row.drugMasterId);
    masterIdsByJan.set(duplicateKey, ids);
  }

  const packagesByCode = new Map<string, DrugPackageBackfillRow[]>();
  for (const row of drugPackages) {
    for (const code of buildPackageCodeCandidates(row.gtin).concat(
      buildPackageCodeCandidates(row.janCode),
    )) {
      const rows = packagesByCode.get(code) ?? [];
      rows.push(row);
      packagesByCode.set(code, rows);
    }
  }

  return drugMasters.map((row): DrugPackageJanBackfillFinding => {
    const proposed = normalizePackageCodeIdentity(row.janCode);
    const base = findingBase(row);
    if (!proposed.valid || !proposed.gtin) {
      return {
        ...base,
        classification: 'invalid_jan',
        reason: 'DrugMaster.jan_code is not 8, 13, or 14 digits',
        existingPackageIds: [],
        existingPackageDrugMasterIds: [],
        wouldInsert: false,
      };
    }

    const duplicateMasterIds = masterIdsByJan.get(proposed.janCode ?? proposed.gtin);
    if (duplicateMasterIds && duplicateMasterIds.size > 1) {
      return {
        ...base,
        classification: 'duplicate_jan',
        reason: 'Multiple DrugMaster rows share the same JAN/GTIN code',
        existingPackageIds: [],
        existingPackageDrugMasterIds: [...duplicateMasterIds],
        wouldInsert: false,
      };
    }

    const packageMatches = [
      ...((proposed.janCode ? packagesByCode.get(proposed.janCode) : []) ?? []),
      ...(packagesByCode.get(proposed.gtin) ?? []),
    ];
    const uniquePackages = Array.from(
      new Map(packageMatches.map((match) => [match.id, match])).values(),
    );
    const packageIds = uniquePackages.map((match) => match.id);
    const packageDrugMasterIds = [...new Set(uniquePackages.map((match) => match.drugMasterId))];

    if (packageDrugMasterIds.length === 0) {
      return {
        ...base,
        classification: 'backfillable',
        reason: 'No existing DrugPackage row matches this JAN/GTIN',
        existingPackageIds: [],
        existingPackageDrugMasterIds: [],
        wouldInsert: true,
      };
    }

    if (packageDrugMasterIds.length === 1 && packageDrugMasterIds[0] === row.drugMasterId) {
      return {
        ...base,
        classification: 'already_present',
        reason: 'Matching DrugPackage already points to the same DrugMaster',
        existingPackageIds: packageIds,
        existingPackageDrugMasterIds: packageDrugMasterIds,
        wouldInsert: false,
      };
    }

    return {
      ...base,
      classification: 'package_conflict',
      reason: 'Existing DrugPackage row for this JAN/GTIN points to a different DrugMaster',
      existingPackageIds: packageIds,
      existingPackageDrugMasterIds: packageDrugMasterIds,
      wouldInsert: false,
    };
  });
}

export function summarizeDrugPackageJanBackfillFindings(
  findings: DrugPackageJanBackfillFinding[],
  options: DrugPackageJanBackfillOptions,
  truncated = findings.length > options.maxRows,
): DrugPackageJanBackfillResult {
  const counts = Object.fromEntries(
    BACKFILL_CLASSIFICATION_ORDER.map((classification) => [classification, 0]),
  ) as DrugPackageJanBackfillCounts;
  counts.scannedRows = findings.length;

  const samples = Object.fromEntries(
    BACKFILL_CLASSIFICATION_ORDER.map((classification) => [
      classification,
      [] as DrugPackageJanBackfillFinding[],
    ]),
  ) as DrugPackageJanBackfillResult['samples'];

  for (const finding of findings) {
    counts[finding.classification] += 1;
    if (samples[finding.classification].length < options.sampleLimit) {
      samples[finding.classification].push(finding);
    }
  }

  const blockingIssues: string[] = [];
  if (counts.duplicate_jan > 0) {
    blockingIssues.push(`${counts.duplicate_jan} DrugMaster rows share duplicate JAN/GTIN codes`);
  }
  if (counts.invalid_jan > 0) {
    blockingIssues.push(`${counts.invalid_jan} DrugMaster rows have invalid JAN/GTIN values`);
  }
  if (counts.package_conflict > 0) {
    blockingIssues.push(
      `${counts.package_conflict} DrugMaster rows conflict with existing DrugPackage rows`,
    );
  }

  return {
    ok: blockingIssues.length === 0,
    mode: options.mode,
    dryRun: true,
    applyReady: blockingIssues.length === 0 && counts.backfillable > 0,
    generatedAt: new Date().toISOString(),
    scannedRows: findings.length,
    maxRows: options.maxRows,
    truncated,
    counts,
    blockingIssues,
    samples,
  };
}

function markdownTableCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderDrugPackageJanBackfillMarkdown(result: DrugPackageJanBackfillResult) {
  const lines: string[] = [
    '# DrugPackage JAN Backfill Dry-Run Review',
    '',
    '## Summary',
    '',
    `- generated_at: ${result.generatedAt}`,
    `- scanned_rows: ${result.scannedRows}`,
    `- max_rows: ${result.maxRows}`,
    `- truncated: ${result.truncated ? 'yes' : 'no'}`,
    `- ok: ${result.ok ? 'yes' : 'no'}`,
    `- apply_ready: ${result.applyReady ? 'yes' : 'no'}`,
    '',
    'Apply mode is intentionally disabled. Use this report to review legacy DrugMaster.jan_code rows before any separately approved DrugPackage backfill.',
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
    for (const issue of result.blockingIssues) lines.push(`- ${issue}`);
    lines.push('');
  }

  lines.push('## Samples', '');
  for (const classification of BACKFILL_CLASSIFICATION_ORDER) {
    const samples = result.samples[classification];
    if (samples.length === 0) continue;
    lines.push(`### ${classification}`, '');
    lines.push(
      '| drug_master_id | yj_code | drug_name | source_jan | normalized_jan | proposed_gtin | existing_package_ids | existing_package_master_ids | would_insert | reason |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const sample of samples) {
      lines.push(
        [
          sample.drugMasterId,
          sample.yjCode,
          sample.drugName,
          sample.sourceJanCode,
          sample.normalizedJanCode,
          sample.proposedGtin,
          sample.existingPackageIds.join(','),
          sample.existingPackageDrugMasterIds.join(','),
          sample.wouldInsert ? 'yes' : 'no',
          sample.reason,
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

async function writeDrugPackageJanBackfillArtifacts(
  result: DrugPackageJanBackfillResult,
  options: DrugPackageJanBackfillOptions,
) {
  if (options.jsonOutputPath) {
    await writeTextArtifact(options.jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.markdownOutputPath) {
    await writeTextArtifact(
      options.markdownOutputPath,
      renderDrugPackageJanBackfillMarkdown(result),
    );
  }
}

async function readDrugMastersWithJan(
  client: PgClientLike,
  options: DrugPackageJanBackfillOptions,
) {
  const result = await client.query<DrugMasterJanBackfillRow>(
    `
      SELECT
        "id" AS "drugMasterId",
        "yj_code" AS "yjCode",
        "jan_code" AS "janCode",
        "drug_name" AS "drugName",
        "manufacturer"
      FROM "DrugMaster"
      WHERE "jan_code" IS NOT NULL
        AND btrim("jan_code") <> ''
      ORDER BY "jan_code", "yj_code", "id"
      LIMIT $1
    `,
    [options.maxRows + 1],
  );
  return {
    rows: result.rows.slice(0, options.maxRows),
    truncated: result.rows.length > options.maxRows,
  };
}

async function readDrugPackagesForDrugMasterJanRows(
  client: PgClientLike,
  rows: DrugMasterJanBackfillRow[],
) {
  const codes = Array.from(new Set(rows.flatMap((row) => buildPackageCodeCandidates(row.janCode))));
  if (codes.length === 0) return [];

  const result = await client.query<DrugPackageBackfillRow>(
    `
      SELECT
        "id",
        "drug_master_id" AS "drugMasterId",
        "gtin",
        "jan_code" AS "janCode",
        "is_active" AS "isActive"
      FROM "DrugPackage"
      WHERE "gtin" = ANY($1::text[])
         OR "jan_code" = ANY($1::text[])
      ORDER BY "gtin", "jan_code", "id"
    `,
    [codes],
  );
  return result.rows;
}

export async function runDrugPackageJanBackfill(
  client: PgClientLike,
  options: DrugPackageJanBackfillOptions,
) {
  const { rows: drugMasters, truncated } = await readDrugMastersWithJan(client, options);
  const drugPackages = await readDrugPackagesForDrugMasterJanRows(client, drugMasters);
  const findings = classifyDrugPackageJanBackfillRows(drugMasters, drugPackages);
  return summarizeDrugPackageJanBackfillFindings(findings, options, truncated);
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parseDrugPackageJanBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const result = await runDrugPackageJanBackfill(client, options);
    await writeDrugPackageJanBackfillArtifacts(result, options);
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
