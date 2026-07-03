import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

import {
  DISPLAY_ID_EXCLUDED_MODELS,
  allocateDisplayIdRange,
  formatDisplayId,
  getDisplayIdRegistryEntry,
  isDisplayIdModel,
  type DisplayIdModel,
  type DisplayIdPrefix,
} from '@/lib/db/display-id';

type BackfillMode = 'dry-run' | 'apply';
type DisplayIdBackfillOrgSource = 'direct' | 'handoffBoardParent';

export type DisplayIdBackfillOptions = {
  mode: BackfillMode;
  models: DisplayIdModel[];
  maxRows: number;
  batchSize: number;
  sampleLimit: number;
  orgId: string | null;
  includeParentScoped: boolean;
  jsonOutputPath: string | null;
  markdownOutputPath: string | null;
};

export type DisplayIdBackfillRow = {
  id: string;
  orgId: string;
  createdAt: Date;
};

export type DisplayIdOrgCount = {
  orgId: string;
  count: number;
};

export type DisplayIdMaxSequence = {
  orgId: string;
  maxSequence: bigint;
};

export type DisplayIdSequenceMismatch = {
  orgId: string;
  expectedAtLeastNextValue: string;
  actualNextValue: string | null;
};

export type DisplayIdBackfillIssue = {
  name: string;
  severity: 'error' | 'warning';
  model?: string;
  orgId?: string;
  details?: string;
};

export type DisplayIdBackfillOrgPreview = {
  model: DisplayIdModel;
  orgId: string;
  rowsToBackfill: number;
  firstPreviewDisplayId: string | null;
  lastPreviewDisplayId: string | null;
};

export type DisplayIdBackfillModelResult = {
  model: DisplayIdModel;
  totalRows: number;
  nullDisplayIdRows: number;
  duplicateDisplayIdGroups: number;
  invalidFormatRows: number;
  sequenceMismatches: DisplayIdSequenceMismatch[];
  backfilledRows: number;
  orgs: DisplayIdBackfillOrgPreview[];
};

export type DisplayIdBackfillResult = {
  ok: boolean;
  mode: BackfillMode;
  dryRun: boolean;
  generatedAt: string;
  targetModels: DisplayIdModel[];
  maxRows: number;
  batchSize: number;
  sampleLimit: number;
  orgId: string | null;
  models: Record<string, DisplayIdBackfillModelResult>;
  orgs: DisplayIdBackfillOrgPreview[];
  issues: DisplayIdBackfillIssue[];
  postChecks: Array<{
    model: DisplayIdModel;
    ok: boolean;
    nullDisplayIdRows: number;
    duplicateDisplayIdGroups: number;
    invalidFormatRows: number;
    sequenceMismatches: DisplayIdSequenceMismatch[];
  }>;
};

export type DisplayIdBackfillModelConfig = {
  model: DisplayIdModel;
  tableName: string;
  prefix: DisplayIdPrefix;
  orgSource: DisplayIdBackfillOrgSource;
};

export type DisplayIdBackfillAdapter = {
  countRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number>;
  countNullRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number>;
  countDuplicateDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number>;
  countInvalidDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number>;
  listNullRowsByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdOrgCount[]>;
  readMaxDisplaySequenceByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdMaxSequence[]>;
  readSequenceNextValue(orgId: string, prefix: DisplayIdPrefix): Promise<bigint | null>;
  ensureSequenceAtLeast(orgId: string, prefix: DisplayIdPrefix, nextValue: bigint): Promise<void>;
  selectNullRowsForOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string,
    limit: number,
  ): Promise<DisplayIdBackfillRow[]>;
  updateDisplayId(
    config: DisplayIdBackfillModelConfig,
    row: DisplayIdBackfillRow,
    displayId: string,
  ): Promise<number>;
};

export type DisplayIdBackfillClient = {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};

type DisplayIdRawExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type DisplayIdBackfillDeps = {
  createAdapter: (executor: unknown) => DisplayIdBackfillAdapter;
  allocateRange: typeof allocateDisplayIdRange;
  now: () => Date;
};

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const DISPLAY_ID_ORG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const USAGE = [
  'Usage: pnpm tsx tools/scripts/backfill-display-ids.ts --models Patient,Residence [--dry-run]',
  '       pnpm tsx tools/scripts/backfill-display-ids.ts --apply --models Patient --max-rows 100000',
  '',
  'Options:',
  '  --models LIST       Comma-separated DisplayId registry models to target',
  '  --apply             Mutate rows and id_sequence; requires --models and --max-rows',
  '  --dry-run           Read-only mode (default)',
  '  --max-rows N        Apply fail-fast ceiling; dry-run reports target NULL rows, apply refuses before mutation if rows exceed N',
  '  --batch-size N      Rows per (model, org) transaction batch',
  '  --sample-limit N    Bounded reporting sample size',
  '  --org-id ORG        Optional single tenant/org filter',
  '  --include-parent-scoped  Opt in to HandoffItem board_id -> HandoffBoard.org_id backfill',
  '  --json-output PATH  Write JSON report',
  '  --markdown-output PATH  Write Markdown report',
].join('\n');

function readValue(argv: string[], name: string): string | null {
  const equalsPrefix = `${name}=`;
  const equalsValue = argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | null, name: string, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOrgId(value: string | null): string | null {
  if (value === null) return null;
  if (value.trim() !== value || value.length === 0) {
    throw new Error('--org-id must be a non-empty safe orgId');
  }
  if (!DISPLAY_ID_ORG_ID_PATTERN.test(value)) {
    throw new Error(
      '--org-id must start with an ASCII letter or digit and contain only ASCII letters, digits, _ or -',
    );
  }
  return value;
}

function parseModels(
  value: string | null,
  options: { includeParentScoped: boolean },
): DisplayIdModel[] {
  if (!value) return [];

  const models = value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const seen = new Set<string>();

  return models.map((model) => {
    if (seen.has(model)) {
      throw new Error(`duplicate display_id model in --models: ${model}`);
    }
    seen.add(model);

    if (!isDisplayIdModel(model)) {
      if ((DISPLAY_ID_EXCLUDED_MODELS as readonly string[]).includes(model)) {
        throw new Error(`Model ${model} is not a display_id model`);
      }
      throw new Error(`Unknown display_id model: ${model}`);
    }

    const entry = getDisplayIdRegistryEntry(model);
    const isSupportedParentScoped =
      options.includeParentScoped &&
      model === 'HandoffItem' &&
      entry.scope === 'orgViaParent' &&
      entry.parent === 'HandoffBoard';
    if (model === 'HandoffItem' && entry.scope === 'orgViaParent' && !isSupportedParentScoped) {
      throw new Error(
        `Model ${model} is parent-scoped and requires --include-parent-scoped for backfill`,
      );
    }
    if (entry.scope !== 'org' && !isSupportedParentScoped) {
      throw new Error(`Model ${model} is not tenant-scoped and cannot use this backfill`);
    }
    return model;
  });
}

export function parseDisplayIdBackfillArgs(argv: string[]): DisplayIdBackfillOptions {
  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }

  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) {
    throw new Error('--apply and --dry-run are mutually exclusive');
  }

  const maxRowsValue = readValue(argv, '--max-rows');
  const includeParentScoped = argv.includes('--include-parent-scoped');
  const models = parseModels(readValue(argv, '--models'), { includeParentScoped });
  if (apply && models.length === 0) {
    throw new Error('--apply requires --models');
  }
  if (apply && maxRowsValue === null) {
    throw new Error('--apply requires --max-rows');
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    models,
    maxRows: parsePositiveInt(maxRowsValue, '--max-rows', DEFAULT_MAX_ROWS),
    batchSize: parsePositiveInt(
      readValue(argv, '--batch-size'),
      '--batch-size',
      DEFAULT_BATCH_SIZE,
    ),
    sampleLimit: parsePositiveInt(
      readValue(argv, '--sample-limit'),
      '--sample-limit',
      DEFAULT_SAMPLE_LIMIT,
    ),
    orgId: parseOrgId(readValue(argv, '--org-id')),
    includeParentScoped,
    jsonOutputPath: readValue(argv, '--json-output'),
    markdownOutputPath: readValue(argv, '--markdown-output'),
  };
}

function requireTargetModels(options: DisplayIdBackfillOptions): DisplayIdModel[] {
  if (options.models.length === 0) {
    throw new Error('--models is required');
  }
  return options.models;
}

function createModelConfig(
  model: DisplayIdModel,
  options: Pick<DisplayIdBackfillOptions, 'includeParentScoped'>,
): DisplayIdBackfillModelConfig {
  const entry = getDisplayIdRegistryEntry(model);
  if (entry.scope === 'org') {
    return {
      model,
      tableName: model,
      prefix: entry.prefix,
      orgSource: 'direct',
    };
  }
  if (
    options.includeParentScoped &&
    model === 'HandoffItem' &&
    entry.scope === 'orgViaParent' &&
    entry.parent === 'HandoffBoard'
  ) {
    return {
      model,
      tableName: model,
      prefix: entry.prefix,
      orgSource: 'handoffBoardParent',
    };
  }
  if (entry.scope === 'orgViaParent') {
    throw new Error(
      `Model ${model} is parent-scoped and requires --include-parent-scoped for backfill`,
    );
  }
  throw new Error(`Model ${model} is not tenant-scoped and cannot use this backfill`);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function toBigIntValue(value: bigint | number | string | null | undefined): bigint | null {
  if (value == null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Expected a safe integer');
    }
    return BigInt(value);
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Expected numeric string, got ${value}`);
  }
  return BigInt(value);
}

function toNumberCount(value: bigint | number | string): number {
  const count = toBigIntValue(value);
  if (count == null) return 0;
  const asNumber = Number(count);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Count exceeds safe integer range: ${count.toString()}`);
  }
  return asNumber;
}

function appendOrgFilter(
  values: unknown[],
  orgId: string | null,
  orgExpression = '"org_id"',
): string {
  if (orgId === null) return '';
  values.push(orgId);
  return ` AND ${orgExpression} = $${values.length}`;
}

function isHandoffBoardParentScoped(config: DisplayIdBackfillModelConfig): boolean {
  return config.orgSource === 'handoffBoardParent';
}

function targetFromClause(config: DisplayIdBackfillModelConfig): string {
  if (isHandoffBoardParentScoped(config)) {
    return `${quoteIdentifier(config.tableName)} item INNER JOIN "HandoffBoard" board ON board."id" = item."board_id"`;
  }
  return quoteIdentifier(config.tableName);
}

function targetColumn(config: DisplayIdBackfillModelConfig, column: string): string {
  const quoted = quoteIdentifier(column);
  return isHandoffBoardParentScoped(config) ? `item.${quoted}` : quoted;
}

function orgColumn(config: DisplayIdBackfillModelConfig): string {
  return isHandoffBoardParentScoped(config) ? 'board."org_id"' : '"org_id"';
}

function displayIdFormatRegex(prefix: DisplayIdPrefix): string {
  return `^${prefix}[0-9]{10,15}$`;
}

function canonicalDisplayIdSqlPredicate(
  displayIdExpression: string,
  sequenceStart: number,
): string {
  return `CASE WHEN ${displayIdExpression} ~ $1 THEN SUBSTRING(${displayIdExpression} FROM ${sequenceStart})::bigint > 0 ELSE false END`;
}

function maxBigInt(values: bigint[]): bigint {
  return values.reduce((max, value) => (value > max ? value : max), BigInt(1));
}

class PrismaDisplayIdBackfillAdapter implements DisplayIdBackfillAdapter {
  constructor(private readonly executor: DisplayIdRawExecutor) {}

  async countRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number> {
    const values: unknown[] = [];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const rows = await this.executor.$queryRawUnsafe<Array<{ count: string | bigint }>>(
      `SELECT COUNT(*)::text AS "count" FROM ${targetFromClause(config)} WHERE TRUE${filter}`,
      ...values,
    );
    return toNumberCount(rows[0]?.count ?? '0');
  }

  async countNullRows(config: DisplayIdBackfillModelConfig, orgId: string | null): Promise<number> {
    const values: unknown[] = [];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const rows = await this.executor.$queryRawUnsafe<Array<{ count: string | bigint }>>(
      `SELECT COUNT(*)::text AS "count" FROM ${targetFromClause(config)} WHERE ${targetColumn(config, 'display_id')} IS NULL${filter}`,
      ...values,
    );
    return toNumberCount(rows[0]?.count ?? '0');
  }

  async countDuplicateDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number> {
    const values: unknown[] = [];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const rows = await this.executor.$queryRawUnsafe<Array<{ count: string | bigint }>>(
      `
        SELECT COUNT(*)::text AS "count"
        FROM (
          SELECT ${orgColumn(config)} AS "orgId", ${targetColumn(config, 'display_id')} AS "displayId"
          FROM ${targetFromClause(config)}
          WHERE ${targetColumn(config, 'display_id')} IS NOT NULL${filter}
          GROUP BY ${orgColumn(config)}, ${targetColumn(config, 'display_id')}
          HAVING COUNT(*) > 1
        ) duplicate_groups
      `,
      ...values,
    );
    return toNumberCount(rows[0]?.count ?? '0');
  }

  async countInvalidDisplayIds(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<number> {
    const values: unknown[] = [displayIdFormatRegex(config.prefix)];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const sequenceStart = config.prefix.length + 1;
    const rows = await this.executor.$queryRawUnsafe<Array<{ count: string | bigint }>>(
      `
        SELECT COUNT(*)::text AS "count"
        FROM ${targetFromClause(config)}
        WHERE ${targetColumn(config, 'display_id')} IS NOT NULL
          AND NOT (${canonicalDisplayIdSqlPredicate(targetColumn(config, 'display_id'), sequenceStart)})${filter}
      `,
      ...values,
    );
    return toNumberCount(rows[0]?.count ?? '0');
  }

  async listNullRowsByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdOrgCount[]> {
    const values: unknown[] = [];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const rows = await this.executor.$queryRawUnsafe<Array<{ orgId: string; count: string }>>(
      `
        SELECT ${orgColumn(config)} AS "orgId", COUNT(*)::text AS "count"
        FROM ${targetFromClause(config)}
        WHERE ${targetColumn(config, 'display_id')} IS NULL${filter}
        GROUP BY ${orgColumn(config)}
        ORDER BY ${orgColumn(config)} ASC
      `,
      ...values,
    );
    return rows.map((row) => ({ orgId: row.orgId, count: toNumberCount(row.count) }));
  }

  async readMaxDisplaySequenceByOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string | null,
  ): Promise<DisplayIdMaxSequence[]> {
    const values: unknown[] = [displayIdFormatRegex(config.prefix)];
    const filter = appendOrgFilter(values, orgId, orgColumn(config));
    const sequenceStart = config.prefix.length + 1;
    const rows = await this.executor.$queryRawUnsafe<Array<{ orgId: string; maxSequence: string }>>(
      `
        SELECT
          ${orgColumn(config)} AS "orgId",
          MAX(SUBSTRING(${targetColumn(config, 'display_id')} FROM ${sequenceStart})::bigint)::text AS "maxSequence"
        FROM ${targetFromClause(config)}
        WHERE ${canonicalDisplayIdSqlPredicate(targetColumn(config, 'display_id'), sequenceStart)}${filter}
        GROUP BY ${orgColumn(config)}
        ORDER BY ${orgColumn(config)} ASC
      `,
      ...values,
    );
    return rows.map((row) => ({
      orgId: row.orgId,
      maxSequence: toBigIntValue(row.maxSequence) ?? BigInt(0),
    }));
  }

  async readSequenceNextValue(orgId: string, prefix: DisplayIdPrefix): Promise<bigint | null> {
    const rows = await this.executor.$queryRawUnsafe<Array<{ nextValue: string | null }>>(
      `
        SELECT "next_value"::text AS "nextValue"
        FROM "id_sequence"
        WHERE "org_id" = $1 AND "prefix" = $2
      `,
      orgId,
      prefix,
    );
    return toBigIntValue(rows[0]?.nextValue);
  }

  async ensureSequenceAtLeast(
    orgId: string,
    prefix: DisplayIdPrefix,
    nextValue: bigint,
  ): Promise<void> {
    await this.executor.$executeRawUnsafe(
      `
        INSERT INTO "id_sequence" ("org_id", "prefix", "next_value", "updated_at")
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT ("org_id", "prefix")
        DO UPDATE SET
          "next_value" = GREATEST("id_sequence"."next_value", EXCLUDED."next_value"),
          "updated_at" = CURRENT_TIMESTAMP
      `,
      orgId,
      prefix,
      nextValue,
    );
  }

  async selectNullRowsForOrg(
    config: DisplayIdBackfillModelConfig,
    orgId: string,
    limit: number,
  ): Promise<DisplayIdBackfillRow[]> {
    const rows = await this.executor.$queryRawUnsafe<
      Array<{ id: string; orgId: string; createdAt: Date }>
    >(
      `
        SELECT ${targetColumn(config, 'id')} AS "id", ${orgColumn(config)} AS "orgId", ${targetColumn(config, 'created_at')} AS "createdAt"
        FROM ${targetFromClause(config)}
        WHERE ${orgColumn(config)} = $1 AND ${targetColumn(config, 'display_id')} IS NULL
        ORDER BY ${targetColumn(config, 'created_at')} ASC, ${targetColumn(config, 'id')} ASC
        LIMIT $2
        FOR UPDATE${isHandoffBoardParentScoped(config) ? ' OF item' : ''}
      `,
      orgId,
      limit,
    );
    return rows;
  }

  async updateDisplayId(
    config: DisplayIdBackfillModelConfig,
    row: DisplayIdBackfillRow,
    displayId: string,
  ): Promise<number> {
    if (isHandoffBoardParentScoped(config)) {
      return this.executor.$executeRawUnsafe(
        `
          UPDATE ${quoteIdentifier(config.tableName)} item
          SET "display_id" = $1
          FROM "HandoffBoard" board
          WHERE item."id" = $2
            AND item."board_id" = board."id"
            AND board."org_id" = $3
            AND item."display_id" IS NULL
        `,
        displayId,
        row.id,
        row.orgId,
      );
    }
    return this.executor.$executeRawUnsafe(
      `
        UPDATE ${quoteIdentifier(config.tableName)}
        SET "display_id" = $1
        WHERE "id" = $2
          AND "org_id" = $3
          AND "display_id" IS NULL
      `,
      displayId,
      row.id,
      row.orgId,
    );
  }
}

export function createPrismaDisplayIdBackfillAdapter(executor: unknown): DisplayIdBackfillAdapter {
  return new PrismaDisplayIdBackfillAdapter(executor as DisplayIdRawExecutor);
}

const defaultDeps: DisplayIdBackfillDeps = {
  createAdapter: createPrismaDisplayIdBackfillAdapter,
  allocateRange: allocateDisplayIdRange,
  now: () => new Date(),
};

async function readSequenceMismatches(
  adapter: DisplayIdBackfillAdapter,
  config: DisplayIdBackfillModelConfig,
  orgId: string | null,
): Promise<DisplayIdSequenceMismatch[]> {
  const maxSequences = await adapter.readMaxDisplaySequenceByOrg(config, orgId);
  const mismatches: DisplayIdSequenceMismatch[] = [];
  for (const row of maxSequences) {
    const expectedNextValue = row.maxSequence + BigInt(1);
    const actualNextValue = await adapter.readSequenceNextValue(row.orgId, config.prefix);
    if (actualNextValue === null || actualNextValue < expectedNextValue) {
      mismatches.push({
        orgId: row.orgId,
        expectedAtLeastNextValue: expectedNextValue.toString(),
        actualNextValue: actualNextValue?.toString() ?? null,
      });
    }
  }
  return mismatches;
}

async function previewOrgRows(
  adapter: DisplayIdBackfillAdapter,
  config: DisplayIdBackfillModelConfig,
  orgCounts: DisplayIdOrgCount[],
  orgId: string | null,
): Promise<DisplayIdBackfillOrgPreview[]> {
  const maxByOrg = new Map(
    (await adapter.readMaxDisplaySequenceByOrg(config, orgId)).map((row) => [
      row.orgId,
      row.maxSequence,
    ]),
  );

  const previews: DisplayIdBackfillOrgPreview[] = [];
  for (const orgCount of orgCounts) {
    const sequenceNextValue = await adapter.readSequenceNextValue(orgCount.orgId, config.prefix);
    const firstSequence = maxBigInt([
      sequenceNextValue ?? BigInt(1),
      (maxByOrg.get(orgCount.orgId) ?? BigInt(0)) + BigInt(1),
      BigInt(1),
    ]);
    const lastSequence = firstSequence + BigInt(orgCount.count - 1);
    previews.push({
      model: config.model,
      orgId: orgCount.orgId,
      rowsToBackfill: orgCount.count,
      firstPreviewDisplayId:
        orgCount.count > 0 ? formatDisplayId(config.model, firstSequence) : null,
      lastPreviewDisplayId: orgCount.count > 0 ? formatDisplayId(config.model, lastSequence) : null,
    });
  }
  return previews;
}

async function collectModelResult(
  adapter: DisplayIdBackfillAdapter,
  config: DisplayIdBackfillModelConfig,
  options: DisplayIdBackfillOptions,
  backfilledRows: number,
): Promise<DisplayIdBackfillModelResult> {
  const [totalRows, nullDisplayIdRows, duplicateDisplayIdGroups, invalidFormatRows, orgCounts] =
    await Promise.all([
      adapter.countRows(config, options.orgId),
      adapter.countNullRows(config, options.orgId),
      adapter.countDuplicateDisplayIds(config, options.orgId),
      adapter.countInvalidDisplayIds(config, options.orgId),
      adapter.listNullRowsByOrg(config, options.orgId),
    ]);

  return {
    model: config.model,
    totalRows,
    nullDisplayIdRows,
    duplicateDisplayIdGroups,
    invalidFormatRows,
    sequenceMismatches: await readSequenceMismatches(adapter, config, options.orgId),
    backfilledRows,
    orgs: await previewOrgRows(adapter, config, orgCounts, options.orgId),
  };
}

function collectPreApplyIssues(
  summary: DisplayIdBackfillModelResult,
  options: { includeSequenceMismatches: boolean },
): DisplayIdBackfillIssue[] {
  const issues: DisplayIdBackfillIssue[] = [];
  if (summary.duplicateDisplayIdGroups > 0) {
    issues.push({
      name: 'display-id-duplicate',
      severity: 'error',
      model: summary.model,
      details: `${summary.duplicateDisplayIdGroups} duplicate display_id group(s) already exist`,
    });
  }
  if (summary.invalidFormatRows > 0) {
    issues.push({
      name: 'display-id-format-invalid',
      severity: 'error',
      model: summary.model,
      details: `${summary.invalidFormatRows} rows have non-canonical display_id values`,
    });
  }
  if (options.includeSequenceMismatches) {
    for (const mismatch of summary.sequenceMismatches) {
      issues.push({
        name: 'id-sequence-next-value-mismatch',
        severity: 'error',
        model: summary.model,
        orgId: mismatch.orgId,
        details: `next_value ${mismatch.actualNextValue ?? 'null'} is below expected ${mismatch.expectedAtLeastNextValue}`,
      });
    }
  }
  return issues;
}

function collectPostApplyIssues(summary: DisplayIdBackfillModelResult): DisplayIdBackfillIssue[] {
  const issues: DisplayIdBackfillIssue[] = [];
  if (summary.nullDisplayIdRows > 0) {
    issues.push({
      name: 'display-id-null-rows-remain',
      severity: 'error',
      model: summary.model,
      details: `${summary.nullDisplayIdRows} rows still have NULL display_id`,
    });
  }
  if (summary.duplicateDisplayIdGroups > 0) {
    issues.push({
      name: 'display-id-duplicate',
      severity: 'error',
      model: summary.model,
      details: `${summary.duplicateDisplayIdGroups} duplicate display_id group(s) exist`,
    });
  }
  if (summary.invalidFormatRows > 0) {
    issues.push({
      name: 'display-id-format-invalid',
      severity: 'error',
      model: summary.model,
      details: `${summary.invalidFormatRows} rows have non-canonical display_id values`,
    });
  }
  for (const mismatch of summary.sequenceMismatches) {
    issues.push({
      name: 'id-sequence-next-value-mismatch',
      severity: 'error',
      model: summary.model,
      orgId: mismatch.orgId,
      details: `next_value ${mismatch.actualNextValue ?? 'null'} is below expected ${mismatch.expectedAtLeastNextValue}`,
    });
  }
  return issues;
}

async function alignExistingSequences(
  client: DisplayIdBackfillClient,
  config: DisplayIdBackfillModelConfig,
  options: DisplayIdBackfillOptions,
  deps: DisplayIdBackfillDeps,
): Promise<void> {
  const adapter = deps.createAdapter(client);
  const maxSequences = await adapter.readMaxDisplaySequenceByOrg(config, options.orgId);
  for (const row of maxSequences) {
    const nextValue = row.maxSequence + BigInt(1);
    if (nextValue <= BigInt(1)) continue;
    await client.$transaction(async (tx) => {
      await deps.createAdapter(tx).ensureSequenceAtLeast(row.orgId, config.prefix, nextValue);
    });
  }
}

async function applyModelBackfill(
  client: DisplayIdBackfillClient,
  config: DisplayIdBackfillModelConfig,
  options: DisplayIdBackfillOptions,
  deps: DisplayIdBackfillDeps,
  maxRows: number,
): Promise<number> {
  let backfilledRows = 0;

  while (backfilledRows < maxRows) {
    const orgCounts = await deps.createAdapter(client).listNullRowsByOrg(config, options.orgId);
    if (orgCounts.length === 0) break;

    let changedThisPass = 0;
    for (const orgCount of orgCounts) {
      while (backfilledRows < maxRows) {
        const remaining = maxRows - backfilledRows;
        const batchSize = Math.min(options.batchSize, remaining, orgCount.count);
        if (batchSize <= 0) break;

        const changed = await client.$transaction(async (tx) => {
          const txAdapter = deps.createAdapter(tx);
          const rows = await txAdapter.selectNullRowsForOrg(config, orgCount.orgId, batchSize);
          if (rows.length === 0) return 0;

          const displayIds = await deps.allocateRange(
            tx as Prisma.TransactionClient,
            config.model,
            orgCount.orgId,
            rows.length,
          );
          if (displayIds.length !== rows.length) {
            throw new Error(
              `Allocator returned ${displayIds.length} display IDs for ${rows.length} ${config.model} row(s)`,
            );
          }

          let updatedRows = 0;
          for (const [index, row] of rows.entries()) {
            const displayId = displayIds[index];
            if (!displayId) throw new Error(`Missing display_id for ${config.model} row ${row.id}`);
            const updated = await txAdapter.updateDisplayId(config, row, displayId);
            if (updated !== 1) {
              throw new Error(
                `Expected to update exactly one ${config.model} row for id ${row.id}, updated ${updated}`,
              );
            }
            updatedRows += updated;
          }
          return updatedRows;
        });

        if (changed === 0) break;
        backfilledRows += changed;
        changedThisPass += changed;
        if (changed < batchSize) break;
      }
    }

    if (changedThisPass === 0) break;
  }

  return backfilledRows;
}

export async function runDisplayIdBackfill(
  client: DisplayIdBackfillClient,
  options: DisplayIdBackfillOptions,
  deps: DisplayIdBackfillDeps = defaultDeps,
): Promise<DisplayIdBackfillResult> {
  const targetModels = requireTargetModels(options);
  const issues: DisplayIdBackfillIssue[] = [];
  const preSummaries = new Map<DisplayIdModel, DisplayIdBackfillModelResult>();
  const models: Record<string, DisplayIdBackfillModelResult> = {};

  for (const model of targetModels) {
    const config = createModelConfig(model, options);
    const adapter = deps.createAdapter(client);
    const preSummary = await collectModelResult(adapter, config, options, 0);
    preSummaries.set(model, preSummary);
    issues.push(
      ...collectPreApplyIssues(preSummary, {
        includeSequenceMismatches: options.mode === 'dry-run',
      }),
    );
  }

  const totalNullRows = [...preSummaries.values()].reduce(
    (total, summary) => total + summary.nullDisplayIdRows,
    0,
  );
  if (options.mode === 'apply' && totalNullRows > options.maxRows) {
    issues.push({
      name: 'max-rows-too-small',
      severity: 'error',
      details: `${totalNullRows} rows need backfill but --max-rows is ${options.maxRows}`,
    });
  }

  let remainingRows = options.maxRows;
  const hasPreApplyError = issues.some((issue) => issue.severity === 'error');

  for (const model of targetModels) {
    const config = createModelConfig(model, options);
    const preSummary = preSummaries.get(model);
    if (!preSummary) {
      throw new Error(`Missing pre-check summary for ${model}`);
    }

    let backfilledRows = 0;
    if (options.mode === 'apply' && !hasPreApplyError) {
      await alignExistingSequences(client, config, options, deps);
      backfilledRows = await applyModelBackfill(client, config, options, deps, remainingRows);
      remainingRows -= backfilledRows;
    }

    const finalSummary =
      options.mode === 'apply'
        ? await collectModelResult(deps.createAdapter(client), config, options, backfilledRows)
        : preSummary;
    models[model] = {
      ...finalSummary,
      backfilledRows,
      orgs: preSummary.orgs,
    };

    if (options.mode === 'apply') {
      issues.push(...collectPostApplyIssues(models[model]));
    }
  }

  const postChecks = Object.values(models).map((summary) => ({
    model: summary.model,
    ok:
      summary.nullDisplayIdRows === 0 &&
      summary.duplicateDisplayIdGroups === 0 &&
      summary.invalidFormatRows === 0 &&
      summary.sequenceMismatches.length === 0,
    nullDisplayIdRows: summary.nullDisplayIdRows,
    duplicateDisplayIdGroups: summary.duplicateDisplayIdGroups,
    invalidFormatRows: summary.invalidFormatRows,
    sequenceMismatches: summary.sequenceMismatches,
  }));
  const errors = issues.filter((issue) => issue.severity === 'error');

  return {
    ok:
      errors.length === 0 && (options.mode === 'dry-run' || postChecks.every((check) => check.ok)),
    mode: options.mode,
    dryRun: options.mode === 'dry-run',
    generatedAt: deps.now().toISOString(),
    targetModels,
    maxRows: options.maxRows,
    batchSize: options.batchSize,
    sampleLimit: options.sampleLimit,
    orgId: options.orgId,
    models,
    orgs: Object.values(models).flatMap((summary) => summary.orgs),
    issues,
    postChecks,
  };
}

export function renderDisplayIdBackfillMarkdown(result: DisplayIdBackfillResult): string {
  const lines = [
    '# Display ID Backfill Report',
    '',
    `- generated_at: ${result.generatedAt}`,
    `- mode: ${result.mode}`,
    `- target_models: ${result.targetModels.join(', ')}`,
    `- ok: ${result.ok ? 'true' : 'false'}`,
    '',
    '## Models',
    '',
  ];

  for (const summary of Object.values(result.models)) {
    lines.push(
      `### ${summary.model}`,
      '',
      `- total_rows: ${summary.totalRows}`,
      `- null_display_id_rows: ${summary.nullDisplayIdRows}`,
      `- backfilled_rows: ${summary.backfilledRows}`,
      `- duplicate_display_id_groups: ${summary.duplicateDisplayIdGroups}`,
      `- invalid_format_rows: ${summary.invalidFormatRows}`,
      `- sequence_mismatches: ${summary.sequenceMismatches.length}`,
      '',
    );
    for (const org of summary.orgs.slice(0, result.sampleLimit)) {
      lines.push(
        `  - ${org.orgId}: rows=${org.rowsToBackfill}, first=${org.firstPreviewDisplayId ?? 'n/a'}, last=${org.lastPreviewDisplayId ?? 'n/a'}`,
      );
    }
    lines.push('');
  }

  if (result.issues.length > 0) {
    lines.push('## Issues', '');
    for (const issue of result.issues) {
      lines.push(
        `- ${issue.severity}: ${issue.name}${issue.model ? ` (${issue.model})` : ''}${issue.orgId ? ` org=${issue.orgId}` : ''}${issue.details ? ` - ${issue.details}` : ''}`,
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeTextArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writeDisplayIdBackfillArtifacts(
  result: DisplayIdBackfillResult,
  options: DisplayIdBackfillOptions,
): Promise<void> {
  if (options.jsonOutputPath) {
    await writeTextArtifact(options.jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.markdownOutputPath) {
    await writeTextArtifact(options.markdownOutputPath, renderDisplayIdBackfillMarkdown(result));
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parseDisplayIdBackfillArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const adapter = new PrismaPg({ connectionString, max: 10 });
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await runDisplayIdBackfill(
      prisma as unknown as DisplayIdBackfillClient,
      options,
    );
    await writeDisplayIdBackfillArtifacts(result, options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
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
