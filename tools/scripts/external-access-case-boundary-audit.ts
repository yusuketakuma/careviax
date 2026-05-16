import 'dotenv/config';
import { Client } from 'pg';
import { inspect } from 'node:util';

type LegacyGrantRow = {
  id: string;
  org_id: string;
  patient_id: string;
  active_case_ids: string[];
  active_case_count: string;
  has_supported_case_scope: boolean;
  has_self_report_history: boolean;
};

type Blocker = {
  grant_id: string;
  org_id: string;
  patient_id: string;
  reason: 'no_active_case' | 'multiple_active_cases' | 'unsupported_self_report_history_only';
  active_case_count: number;
};

const connectionString = process.env.DATABASE_URL;
const shouldApply = process.argv.includes('--apply');

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const client = new Client({ connectionString });

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function activeCaseCount(row: Pick<LegacyGrantRow, 'active_case_count'>) {
  return Number(row.active_case_count);
}

function classifyBlocker(row: LegacyGrantRow): Blocker | null {
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

async function findLegacyCaseBackedGrants() {
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

async function backfillAllowedCaseId(grantId: string, caseId: string) {
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

async function main() {
  await client.connect();

  try {
    const legacyGrants = await findLegacyCaseBackedGrants();
    const blockers = legacyGrants.map(classifyBlocker).filter((item): item is Blocker => Boolean(item));
    const backfillable = legacyGrants.filter((row) => !classifyBlocker(row));
    const updatedGrantIds: string[] = [];

    if (shouldApply && blockers.length === 0) {
      for (const row of backfillable) {
        const [caseId] = row.active_case_ids;
        if (!caseId) continue;
        await backfillAllowedCaseId(row.id, caseId);
        updatedGrantIds.push(row.id);
      }
    }

    const ok = blockers.length === 0 && (shouldApply || legacyGrants.length === 0);
    const output = {
      ok,
      mode: shouldApply ? 'apply' : 'dry-run',
      legacy_case_backed_grants: legacyGrants.length,
      backfillable_grants: backfillable.length,
      updated_grants: updatedGrantIds,
      blockers,
      message:
        legacyGrants.length === 0
          ? 'No active legacy case-backed ExternalAccessGrant rows require allowed_case_ids.'
          : shouldApply
            ? blockers.length > 0
              ? 'Apply aborted because legacy grant blockers remain. Resolve blockers, then rerun --apply.'
              : 'Backfilled single-active-case legacy grants.'
            : 'Dry run only. Re-run with --apply to backfill single-active-case grants, then resolve blockers manually.',
    };

    const serialized = JSON.stringify(output, null, ok ? 0 : 2);
    if (ok) {
      console.log(serialized);
    } else {
      console.error(serialized);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

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
