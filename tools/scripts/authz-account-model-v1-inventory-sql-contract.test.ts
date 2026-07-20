import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client, type QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseLocalE2eDatabaseTarget } from './prepare-e2e-db-core';

const SQL_PATH = 'tools/sql/authz-account-model-v1-inventory.sql';
const sql = readFileSync(SQL_PATH, 'utf8');
const aggregateSql = executableStatements(sql)[3];
const rawMetricsSql = aggregateSql.replace(
  /,\nsafe_metrics AS \([\s\S]*$/,
  '\nSELECT metric, category, count_value FROM raw_metrics ORDER BY metric, category',
);
const localDatabaseUrl =
  process.env.AUTHZ_ACCOUNT_MODEL_TEST_DATABASE_URL ??
  'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public';
const OUTPUT_KEYS = ['metric', 'category', 'observed_count', 'count_band'];
const APPROVED_AGGREGATE_SHA256 =
  'f8e3290312e4bc42a9d46d6c7c5e30f6f223d74405a904066dd76c5ee96793ae';
const ALLOWED_RELATIONS = new Set([
  'Membership',
  'PharmacistCredential',
  'PlatformOperator',
  'User',
  'legacy_role_capabilities',
  'membership_groups',
  'raw_metrics',
  'safe_metrics',
]);
const ALLOWED_FUNCTIONS = new Set([
  'AS',
  'AND',
  'BTRIM',
  'COUNT',
  'FILTER',
  'NULLIF',
  'VALUES',
  'legacy_role_capabilities',
  'raw_metrics',
]);
const ALLOWED_QUOTED_COLUMNS = new Set([
  'can_audit_dispense',
  'can_audit_set',
  'can_dispense',
  'can_set',
  'certification_number',
  'certification_type',
  'expiry_date',
  'id',
  'is_active',
  'issued_date',
  'org_id',
  'role',
  'site_id',
  'user_id',
]);
const APPROVED_CATEGORY_DOMAIN = new Map<string, Set<string>>([
  [
    'tenant_role_distribution',
    new Set([
      'owner',
      'admin',
      'pharmacist',
      'pharmacist_trainee',
      'clerk',
      'driver',
      'external_viewer',
    ]),
  ],
  ['platform_role_distribution', new Set(['platform_support', 'platform_admin', 'platform_owner'])],
  [
    'membership_anomaly',
    new Set([
      'mixed_active_roles',
      'duplicate_null_site_rows',
      'multiple_active_sites',
      'role_flag_mismatch',
    ]),
  ],
  [
    'identity_orphan',
    new Set([
      'membership_missing_user',
      'membership_user_org_mismatch',
      'active_user_without_active_membership',
      'platform_operator_missing_user',
      'credential_missing_user',
    ]),
  ],
  [
    'legacy_credential_completeness',
    new Set([
      'missing_type',
      'missing_number',
      'missing_issued_date',
      'missing_expiry_date',
      'all_legacy_fields_present_noncanonical',
    ]),
  ],
]);

function executableStatements(value: string) {
  return value
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function assertSqlSafety(candidate: string) {
  const statements = executableStatements(candidate);
  if (statements.length !== 5) throw new Error('SQL must contain exactly five statements');
  if (!/^BEGIN TRANSACTION READ ONLY$/i.test(statements[0])) {
    throw new Error('SQL must begin with a read-only transaction');
  }
  if (!/^SET LOCAL statement_timeout = '5s'$/i.test(statements[1])) {
    throw new Error('statement timeout missing');
  }
  if (!/^SET LOCAL lock_timeout = '1s'$/i.test(statements[2])) {
    throw new Error('lock timeout missing');
  }
  if (!/^WITH[\s\S]+SELECT metric, category, observed_count, count_band/i.test(statements[3])) {
    throw new Error('aggregate statement shape drift');
  }
  if (!/^COMMIT$/i.test(statements[4]))
    throw new Error('SQL must commit the read-only transaction');

  const aggregate = statements[3];
  if (/\/\*/.test(aggregate)) throw new Error('block comments are prohibited');
  const aggregateSha256 = createHash('sha256')
    .update(aggregate.replace(/\s+/g, ' ').trim())
    .digest('hex');
  if (aggregateSha256 !== APPROVED_AGGREGATE_SHA256) {
    throw new Error('aggregate query is outside the approved exact contract');
  }
  if (
    /\b(?:ALTER|CALL|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|LISTEN|LOCK|MERGE|NOTIFY|REFRESH|REINDEX|REVOKE|TRUNCATE|UPDATE|VACUUM)\b/i.test(
      aggregate,
    )
  ) {
    throw new Error('mutation or utility statement is prohibited');
  }
  if (/\bWITH\s+\w+\s+AS\s*\(\s*(?:INSERT|UPDATE|DELETE|MERGE)\b/i.test(aggregate)) {
    throw new Error('data-modifying CTE is prohibited');
  }
  if (/SELECT\s+\*/i.test(aggregate)) throw new Error('wildcard output is prohibited');

  const relations = [
    ...aggregate.matchAll(/\b(?:FROM|JOIN)\s+(?:"([A-Za-z0-9_]+)"|([a-z_][a-z0-9_]*))/gi),
  ]
    .filter(
      (match) => !/DISTINCT\s+$/i.test(aggregate.slice(Math.max(0, match.index - 16), match.index)),
    )
    .map((match) => match[1] ?? match[2]);
  for (const relation of relations) {
    if (!ALLOWED_RELATIONS.has(relation)) throw new Error(`unapproved relation: ${relation}`);
  }

  const functions = [...aggregate.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(
    (match) => match[1],
  );
  for (const fn of functions) {
    if (!ALLOWED_FUNCTIONS.has(fn.toUpperCase()) && !ALLOWED_FUNCTIONS.has(fn)) {
      throw new Error(`unapproved SQL function: ${fn}`);
    }
  }

  for (const match of aggregate.matchAll(/"([A-Za-z0-9_]+)"/g)) {
    const identifier = match[1];
    if (!ALLOWED_RELATIONS.has(identifier) && !ALLOWED_QUOTED_COLUMNS.has(identifier)) {
      throw new Error(`unapproved quoted identifier: ${identifier}`);
    }
  }

  const finalProjection = aggregate.match(
    /SELECT metric, category, observed_count, count_band\s+FROM safe_metrics/i,
  )?.[0];
  if (!finalProjection) throw new Error('final output projection drift');
  if (/user_id|org_id|site_id|certification_number/i.test(finalProjection)) {
    throw new Error('identifier-bearing output is prohibited');
  }
  if (!aggregate.includes("count_value < 5 THEN '1-4'")) {
    throw new Error('small-cell suppression missing');
  }
}

function assertApprovedCategoryDomain(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const metric = String(row.metric);
    const category = String(row.category);
    const categories = APPROVED_CATEGORY_DOMAIN.get(metric);
    if (!categories?.has(category)) {
      throw new Error(`unapproved metric/category output: ${metric}/${category}`);
    }
  }
}

function selectResult(result: QueryResult | QueryResult[]) {
  const results = Array.isArray(result) ? result : [result];
  const selected = results.find((entry) => entry.command === 'SELECT');
  if (!selected) throw new Error('aggregate SELECT result is missing');
  return selected;
}

describe('authz account model v1 inventory SQL contract', () => {
  it('rejects remote or noncanonical fixture database targets before DML', () => {
    for (const unsafeUrl of [
      'postgresql://ph_os:ph_os@db.internal:5433/ph_os_e2e?schema=public',
      'postgresql://ph_os:ph_os@localhost:5432/ph_os_e2e?schema=public',
      'postgresql://postgres:postgres@localhost:5433/ph_os_e2e?schema=public',
      'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=private',
      'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public&host=example.invalid',
    ]) {
      expect(() =>
        parseLocalE2eDatabaseTarget(unsafeUrl, 'AUTHZ_ACCOUNT_MODEL_TEST_DATABASE_URL'),
      ).toThrow(/must point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e/);
    }
  });
  it('is a strict bounded aggregate allowlist', () => {
    expect(() => assertSqlSafety(sql)).not.toThrow();
  });

  it('rejects utility, volatile, privileged, custom, and output mutations', () => {
    const unsafeCandidates = [
      sql.replace('COUNT(*)::bigint', 'pg_advisory_lock(1)::bigint'),
      sql.replace('COUNT(*)::bigint', "pg_read_file('/etc/passwd')::bigint"),
      sql.replace('COUNT(*)::bigint', "nextval('unsafe')::bigint"),
      sql.replace('COUNT(*)::bigint', "pg_notify('unsafe', 'value')::bigint"),
      sql.replace('COUNT(*)::bigint', 'custom_inventory_udf()::bigint'),
      sql.replace("SET LOCAL statement_timeout = '5s';", ''),
      sql.replace(
        'WITH\nlegacy_role_capabilities',
        'WITH changed AS (DELETE FROM "User" RETURNING *),\nlegacy_role_capabilities',
      ),
      sql.replace(
        'SELECT metric, category, observed_count, count_band',
        'SELECT metric, category, observed_count, count_band, user_id',
      ),
      sql.replace('COMMIT;', 'CALL unsafe();\nCOMMIT;'),
      sql.replace('COMMIT;', 'DO $$ BEGIN NULL; END $$;\nCOMMIT;'),
      sql.replace('COMMIT;', 'COPY "User" TO STDOUT;\nCOMMIT;'),
      sql.replace('"role"::text', 'app_user."name"'),
      sql.replace('"role"::text', 'membership."user_id"'),
      sql.replace('"role"::text', 'app_user."email"'),
      sql.replace('"role"::text', 'app_user."cognito_sub"'),
      sql.replace(
        "  UNION ALL\n\n  SELECT\n    'platform_role_distribution'",
        "  UNION ALL\n\n  SELECT 'identity_orphan', 'extra_branch', COUNT(*)::bigint FROM \"User\"\n\n  UNION ALL\n\n  SELECT\n    'platform_role_distribution'",
      ),
      sql.replace(
        "    'tenant_role_distribution',",
        "    /* category */ 'tenant_role_distribution',",
      ),
    ];
    for (const candidate of unsafeCandidates) {
      expect(() => assertSqlSafety(candidate)).toThrow();
    }
  });

  it('never treats legacy credential completeness as qualification authority', () => {
    expect(sql).toContain("'all_legacy_fields_present_noncanonical'");
    expect(sql).not.toMatch(/\b(?:qualified|verified|current|licensed|authorized)\b/i);
  });
});

describe.sequential('authz account model v1 inventory PostgreSQL proof', () => {
  let client: Client;
  let connected = false;
  let migratedRows: Array<Record<string, unknown>> = [];
  let migratedFixtureRows: Array<Record<string, unknown>> = [];
  let migratedFixtureDeltas: Array<{ metric: string; category: string; delta: number }> = [];
  let rollbackResidueCount = -1;
  let migratedColumns: Array<{ table_name: string; column_name: string }> = [];

  beforeAll(async () => {
    parseLocalE2eDatabaseTarget(localDatabaseUrl, 'AUTHZ_ACCOUNT_MODEL_TEST_DATABASE_URL');
    client = new Client({ connectionString: localDatabaseUrl });
    await client.connect();
    connected = true;
    await client.query('SET search_path TO public');
    migratedColumns = (
      await client.query<{ table_name: string; column_name: string }>(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('User', 'Membership', 'PharmacistCredential', 'PlatformOperator')
        ORDER BY table_name, ordinal_position
      `)
    ).rows;
    migratedRows = selectResult(await client.query(sql)).rows as Array<Record<string, unknown>>;

    const fixturePrefix = `authz-fixture-${randomUUID()}`;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      const baselineRawRows = (
        await client.query<{ metric: string; category: string; count_value: string }>(rawMetricsSql)
      ).rows;
      const fixtureSql = `
        INSERT INTO "Organization" ("id", "name", "updated_at") VALUES
          ('authz-fixture-org-a', 'Authz Fixture A', now()),
          ('authz-fixture-org-b', 'Authz Fixture B', now());
        INSERT INTO "PharmacySite" ("id", "org_id", "name", "address", "updated_at") VALUES
          ('authz-fixture-site-a', 'authz-fixture-org-a', 'Fixture Site A', 'Synthetic', now()),
          ('authz-fixture-site-b', 'authz-fixture-org-a', 'Fixture Site B', 'Synthetic', now());
        INSERT INTO "User" ("id", "org_id", "cognito_sub", "email", "name", "is_active", "updated_at") VALUES
          ('authz-fixture-u1', 'authz-fixture-org-a', 'authz-fixture-sub-1', 'authz-fixture-1@example.invalid', 'Fixture One', true, now()),
          ('authz-fixture-u2', 'authz-fixture-org-a', 'authz-fixture-sub-2', 'authz-fixture-2@example.invalid', 'Fixture Two', true, now()),
          ('authz-fixture-u3', 'authz-fixture-org-b', 'authz-fixture-sub-3', 'authz-fixture-3@example.invalid', 'Fixture Three', true, now()),
          ('authz-fixture-u4', 'authz-fixture-org-b', 'authz-fixture-sub-4', 'authz-fixture-4@example.invalid', 'Fixture Four', false, now());
        INSERT INTO "Membership" (
          "id", "user_id", "org_id", "site_id", "role", "can_dispense",
          "can_audit_dispense", "can_set", "can_audit_set", "is_active", "updated_at"
        ) VALUES
          ('authz-fixture-m1', 'authz-fixture-u1', 'authz-fixture-org-a', NULL, 'owner', true, true, true, true, true, now()),
          ('authz-fixture-m2', 'authz-fixture-u1', 'authz-fixture-org-a', NULL, 'admin', true, false, true, true, true, now()),
          ('authz-fixture-m3', 'authz-fixture-u1', 'authz-fixture-org-a', 'authz-fixture-site-a', 'pharmacist', true, true, true, true, true, now()),
          ('authz-fixture-m4', 'authz-fixture-u1', 'authz-fixture-org-a', 'authz-fixture-site-b', 'pharmacist', true, true, true, true, true, now()),
          ('authz-fixture-m5', 'authz-fixture-u3', 'authz-fixture-org-a', NULL, 'external_viewer', false, false, false, false, true, now()),
          ('authz-fixture-m6', 'authz-fixture-u4', 'authz-fixture-org-b', NULL, 'clerk', false, false, false, false, true, now());
        INSERT INTO "PharmacistCredential" (
          "id", "org_id", "user_id", "certification_type", "certification_number",
          "issued_date", "expiry_date", "updated_at"
        ) VALUES
          ('authz-fixture-c1', 'authz-fixture-org-a', 'authz-fixture-u1', 'training', 'synthetic-1', '2025-01-01', '2027-01-01', now()),
          ('authz-fixture-c2', 'authz-fixture-org-a', 'authz-fixture-u1', 'training', NULL, NULL, NULL, now()),
          ('authz-fixture-c3', 'authz-fixture-org-b', 'authz-fixture-u3', 'training', 'synthetic-3', NULL, NULL, now());
        INSERT INTO "PlatformOperator" ("id", "user_id", "role", "updated_at") VALUES
          ('authz-fixture-p1', 'authz-fixture-missing-user', 'platform_admin', now()),
          ('authz-fixture-p2', 'authz-fixture-u1', 'platform_support', now()),
          ('authz-fixture-p3', 'authz-fixture-u2', 'platform_admin', now()),
          ('authz-fixture-p4', 'authz-fixture-u3', 'platform_owner', now());
      `.replaceAll('authz-fixture', fixturePrefix);
      await client.query(fixtureSql);
      migratedFixtureRows = (await client.query(aggregateSql)).rows as Array<
        Record<string, unknown>
      >;
      const fixtureRawRows = (
        await client.query<{ metric: string; category: string; count_value: string }>(rawMetricsSql)
      ).rows;
      const baselineCounts = new Map(
        baselineRawRows.map((row) => [`${row.metric}:${row.category}`, BigInt(row.count_value)]),
      );
      migratedFixtureDeltas = fixtureRawRows
        .map((row) => ({
          metric: row.metric,
          category: row.category,
          delta: Number(
            BigInt(row.count_value) -
              (baselineCounts.get(`${row.metric}:${row.category}`) ?? BigInt(0)),
          ),
        }))
        .filter((row) => row.delta !== 0);
    } finally {
      await client.query('ROLLBACK');
    }
    rollbackResidueCount = Number(
      (
        await client.query<{ count: string }>(
          `
            SELECT SUM(count)::text AS count
            FROM (
              SELECT COUNT(*) AS count FROM "Organization" WHERE "id" LIKE $1
              UNION ALL SELECT COUNT(*) FROM "PharmacySite" WHERE "id" LIKE $1
              UNION ALL SELECT COUNT(*) FROM "User" WHERE "id" LIKE $1
              UNION ALL SELECT COUNT(*) FROM "Membership" WHERE "id" LIKE $1
              UNION ALL SELECT COUNT(*) FROM "PharmacistCredential" WHERE "id" LIKE $1
              UNION ALL SELECT COUNT(*) FROM "PlatformOperator" WHERE "id" LIKE $1
            ) residue
          `,
          [`${fixturePrefix}%`],
        )
      ).rows[0].count,
    );

    await client.query(`
      SET search_path TO pg_temp;
      CREATE TEMP TABLE "User" (
        "id" text PRIMARY KEY,
        "org_id" text NOT NULL,
        "is_active" boolean NOT NULL
      );
      CREATE TEMP TABLE "Membership" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "org_id" text NOT NULL,
        "site_id" text,
        "role" text NOT NULL,
        "can_dispense" boolean NOT NULL,
        "can_audit_dispense" boolean NOT NULL,
        "can_set" boolean NOT NULL,
        "can_audit_set" boolean NOT NULL,
        "is_active" boolean NOT NULL
      );
      CREATE TEMP TABLE "PharmacistCredential" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "certification_type" text NOT NULL,
        "certification_number" text,
        "issued_date" timestamp,
        "expiry_date" timestamp
      );
      CREATE TEMP TABLE "PlatformOperator" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "role" text NOT NULL
      );
      INSERT INTO "Membership" VALUES
        ('m-orphan', 'missing-user', 'org-a', NULL, 'external_viewer', false, false, false, false, true);
      INSERT INTO "PharmacistCredential" VALUES
        ('c-orphan', 'missing-user', 'training', 'synthetic', NULL, NULL);
    `);
  }, 60_000);

  afterAll(async () => {
    if (connected) await client.end();
  });

  it('compiles and executes read-only against the actual migrated e2e schema', () => {
    const columns = new Set(
      migratedColumns.map((entry) => `${entry.table_name}.${entry.column_name}`),
    );
    for (const required of [
      'User.id',
      'User.org_id',
      'Membership.role',
      'Membership.site_id',
      'PharmacistCredential.certification_type',
      'PlatformOperator.role',
    ]) {
      expect(columns.has(required)).toBe(true);
    }
    expect(migratedRows.length).toBeGreaterThanOrEqual(9);
    expect(migratedRows.every((row) => Object.keys(row).join(',') === OUTPUT_KEYS.join(','))).toBe(
      true,
    );
    expect(JSON.stringify(migratedRows)).not.toMatch(
      /@|cognito|patient|phone|address|certification_number|user_id|org_id|site_id/i,
    );
    expect(() => assertApprovedCategoryDomain(migratedRows)).not.toThrow();
  });

  it('produces exact schema-valid metric deltas from migrated tables', () => {
    expect(migratedFixtureDeltas).toEqual([
      { metric: 'identity_orphan', category: 'active_user_without_active_membership', delta: 2 },
      { metric: 'identity_orphan', category: 'membership_user_org_mismatch', delta: 1 },
      { metric: 'identity_orphan', category: 'platform_operator_missing_user', delta: 1 },
      {
        metric: 'legacy_credential_completeness',
        category: 'all_legacy_fields_present_noncanonical',
        delta: 1,
      },
      { metric: 'legacy_credential_completeness', category: 'missing_issued_date', delta: 1 },
      { metric: 'legacy_credential_completeness', category: 'missing_number', delta: 1 },
      { metric: 'membership_anomaly', category: 'duplicate_null_site_rows', delta: 1 },
      { metric: 'membership_anomaly', category: 'mixed_active_roles', delta: 1 },
      { metric: 'membership_anomaly', category: 'multiple_active_sites', delta: 1 },
      { metric: 'membership_anomaly', category: 'role_flag_mismatch', delta: 1 },
      { metric: 'platform_role_distribution', category: 'platform_admin', delta: 2 },
      { metric: 'platform_role_distribution', category: 'platform_owner', delta: 1 },
      { metric: 'platform_role_distribution', category: 'platform_support', delta: 1 },
      { metric: 'tenant_role_distribution', category: 'admin', delta: 1 },
      { metric: 'tenant_role_distribution', category: 'clerk', delta: 1 },
      { metric: 'tenant_role_distribution', category: 'external_viewer', delta: 1 },
      { metric: 'tenant_role_distribution', category: 'owner', delta: 1 },
      { metric: 'tenant_role_distribution', category: 'pharmacist', delta: 2 },
    ]);
    expect(
      migratedFixtureRows.every((row) => Object.keys(row).join(',') === OUTPUT_KEYS.join(',')),
    ).toBe(true);
    expect(JSON.stringify(migratedFixtureRows)).not.toMatch(/authz-fixture|example\.invalid/);
    expect(() => assertApprovedCategoryDomain(migratedFixtureRows)).not.toThrow();
    for (const staleCategory of ['support_agent', 'auditor']) {
      expect(() =>
        assertApprovedCategoryDomain([
          { metric: 'platform_role_distribution', category: staleCategory },
        ]),
      ).toThrow(/unapproved metric\/category output/);
    }
    expect(rollbackResidueCount).toBe(0);
  });

  it('uses a separately labelled isolated anomaly fixture for impossible FK orphan states', async () => {
    const rows = selectResult(await client.query(sql)).rows as Array<Record<string, unknown>>;
    const suppressed = (metric: string, category: string) => ({
      metric,
      category,
      observed_count: null,
      count_band: '1-4',
    });
    expect(
      rows.filter(
        (row) =>
          row.metric === 'identity_orphan' &&
          ['credential_missing_user', 'membership_missing_user'].includes(String(row.category)),
      ),
    ).toEqual([
      suppressed('identity_orphan', 'credential_missing_user'),
      suppressed('identity_orphan', 'membership_missing_user'),
    ]);
    expect(rows.every((row) => Object.keys(row).join(',') === OUTPUT_KEYS.join(','))).toBe(true);
    expect(() => assertApprovedCategoryDomain(rows)).not.toThrow();
    expect(JSON.stringify(rows)).not.toMatch(/u1|u2|u3|u4|org-a|org-b|site-a|site-b|legacy-[13]/);
  });
});
