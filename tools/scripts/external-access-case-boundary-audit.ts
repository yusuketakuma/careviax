import 'dotenv/config';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

export type LegacyGrantRow = {
  id: string;
  org_id: string;
  patient_id: string;
  active_case_ids: string[];
  active_case_count: string;
  has_supported_case_scope: boolean;
  has_self_report_history: boolean;
};

export type ExternalAccessCaseBoundaryMode = 'dry-run' | 'apply';

export type ExternalAccessCaseBoundaryOptions = {
  mode: ExternalAccessCaseBoundaryMode;
  maxRows: number | null;
};

export type ExternalAccessCaseBoundaryBlocker = {
  grant_id: string;
  org_id: string;
  patient_id: string;
  reason: 'no_active_case' | 'multiple_active_cases' | 'unsupported_self_report_history_only';
  active_case_count: number;
};

export type PgClientLike = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
};

const USAGE = [
  'Usage: pnpm db:external-access-case-boundary-audit [--dry-run] [--apply --max-rows N]',
  'Default mode is --dry-run. --apply never runs unless --max-rows is provided.',
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

function parsePositiveInt(value: string | null, name: string) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseExternalAccessCaseBoundaryArgs(
  argv: string[],
): ExternalAccessCaseBoundaryOptions {
  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }

  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run, not both');

  const maxRows = parsePositiveInt(readValue(argv, '--max-rows'), '--max-rows');
  if (apply && maxRows == null) {
    throw new Error('--apply requires --max-rows to keep the write bounded');
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    maxRows,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function activeCaseCount(row: Pick<LegacyGrantRow, 'active_case_count'>) {
  return Number(row.active_case_count);
}

export function classifyExternalAccessCaseBoundaryBlocker(
  row: LegacyGrantRow,
): ExternalAccessCaseBoundaryBlocker | null {
  const count = activeCaseCount(row);
  if (!row.has_supported_case_scope && row.has_self_report_history) {
    return {
      grant_id: row.id,
      org_id: row.org_id,
      patient_id: row.patient_id,
      reason: 'unsupported_self_report_history_only',
      active_case_count: count,
    };
  }
  if (count === 0) {
    return {
      grant_id: row.id,
      org_id: row.org_id,
      patient_id: row.patient_id,
      reason: 'no_active_case',
      active_case_count: count,
    };
  }
  if (count > 1) {
    return {
      grant_id: row.id,
      org_id: row.org_id,
      patient_id: row.patient_id,
      reason: 'multiple_active_cases',
      active_case_count: count,
    };
  }
  return null;
}

async function findLegacyCaseBackedGrants(client: PgClientLike) {
  const result = await client.query<LegacyGrantRow>(`
    SELECT
      external_grant.id,
      external_grant.org_id,
      external_grant.patient_id,
      COALESCE(
        ARRAY_AGG(care_case.id ORDER BY care_case.created_at ASC, care_case.id ASC)
          FILTER (WHERE care_case.id IS NOT NULL),
        ARRAY[]::text[]
      ) AS active_case_ids,
      COUNT(care_case.id)::text AS active_case_count,
      (
        external_grant.scope::jsonb ->> 'visit_schedule' = 'true'
        OR external_grant.scope::jsonb ->> 'care_reports' = 'true'
      ) AS has_supported_case_scope,
      external_grant.scope::jsonb ->> 'self_report_history' = 'true' AS has_self_report_history
    FROM "ExternalAccessGrant" external_grant
    LEFT JOIN "CareCase" care_case
      ON care_case.org_id = external_grant.org_id
      AND care_case.patient_id = external_grant.patient_id
      AND care_case.status = 'active'
    WHERE
      external_grant.revoked_at IS NULL
      AND external_grant.expires_at >= NOW()
      AND (
        external_grant.scope::jsonb ->> 'visit_schedule' = 'true'
        OR external_grant.scope::jsonb ->> 'care_reports' = 'true'
        OR external_grant.scope::jsonb ->> 'self_report_history' = 'true'
      )
      AND NOT (
        external_grant.scope::jsonb ? 'allowed_case_ids'
        AND jsonb_typeof(external_grant.scope::jsonb -> 'allowed_case_ids') = 'array'
        AND jsonb_array_length(external_grant.scope::jsonb -> 'allowed_case_ids') > 0
      )
    GROUP BY
      external_grant.id,
      external_grant.org_id,
      external_grant.patient_id,
      external_grant.scope
    ORDER BY external_grant.org_id, external_grant.patient_id, external_grant.id
  `);

  return result.rows.map((row) => ({
    ...row,
    active_case_ids: toStringArray(row.active_case_ids),
    has_supported_case_scope: Boolean(row.has_supported_case_scope),
    has_self_report_history: Boolean(row.has_self_report_history),
  }));
}

async function backfillAllowedCaseId(client: PgClientLike, grantId: string, caseId: string) {
  await client.query(
    `
      UPDATE "ExternalAccessGrant"
      SET
        scope = jsonb_set(scope::jsonb, '{allowed_case_ids}', $2::jsonb, true),
        updated_at = NOW()
      WHERE id = $1
    `,
    [grantId, JSON.stringify([caseId])],
  );
}

export async function runExternalAccessCaseBoundaryAudit(
  client: PgClientLike,
  options: ExternalAccessCaseBoundaryOptions,
) {
  const legacyGrants = await findLegacyCaseBackedGrants(client);
  const blockers = legacyGrants
    .map(classifyExternalAccessCaseBoundaryBlocker)
    .filter((item): item is ExternalAccessCaseBoundaryBlocker => Boolean(item));
  const backfillable = legacyGrants.filter(
    (row) => !classifyExternalAccessCaseBoundaryBlocker(row),
  );
  const updatedGrantIds: string[] = [];

  if (options.mode === 'apply') {
    if (blockers.length > 0) {
      return {
        ok: false,
        mode: options.mode,
        legacy_case_backed_grants: legacyGrants.length,
        backfillable_grants: backfillable.length,
        updated_grants: updatedGrantIds,
        blockers,
        message:
          'Apply aborted because legacy grant blockers remain. Resolve blockers, then rerun --apply.',
      };
    }

    const maxRows = options.maxRows ?? 0;
    if (backfillable.length > maxRows) {
      return {
        ok: false,
        mode: options.mode,
        legacy_case_backed_grants: legacyGrants.length,
        backfillable_grants: backfillable.length,
        updated_grants: updatedGrantIds,
        blockers,
        message: `Apply aborted because ${backfillable.length} backfillable grants exceed --max-rows ${maxRows}. Increase the explicit bound after review.`,
      };
    }

    await client.query('BEGIN');
    try {
      for (const row of backfillable) {
        const [caseId] = row.active_case_ids;
        if (!caseId) continue;
        await backfillAllowedCaseId(client, row.id, caseId);
        updatedGrantIds.push(row.id);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  const ok = blockers.length === 0 && (options.mode === 'apply' || legacyGrants.length === 0);

  return {
    ok,
    mode: options.mode,
    legacy_case_backed_grants: legacyGrants.length,
    backfillable_grants: backfillable.length,
    updated_grants: updatedGrantIds,
    blockers,
    message:
      legacyGrants.length === 0
        ? 'No active legacy case-backed ExternalAccessGrant rows require allowed_case_ids.'
        : options.mode === 'apply'
          ? 'Backfilled single-active-case legacy grants.'
          : 'Dry run only. Re-run with --apply --max-rows N to backfill single-active-case grants, then resolve blockers manually.',
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parseExternalAccessCaseBoundaryArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({
    connectionString,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();

  try {
    const output = await runExternalAccessCaseBoundaryAudit(client, options);
    const serialized = JSON.stringify(output, null, output.ok ? 0 : 2);
    if (output.ok) {
      console.log(serialized);
    } else {
      console.error(serialized);
      process.exitCode = 1;
    }
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
