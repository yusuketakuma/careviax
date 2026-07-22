import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { parseLocalE2eDatabaseTarget } from './prepare-e2e-db-core';

const MANIFEST_PATH = 'tools/postgres-integration-manifest.json';
const ADMIN_DATABASE_URL_ENV = 'POSTGRES_INTEGRATION_ADMIN_DATABASE_URL';
const RLS_APP_DATABASE_URL_ENV = 'POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL';
const DISPOSABLE_DATABASE_MARKER = 'github-actions-postgres-service';
const REQUIRED_SUITES = [
  'src/server/services/standard-clinical-sync-queue.integration.test.ts',
  'src/server/services/first-visit-document-version.integration.test.ts',
  'src/lib/db/display-id.test.ts',
  'src/app/api/patients/[id]/patient-patch-occ.integration.test.ts',
] as const;

export type PostgresIntegrationDatabaseRole = 'admin' | 'rls_app';

export type PostgresIntegrationSuite = {
  path: string;
  database_url_env: string;
  database_role: PostgresIntegrationDatabaseRole;
  expected_test_count: number;
};

export type PostgresIntegrationManifest = {
  schema_version: 2;
  suites: PostgresIntegrationSuite[];
};

export type VitestJsonResult = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
};

export type PreparedE2eSchemaState = {
  database_name: string;
  database_user: string;
  schema_name: string;
  migration_count: number;
  protected_global_sequence_count: number;
};

export type RlsAppRoleState = {
  database_name: string;
  database_user: string;
  schema_name: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
};

export type PostgresIntegrationDatabaseUrls = {
  adminDatabaseUrl: string;
  rlsAppDatabaseUrl: string;
};

type RunnerOptions = {
  env?: NodeJS.ProcessEnv;
  manifest?: unknown;
  verifyPreparedSchema?: (adminDatabaseUrl: string, rlsAppDatabaseUrl: string) => Promise<void>;
  runSuite?: (
    suite: PostgresIntegrationSuite,
    databaseUrl: string,
    env: NodeJS.ProcessEnv,
  ) => VitestJsonResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateManifest(value: unknown): PostgresIntegrationManifest {
  if (!isRecord(value) || value.schema_version !== 2 || !Array.isArray(value.suites)) {
    throw new Error('Postgres integration manifest must use schema_version 2 and a suites array');
  }

  const suites = value.suites.map((suite, index): PostgresIntegrationSuite => {
    if (
      !isRecord(suite) ||
      typeof suite.path !== 'string' ||
      typeof suite.database_url_env !== 'string' ||
      (suite.database_role !== 'admin' && suite.database_role !== 'rls_app') ||
      !Number.isSafeInteger(suite.expected_test_count) ||
      Number(suite.expected_test_count) < 1
    ) {
      throw new Error(`Postgres integration manifest suite ${index} is invalid`);
    }
    if (!/^[A-Z][A-Z0-9_]*_DATABASE_URL$/.test(suite.database_url_env)) {
      throw new Error(`Invalid database URL environment name for ${suite.path}`);
    }
    return {
      path: suite.path,
      database_url_env: suite.database_url_env,
      database_role: suite.database_role,
      expected_test_count: Number(suite.expected_test_count),
    };
  });

  const paths = suites.map((suite) => suite.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Postgres integration manifest contains duplicate suite paths');
  }
  if (
    paths.length !== REQUIRED_SUITES.length ||
    REQUIRED_SUITES.some((requiredPath) => !paths.includes(requiredPath))
  ) {
    throw new Error(
      `Postgres integration manifest must contain exactly: ${REQUIRED_SUITES.join(', ')}`,
    );
  }

  const rlsAppSuites = suites.filter((suite) => suite.database_role === 'rls_app');
  if (
    rlsAppSuites.length !== 1 ||
    rlsAppSuites[0]?.path !== 'src/app/api/patients/[id]/patient-patch-occ.integration.test.ts'
  ) {
    throw new Error('Patient PATCH OCC must be the single required NOBYPASSRLS integration suite');
  }

  return { schema_version: 2, suites };
}

function resolveSafeDatabaseUrl(args: {
  env: NodeJS.ProcessEnv;
  envName: string;
  expectedUser: 'ph_os' | 'ph_os_app';
}): string {
  const databaseUrl = args.env[args.envName];
  if (!databaseUrl) {
    throw new Error(`${args.envName} is required`);
  }
  const parsed = new URL(databaseUrl);
  if (decodeURIComponent(parsed.username) !== args.expectedUser) {
    throw new Error(`${args.envName} must use the ${args.expectedUser} database role`);
  }
  const safetyCheckUrl = new URL(databaseUrl);
  safetyCheckUrl.username = 'ph_os';
  const target = parseLocalE2eDatabaseTarget(safetyCheckUrl.toString(), args.envName);
  if (target.host !== 'localhost') {
    throw new Error(`${args.envName} must use the literal localhost hostname`);
  }
  return databaseUrl;
}

export function resolveDatabaseUrls(env: NodeJS.ProcessEnv): PostgresIntegrationDatabaseUrls {
  const adminDatabaseUrl = resolveSafeDatabaseUrl({
    env,
    envName: ADMIN_DATABASE_URL_ENV,
    expectedUser: 'ph_os',
  });
  const rlsAppDatabaseUrl = resolveSafeDatabaseUrl({
    env,
    envName: RLS_APP_DATABASE_URL_ENV,
    expectedUser: 'ph_os_app',
  });
  if (adminDatabaseUrl === rlsAppDatabaseUrl) {
    throw new Error('Postgres integration admin and RLS app database URLs must be distinct');
  }
  return { adminDatabaseUrl, rlsAppDatabaseUrl };
}

export function assertDisposableGithubActionsContext(env: NodeJS.ProcessEnv): void {
  const hasNonemptyRunIdentity =
    Boolean(env.GITHUB_RUN_ID?.trim()) && Boolean(env.GITHUB_RUN_ATTEMPT?.trim());
  if (
    env.CI !== 'true' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !hasNonemptyRunIdentity ||
    env.POSTGRES_INTEGRATION_DISPOSABLE_DB !== DISPOSABLE_DATABASE_MARKER
  ) {
    throw new Error(
      'Postgres integration manifest requires the marked disposable GitHub Actions PostgreSQL service context',
    );
  }
}

export function assertSuiteResult(suite: PostgresIntegrationSuite, result: VitestJsonResult): void {
  if (
    !result.success ||
    result.numTotalTests !== suite.expected_test_count ||
    result.numPassedTests !== suite.expected_test_count ||
    result.numFailedTests !== 0 ||
    result.numPendingTests !== 0
  ) {
    throw new Error(
      [
        `${suite.path} did not satisfy its exact integration-test contract.`,
        `expected=${suite.expected_test_count}`,
        `total=${result.numTotalTests}`,
        `passed=${result.numPassedTests}`,
        `failed=${result.numFailedTests}`,
        `skipped=${result.numPendingTests}`,
      ].join(' '),
    );
  }
}

async function queryPreparedE2eSchema(databaseUrl: string): Promise<PreparedE2eSchemaState> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<PreparedE2eSchemaState>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS schema_name,
        (
          SELECT COUNT(*)::integer
          FROM public._prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS migration_count,
        (
          SELECT COUNT(*)::integer
          FROM public.id_sequence
          WHERE org_id = '__global__' AND prefix IN ('bg', 'drug', 'dpv')
        ) AS protected_global_sequence_count
    `);
    const row = result.rows[0];
    if (!row) throw new Error('Postgres integration schema proof returned no rows');
    return row;
  } finally {
    await pool.end();
  }
}

async function queryRlsAppRole(databaseUrl: string): Promise<RlsAppRoleState> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<RlsAppRoleState>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS schema_name,
        role.rolsuper,
        role.rolbypassrls,
        role.rolinherit,
        role.rolcreatedb,
        role.rolcreaterole
      FROM pg_roles AS role
      WHERE role.rolname = current_user
    `);
    const row = result.rows[0];
    if (!row) throw new Error('Postgres integration RLS app role proof returned no rows');
    return row;
  } finally {
    await pool.end();
  }
}

export async function verifyPreparedE2eSchema(
  adminDatabaseUrl: string,
  rlsAppDatabaseUrl: string,
  querySchema: (databaseUrl: string) => Promise<PreparedE2eSchemaState> = queryPreparedE2eSchema,
  queryAppRole: (databaseUrl: string) => Promise<RlsAppRoleState> = queryRlsAppRole,
): Promise<void> {
  const row = await querySchema(adminDatabaseUrl);
  if (
    row.database_name !== 'ph_os_e2e' ||
    row.database_user !== 'ph_os' ||
    row.schema_name !== 'public' ||
    row.migration_count < 1
  ) {
    throw new Error('Postgres integration schema is not a prepared ph_os_e2e/public database');
  }
  if (row.protected_global_sequence_count !== 0) {
    throw new Error(
      'Postgres integration database contains protected pre-existing global display-ID allocator state',
    );
  }

  const role = await queryAppRole(rlsAppDatabaseUrl);
  if (
    role.database_name !== 'ph_os_e2e' ||
    role.database_user !== 'ph_os_app' ||
    role.schema_name !== 'public'
  ) {
    throw new Error('Postgres integration RLS app connection is not ph_os_app on ph_os_e2e/public');
  }
  if (
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolinherit ||
    role.rolcreatedb ||
    role.rolcreaterole
  ) {
    throw new Error(
      'Postgres integration RLS app role must be NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, and NOCREATEROLE',
    );
  }
}

function runVitestSuite(
  suite: PostgresIntegrationSuite,
  databaseUrl: string,
  env: NodeJS.ProcessEnv,
): VitestJsonResult {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'phos-postgres-integration-'));
  const outputFile = join(outputDirectory, 'vitest-result.json');
  try {
    const result = spawnSync(
      'node_modules/.bin/vitest',
      [
        'run',
        suite.path,
        '--reporter=json',
        `--outputFile=${outputFile}`,
        '--maxWorkers=1',
        '--no-file-parallelism',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...env,
          DATABASE_URL: databaseUrl,
          DIRECT_URL: databaseUrl,
          [suite.database_url_env]: databaseUrl,
        },
        encoding: 'utf8',
      },
    );

    if (result.error) throw result.error;
    const parsed = JSON.parse(readFileSync(outputFile, 'utf8')) as VitestJsonResult;
    if (result.status !== 0 && parsed.success) {
      throw new Error(`${suite.path} exited with status ${result.status ?? 'unknown'}`);
    }
    return parsed;
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export async function runPostgresIntegrationManifest(options: RunnerOptions = {}) {
  const env = options.env ?? process.env;
  const manifest = validateManifest(
    options.manifest ?? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
  );
  assertDisposableGithubActionsContext(env);
  const { adminDatabaseUrl, rlsAppDatabaseUrl } = resolveDatabaseUrls(env);
  await (options.verifyPreparedSchema ?? verifyPreparedE2eSchema)(
    adminDatabaseUrl,
    rlsAppDatabaseUrl,
  );

  const summaries: Array<{ path: string; testCount: number }> = [];
  for (const suite of manifest.suites) {
    const databaseUrl = suite.database_role === 'rls_app' ? rlsAppDatabaseUrl : adminDatabaseUrl;
    const result = (options.runSuite ?? runVitestSuite)(suite, databaseUrl, env);
    assertSuiteResult(suite, result);
    summaries.push({ path: suite.path, testCount: result.numPassedTests });
  }
  return summaries;
}

async function main() {
  const summaries = await runPostgresIntegrationManifest();
  const total = summaries.reduce((sum, summary) => sum + summary.testCount, 0);
  console.log(
    `Postgres integration manifest passed: suites=${summaries.length}, tests=${total}, skipped=0`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
