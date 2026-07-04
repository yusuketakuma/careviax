import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

import { allocateGlobalDisplayId } from '@/lib/db/display-id';

type BackfillMode = 'dry-run' | 'apply';

export type DrugPriceVersionBackfillOptions = {
  mode: BackfillMode;
  maxRows: number;
  sampleLimit: number;
  jsonOutputPath: string | null;
  markdownOutputPath: string | null;
};

export type DrugPriceVersionBackfillCandidate = {
  drugMasterId: string;
  yjCode: string | null;
  drugName: string;
  drugPrice: string | null;
  transitionalExpiryDate: string | null;
  effectiveFrom: string;
  importLogId: string | null;
  sourcePublishedAt: string | null;
  wouldCreate: boolean;
};

export type DrugPriceVersionBackfillResult = {
  ok: boolean;
  mode: BackfillMode;
  dryRun: boolean;
  generatedAt: string;
  effectiveFrom: string;
  effectiveFromSource: 'latest_mhlw_price_import_log' | 'baseline_2026_04_01';
  maxRows: number;
  totalPricedDrugMasters: number;
  existingVersionRows: number;
  backfillableRows: number;
  backfilledRows: number;
  truncated: boolean;
  latestImportLog: {
    id: string | null;
    sourceUrl: string | null;
    sourceFileHash: string | null;
    sourcePublishedAt: string | null;
  };
  samples: DrugPriceVersionBackfillCandidate[];
};

type BackfillClient = Pick<
  PrismaClient,
  '$transaction' | 'drugMaster' | 'drugMasterImportLog' | 'drugPriceVersion'
>;

const BASELINE_EFFECTIVE_FROM = new Date(Date.UTC(2026, 3, 1));
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const USAGE = [
  'Usage: tsx tools/scripts/backfill-drug-price-versions.ts [--dry-run] [--apply --max-rows N] [--sample-limit N] [--json-output PATH] [--markdown-output PATH]',
  'Default mode is --dry-run. Apply mode requires an explicit --max-rows bound and separate human approval.',
].join('\n');

const FLAGS_WITH_VALUES = new Set([
  '--max-rows',
  '--sample-limit',
  '--json-output',
  '--markdown-output',
]);
const KNOWN_FLAGS = new Set(['--dry-run', '--apply', '--help', ...FLAGS_WITH_VALUES]);

function readValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
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

export function parseDrugPriceVersionBackfillArgs(argv: string[]): DrugPriceVersionBackfillOptions {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (FLAGS_WITH_VALUES.has(arg)) index += 1;
  }

  if (argv.includes('--help')) throw new Error(USAGE);
  if (argv.includes('--apply') && argv.includes('--dry-run')) {
    throw new Error('Choose either --apply or --dry-run, not both');
  }
  const mode: BackfillMode = argv.includes('--apply') ? 'apply' : 'dry-run';
  if (mode === 'apply' && readValue(argv, '--max-rows') == null) {
    throw new Error('Apply mode requires an explicit --max-rows bound');
  }

  return {
    mode,
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

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function renderMarkdown(result: DrugPriceVersionBackfillResult) {
  const lines = [
    '# DrugPriceVersion Backfill',
    '',
    `- mode: ${result.mode}`,
    `- dryRun: ${result.dryRun}`,
    `- effectiveFrom: ${result.effectiveFrom} (${result.effectiveFromSource})`,
    `- totalPricedDrugMasters: ${result.totalPricedDrugMasters}`,
    `- existingVersionRows: ${result.existingVersionRows}`,
    `- backfillableRows: ${result.backfillableRows}`,
    `- backfilledRows: ${result.backfilledRows}`,
    `- truncated: ${result.truncated}`,
    '',
    '| drugMasterId | yjCode | drugName | drugPrice | effectiveFrom | wouldCreate |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const sample of result.samples) {
    lines.push(
      `| ${sample.drugMasterId} | ${sample.yjCode ?? ''} | ${sample.drugName} | ${
        sample.drugPrice ?? ''
      } | ${sample.effectiveFrom} | ${sample.wouldCreate} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

async function writeOutput(path: string | null, content: string) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function runDrugPriceVersionBackfill(
  client: BackfillClient,
  options: DrugPriceVersionBackfillOptions,
): Promise<DrugPriceVersionBackfillResult> {
  const latestImportLog = await client.drugMasterImportLog.findFirst({
    where: {
      source: 'mhlw_price',
      status: 'completed',
      source_published_at: { not: null },
    },
    orderBy: [{ source_published_at: 'desc' }, { imported_at: 'desc' }],
    select: {
      id: true,
      source_url: true,
      source_file_hash: true,
      source_published_at: true,
    },
  });
  const effectiveFrom = latestImportLog?.source_published_at ?? BASELINE_EFFECTIVE_FROM;
  const effectiveFromSource = latestImportLog
    ? 'latest_mhlw_price_import_log'
    : 'baseline_2026_04_01';

  const totalPricedDrugMasters = await client.drugMaster.count({
    where: { drug_price: { not: null } },
  });
  const drugMasters = await client.drugMaster.findMany({
    where: { drug_price: { not: null } },
    orderBy: { id: 'asc' },
    take: options.maxRows + 1,
    select: {
      id: true,
      yj_code: true,
      drug_name: true,
      drug_price: true,
      transitional_expiry_date: true,
    },
  });
  const truncated = drugMasters.length > options.maxRows;
  const boundedDrugMasters = drugMasters.slice(0, options.maxRows);
  const existingVersions = await client.drugPriceVersion.findMany({
    where: {
      drug_master_id: { in: boundedDrugMasters.map((row) => row.id) },
      effective_from: effectiveFrom,
    },
    select: { drug_master_id: true },
  });
  const existingVersionDrugMasterIds = new Set(
    existingVersions.map((version) => version.drug_master_id),
  );
  const rowsToCreate = boundedDrugMasters.filter(
    (row) => !existingVersionDrugMasterIds.has(row.id),
  );

  let backfilledRows = 0;
  if (options.mode === 'apply') {
    if (truncated || rowsToCreate.length > options.maxRows) {
      throw new Error(
        `Apply aborted because ${rowsToCreate.length} backfillable rows exceed --max-rows ${options.maxRows}`,
      );
    }

    backfilledRows = await client.$transaction(async (tx) => {
      let created = 0;
      for (const row of rowsToCreate) {
        const displayId = await allocateGlobalDisplayId(tx, 'DrugPriceVersion');
        await tx.drugPriceVersion.create({
          data: {
            display_id: displayId,
            drug_master_id: row.id,
            import_log_id: latestImportLog?.id ?? null,
            source: 'mhlw_price',
            source_url: latestImportLog?.source_url ?? null,
            source_file_hash: latestImportLog?.source_file_hash ?? null,
            source_published_at: latestImportLog?.source_published_at ?? null,
            effective_from: effectiveFrom,
            drug_price: row.drug_price,
            transitional_expiry_date: row.transitional_expiry_date,
          },
        });
        created += 1;
      }
      return created;
    });
  }

  const samples = boundedDrugMasters.slice(0, options.sampleLimit).map((row) => ({
    drugMasterId: row.id,
    yjCode: row.yj_code,
    drugName: row.drug_name,
    drugPrice: row.drug_price?.toString() ?? null,
    transitionalExpiryDate: isoDate(row.transitional_expiry_date),
    effectiveFrom: isoDate(effectiveFrom) ?? '',
    importLogId: latestImportLog?.id ?? null,
    sourcePublishedAt: isoDate(latestImportLog?.source_published_at),
    wouldCreate: !existingVersionDrugMasterIds.has(row.id),
  }));

  return {
    ok: !truncated,
    mode: options.mode,
    dryRun: options.mode === 'dry-run',
    generatedAt: new Date().toISOString(),
    effectiveFrom: isoDate(effectiveFrom) ?? '',
    effectiveFromSource,
    maxRows: options.maxRows,
    totalPricedDrugMasters,
    existingVersionRows: existingVersions.length,
    backfillableRows: rowsToCreate.length,
    backfilledRows,
    truncated,
    latestImportLog: {
      id: latestImportLog?.id ?? null,
      sourceUrl: latestImportLog?.source_url ?? null,
      sourceFileHash: latestImportLog?.source_file_hash ?? null,
      sourcePublishedAt: isoDate(latestImportLog?.source_published_at),
    },
    samples,
  };
}

async function main() {
  const options = parseDrugPriceVersionBackfillArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await runDrugPriceVersionBackfill(prisma, options);
    await writeOutput(options.jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
    await writeOutput(options.markdownOutputPath, renderMarkdown(result));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : inspect(error, { depth: 4 }));
    process.exitCode = 1;
  });
}
