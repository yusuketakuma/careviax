import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';
import {
  encryptWebhookSecret,
  readWebhookSigningSecret,
} from '@/server/services/webhook-secret-encryption';

type BackfillMode = 'dry-run' | 'apply';

export type BackfillOptions = {
  mode: BackfillMode;
  batchSize: number;
  maxRows: number | null;
  orgId: string | null;
};

export type WebhookSecretPreflightCounts = {
  total: number;
  legacyPlaintextRows: number;
  encryptedOnlyRows: number;
  backfilledButPlaintextRetainedRows: number;
  partialEncryptedRows: number;
  unreadableRows: number;
  unsupportedAlgorithmRows: number;
};

export type WebhookSecretOrgSummary = {
  orgId: string;
  legacyPlaintextRows: number;
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

const DEFAULT_BATCH_SIZE = 50;

function readValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | null, name: string, fallback: number | null) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseBackfillArgs(argv: string[]): BackfillOptions {
  if (argv.includes('--help')) {
    throw new Error(
      [
        'Usage: pnpm db:webhook-secrets:backfill [--dry-run] [--apply --max-rows N] [--batch-size N] [--org-id ORG]',
        'Default mode is --dry-run. --apply never runs unless --max-rows is provided.',
      ].join('\n'),
    );
  }

  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run, not both');

  const batchSize = parsePositiveInt(
    readValue(argv, '--batch-size'),
    '--batch-size',
    DEFAULT_BATCH_SIZE,
  );
  const maxRows = parsePositiveInt(readValue(argv, '--max-rows'), '--max-rows', null);
  if (apply && maxRows == null) {
    throw new Error('--apply requires --max-rows to keep the write bounded');
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    batchSize: batchSize ?? DEFAULT_BATCH_SIZE,
    maxRows,
    orgId: readValue(argv, '--org-id'),
  };
}

function toCount(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return 0;
}

export function normalizePreflightCounts(row: QueryResultRow): WebhookSecretPreflightCounts {
  return {
    total: toCount(row.total),
    legacyPlaintextRows: toCount(row.legacyPlaintextRows),
    encryptedOnlyRows: toCount(row.encryptedOnlyRows),
    backfilledButPlaintextRetainedRows: toCount(row.backfilledButPlaintextRetainedRows),
    partialEncryptedRows: toCount(row.partialEncryptedRows),
    unreadableRows: toCount(row.unreadableRows),
    unsupportedAlgorithmRows: toCount(row.unsupportedAlgorithmRows),
  };
}

export function getBlockingBackfillIssues(counts: WebhookSecretPreflightCounts) {
  return [
    counts.partialEncryptedRows > 0
      ? `${counts.partialEncryptedRows} rows have incomplete encrypted secret fields`
      : null,
    counts.unreadableRows > 0 ? `${counts.unreadableRows} rows have no readable secret` : null,
    counts.unsupportedAlgorithmRows > 0
      ? `${counts.unsupportedAlgorithmRows} rows use an unsupported secret algorithm`
      : null,
  ].filter((item): item is string => item != null);
}

async function withOptionalOrgContext<T>(
  client: PgClientLike,
  orgId: string | null,
  callback: () => Promise<T>,
) {
  if (!orgId) return callback();
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await callback();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function readWebhookSecretPreflight(
  client: PgClientLike,
  orgId: string | null = null,
) {
  return withOptionalOrgContext(client, orgId, async () => {
    const countsResult = await client.query(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE secret IS NOT NULL AND btrim(secret) <> '')::int AS "legacyPlaintextRows",
        COUNT(*) FILTER (
          WHERE secret IS NULL
            AND secret_ciphertext IS NOT NULL
            AND secret_iv IS NOT NULL
            AND secret_tag IS NOT NULL
            AND secret_key_id IS NOT NULL
            AND secret_algorithm = 'aes-256-gcm'
        )::int AS "encryptedOnlyRows",
        COUNT(*) FILTER (
          WHERE secret IS NOT NULL
            AND secret_ciphertext IS NOT NULL
            AND secret_iv IS NOT NULL
            AND secret_tag IS NOT NULL
        )::int AS "backfilledButPlaintextRetainedRows",
        COUNT(*) FILTER (
          WHERE (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_tag IS NULL)
            AND (secret_ciphertext IS NOT NULL OR secret_iv IS NOT NULL OR secret_tag IS NOT NULL)
        )::int AS "partialEncryptedRows",
        COUNT(*) FILTER (
          WHERE secret IS NULL
            AND (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_tag IS NULL)
        )::int AS "unreadableRows",
        COUNT(*) FILTER (
          WHERE secret_algorithm IS DISTINCT FROM 'aes-256-gcm'
        )::int AS "unsupportedAlgorithmRows"
      FROM "WebhookRegistration"
    `);
    const orgResult = await client.query<WebhookSecretOrgSummary>(`
      SELECT org_id AS "orgId", COUNT(*)::int AS "legacyPlaintextRows"
      FROM "WebhookRegistration"
      WHERE secret IS NOT NULL
        AND btrim(secret) <> ''
        AND (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_tag IS NULL)
      GROUP BY org_id
      ORDER BY COUNT(*) DESC, org_id
    `);

    return {
      counts: normalizePreflightCounts(countsResult.rows[0] ?? {}),
      orgs: orgResult.rows.map((row) => ({
        orgId: row.orgId,
        legacyPlaintextRows: toCount(row.legacyPlaintextRows),
      })),
    };
  });
}

async function selectCandidateRows(client: PgClientLike, limit: number) {
  const result = await client.query<{ id: string; secret: string }>(
    `
      WITH candidates AS (
        SELECT id, secret
        FROM "WebhookRegistration"
        WHERE secret IS NOT NULL
          AND btrim(secret) <> ''
          AND (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_tag IS NULL)
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      SELECT id, secret
      FROM candidates
    `,
    [limit],
  );
  return result.rows;
}

async function applyBatch(client: PgClientLike, batchSize: number, orgId: string | null) {
  await client.query('BEGIN');
  try {
    if (orgId) {
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    }

    const candidates = await selectCandidateRows(client, batchSize);
    let updatedRows = 0;

    for (const row of candidates) {
      const encrypted = await encryptWebhookSecret(row.secret);
      const verified = await readWebhookSigningSecret(encrypted);
      if (verified !== row.secret.trim()) {
        throw new Error('Encrypted webhook secret verification failed');
      }

      const updateResult = await client.query(
        `
          UPDATE "WebhookRegistration"
          SET
            secret_ciphertext = $2,
            secret_iv = $3,
            secret_tag = $4,
            secret_key_id = $5,
            secret_algorithm = 'aes-256-gcm'
          WHERE id = $1
            AND secret IS NOT NULL
            AND btrim(secret) <> ''
            AND (secret_ciphertext IS NULL OR secret_iv IS NULL OR secret_tag IS NULL)
        `,
        [
          row.id,
          encrypted.secret_ciphertext,
          encrypted.secret_iv,
          encrypted.secret_tag,
          encrypted.secret_key_id,
        ],
      );
      updatedRows += updateResult.rowCount ?? 0;
    }

    await client.query('COMMIT');
    return {
      selectedRows: candidates.length,
      updatedRows,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runWebhookSecretBackfill(client: PgClientLike, options: BackfillOptions) {
  const before = await readWebhookSecretPreflight(client, options.orgId);
  const blockingIssues = getBlockingBackfillIssues(before.counts);
  if (options.mode === 'dry-run') {
    return {
      ok: blockingIssues.length === 0,
      mode: options.mode,
      applyReady: blockingIssues.length === 0,
      blockingIssues,
      counts: before.counts,
      orgs: before.orgs,
    };
  }

  if (blockingIssues.length > 0) {
    return {
      ok: false,
      mode: options.mode,
      blockingIssues,
      countsBefore: before.counts,
      appliedRows: 0,
    };
  }

  const maxRows = options.maxRows ?? 0;
  let appliedRows = 0;
  while (appliedRows < maxRows) {
    const batchLimit = Math.min(options.batchSize, maxRows - appliedRows);
    const result = await applyBatch(client, batchLimit, options.orgId);
    appliedRows += result.updatedRows;
    if (result.selectedRows === 0 || result.updatedRows === 0) break;
  }

  const after = await readWebhookSecretPreflight(client, options.orgId);
  return {
    ok: getBlockingBackfillIssues(after.counts).length === 0,
    mode: options.mode,
    blockingIssues: getBlockingBackfillIssues(after.counts),
    countsBefore: before.counts,
    countsAfter: after.counts,
    orgsAfter: after.orgs,
    appliedRows,
    plaintextWipeRequiredLater: after.counts.backfilledButPlaintextRetainedRows > 0,
  };
}

async function main() {
  const options = parseBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const result = await runWebhookSecretBackfill(client, options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
