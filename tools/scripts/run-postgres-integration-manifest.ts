import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { parseLocalE2eDatabaseTarget } from './prepare-e2e-db-core';

const MANIFEST_PATH = 'tools/postgres-integration-manifest.json';
const DATABASE_URL_OVERRIDE_ENV = 'POSTGRES_INTEGRATION_DATABASE_URL';
const REQUIRED_SUITES = [
  'src/server/services/standard-clinical-sync-queue.integration.test.ts',
  'src/server/services/first-visit-document-version.integration.test.ts',
  'src/lib/db/display-id.test.ts',
] as const;

export type PostgresIntegrationSuite = {
  path: string;
  database_url_env: string;
  expected_test_count: number;
};

export type PostgresIntegrationManifest = {
  schema_version: 1;
  suites: PostgresIntegrationSuite[];
};

export type VitestJsonResult = {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
};

type RunnerOptions = {
  env?: NodeJS.ProcessEnv;
  manifest?: unknown;
  verifyPreparedSchema?: (databaseUrl: string) => Promise<void>;
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
  if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.suites)) {
    throw new Error('Postgres integration manifest must use schema_version 1 and a suites array');
  }

  const suites = value.suites.map((suite, index): PostgresIntegrationSuite => {
    if (
      !isRecord(suite) ||
      typeof suite.path !== 'string' ||
      typeof suite.database_url_env !== 'string' ||
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

  return { schema_version: 1, suites };
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const databaseUrl = env[DATABASE_URL_OVERRIDE_ENV] ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`${DATABASE_URL_OVERRIDE_ENV} or DATABASE_URL is required`);
  }
  parseLocalE2eDatabaseTarget(databaseUrl, DATABASE_URL_OVERRIDE_ENV);
  return databaseUrl;
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

export async function verifyPreparedE2eSchema(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{
      database_name: string;
      database_user: string;
      schema_name: string;
      migration_count: number;
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_schema() AS schema_name,
        (
          SELECT COUNT(*)::integer
          FROM public._prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS migration_count
    `);
    const row = result.rows[0];
    if (
      !row ||
      row.database_name !== 'ph_os_e2e' ||
      row.database_user !== 'ph_os' ||
      row.schema_name !== 'public' ||
      row.migration_count < 1
    ) {
      throw new Error('Postgres integration schema is not a prepared ph_os_e2e/public database');
    }
  } finally {
    await pool.end();
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
  const databaseUrl = resolveDatabaseUrl(env);
  await (options.verifyPreparedSchema ?? verifyPreparedE2eSchema)(databaseUrl);

  const summaries: Array<{ path: string; testCount: number }> = [];
  for (const suite of manifest.suites) {
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
