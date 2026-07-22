import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  assertDisposableGithubActionsContext,
  assertSuiteResult,
  resolveDatabaseUrls,
  runPostgresIntegrationManifest,
  validateManifest,
  verifyPreparedE2eSchema,
  type PostgresIntegrationManifest,
  type VitestJsonResult,
} from './run-postgres-integration-manifest';

const SAFE_ADMIN_URL = 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';
const SAFE_APP_URL = 'postgresql://ph_os_app:ph_os_app@localhost:5433/ph_os_e2e?schema=public';
const DISPOSABLE_CI_ENV = {
  NODE_ENV: 'test',
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '123456789',
  GITHUB_RUN_ATTEMPT: '1',
  POSTGRES_INTEGRATION_DISPOSABLE_DB: 'github-actions-postgres-service',
  POSTGRES_INTEGRATION_ADMIN_DATABASE_URL: SAFE_ADMIN_URL,
  POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL: SAFE_APP_URL,
} satisfies NodeJS.ProcessEnv;
const MANIFEST = JSON.parse(
  readFileSync('tools/postgres-integration-manifest.json', 'utf8'),
) as unknown;

function passingResult(testCount: number): VitestJsonResult {
  return {
    success: true,
    numTotalTests: testCount,
    numPassedTests: testCount,
    numFailedTests: 0,
    numPendingTests: 0,
  };
}

describe('run-postgres-integration-manifest', () => {
  it('requires the exact four registered integration suites, roles, and counts', () => {
    expect(validateManifest(MANIFEST)).toEqual({
      schema_version: 2,
      suites: [
        {
          path: 'src/server/services/standard-clinical-sync-queue.integration.test.ts',
          database_url_env: 'CLINICAL_SYNC_QUEUE_DATABASE_URL',
          database_role: 'admin',
          expected_test_count: 1,
        },
        {
          path: 'src/server/services/first-visit-document-version.integration.test.ts',
          database_url_env: 'FIRST_VISIT_DOCUMENT_VERSION_DATABASE_URL',
          database_role: 'admin',
          expected_test_count: 9,
        },
        {
          path: 'src/lib/db/display-id.test.ts',
          database_url_env: 'DISPLAY_ID_DATABASE_URL',
          database_role: 'admin',
          expected_test_count: 27,
        },
        {
          path: 'src/app/api/patients/[id]/patient-patch-occ.integration.test.ts',
          database_url_env: 'PATIENT_PATCH_OCC_DATABASE_URL',
          database_role: 'rls_app',
          expected_test_count: 5,
        },
      ],
    });

    const incomplete = structuredClone(MANIFEST) as PostgresIntegrationManifest;
    incomplete.suites.pop();
    expect(() => validateManifest(incomplete)).toThrow(/must contain exactly/);

    const vacuous = structuredClone(MANIFEST) as PostgresIntegrationManifest;
    vacuous.suites[3]!.database_role = 'admin';
    expect(() => validateManifest(vacuous)).toThrow(/single required NOBYPASSRLS/);
  });

  it.each([
    'postgresql://ph_os:ph_os@db.internal:5433/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5432/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5433/ph_os?schema=public',
    'postgresql://postgres:postgres@localhost:5433/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=private',
    'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@[::1]:5433/ph_os_e2e?schema=public',
  ])('rejects unsafe database target %s', (databaseUrl) => {
    expect(() =>
      resolveDatabaseUrls({
        NODE_ENV: 'test',
        POSTGRES_INTEGRATION_ADMIN_DATABASE_URL: databaseUrl,
        POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL: SAFE_APP_URL,
      }),
    ).toThrow(
      /must (?:point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e|use the literal localhost|use the ph_os database role)/,
    );
  });

  it('accepts distinct admin and NOBYPASSRLS app URLs only on literal localhost', () => {
    expect(
      resolveDatabaseUrls({
        NODE_ENV: 'test',
        POSTGRES_INTEGRATION_ADMIN_DATABASE_URL: SAFE_ADMIN_URL,
        POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL: SAFE_APP_URL,
      }),
    ).toEqual({ adminDatabaseUrl: SAFE_ADMIN_URL, rlsAppDatabaseUrl: SAFE_APP_URL });

    expect(() =>
      resolveDatabaseUrls({
        NODE_ENV: 'test',
        POSTGRES_INTEGRATION_ADMIN_DATABASE_URL: SAFE_ADMIN_URL,
        POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL:
          'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      }),
    ).toThrow(/must use the ph_os_app database role/);
    expect(() =>
      resolveDatabaseUrls({
        NODE_ENV: 'test',
        POSTGRES_INTEGRATION_ADMIN_DATABASE_URL: SAFE_ADMIN_URL,
        POSTGRES_INTEGRATION_RLS_APP_DATABASE_URL:
          'postgresql://ph_os_app:ph_os_app@127.0.0.1:5433/ph_os_e2e?schema=public',
      }),
    ).toThrow(/literal localhost/);
  });

  it.each([
    ['CI'],
    ['GITHUB_ACTIONS'],
    ['GITHUB_RUN_ID'],
    ['GITHUB_RUN_ATTEMPT'],
    ['POSTGRES_INTEGRATION_DISPOSABLE_DB'],
  ])('rejects a disposable CI proof missing %s', (missingKey) => {
    const env = { ...DISPOSABLE_CI_ENV };
    delete env[missingKey as keyof typeof env];
    expect(() => assertDisposableGithubActionsContext(env)).toThrow(/disposable GitHub Actions/);
  });

  it('rejects spoof-incomplete or incorrect disposable service markers', () => {
    expect(() =>
      assertDisposableGithubActionsContext({
        ...DISPOSABLE_CI_ENV,
        GITHUB_RUN_ID: ' ',
      }),
    ).toThrow(/disposable GitHub Actions/);
    expect(() =>
      assertDisposableGithubActionsContext({
        ...DISPOSABLE_CI_ENV,
        POSTGRES_INTEGRATION_DISPOSABLE_DB: 'local-postgres',
      }),
    ).toThrow(/disposable GitHub Actions/);
  });

  it('rejects prepared schemas containing protected global allocator state', async () => {
    await expect(
      verifyPreparedE2eSchema(
        SAFE_ADMIN_URL,
        SAFE_APP_URL,
        async () => ({
          database_name: 'ph_os_e2e',
          database_user: 'ph_os',
          schema_name: 'public',
          migration_count: 100,
          protected_global_sequence_count: 1,
        }),
        async () => ({
          database_name: 'ph_os_e2e',
          database_user: 'ph_os_app',
          schema_name: 'public',
          rolsuper: false,
          rolbypassrls: false,
          rolinherit: false,
          rolcreatedb: false,
          rolcreaterole: false,
        }),
      ),
    ).rejects.toThrow(/protected pre-existing global display-ID allocator state/);
  });

  it.each([
    [
      {
        rolsuper: true,
        rolbypassrls: false,
        rolinherit: false,
        rolcreatedb: false,
        rolcreaterole: false,
      },
      'NOSUPERUSER',
    ],
    [
      {
        rolsuper: false,
        rolbypassrls: true,
        rolinherit: false,
        rolcreatedb: false,
        rolcreaterole: false,
      },
      'NOBYPASSRLS',
    ],
    [
      {
        rolsuper: false,
        rolbypassrls: false,
        rolinherit: true,
        rolcreatedb: false,
        rolcreaterole: false,
      },
      'NOINHERIT',
    ],
  ])('rejects a vacuous RLS app role %#', async (attributes, expectedMessage) => {
    await expect(
      verifyPreparedE2eSchema(
        SAFE_ADMIN_URL,
        SAFE_APP_URL,
        async () => ({
          database_name: 'ph_os_e2e',
          database_user: 'ph_os',
          schema_name: 'public',
          migration_count: 100,
          protected_global_sequence_count: 0,
        }),
        async () => ({
          database_name: 'ph_os_e2e',
          database_user: 'ph_os_app',
          schema_name: 'public',
          ...attributes,
        }),
      ),
    ).rejects.toThrow(expectedMessage);
  });

  it('fails closed on count drift, failures, and skips', () => {
    const suite = validateManifest(MANIFEST).suites[0];
    expect(() => assertSuiteResult(suite, passingResult(2))).toThrow(/expected=1/);
    expect(() =>
      assertSuiteResult(suite, {
        ...passingResult(1),
        success: false,
        numPassedTests: 0,
        numFailedTests: 1,
      }),
    ).toThrow(/failed=1/);
    expect(() =>
      assertSuiteResult(suite, {
        ...passingResult(1),
        numPassedTests: 0,
        numPendingTests: 1,
      }),
    ).toThrow(/skipped=1/);
  });

  it('verifies preparation first and executes manifest suites serially with exact counts', async () => {
    const order: string[] = [];
    const verifyPreparedSchema = vi.fn(async () => {
      order.push('prepared');
    });
    const selectedUrls: string[] = [];
    const runSuite = vi.fn((suite: { path: string; expected_test_count: number }, url: string) => {
      order.push(suite.path);
      selectedUrls.push(url);
      return passingResult(suite.expected_test_count);
    });

    await expect(
      runPostgresIntegrationManifest({
        env: DISPOSABLE_CI_ENV,
        manifest: MANIFEST,
        verifyPreparedSchema,
        runSuite,
      }),
    ).resolves.toEqual([
      {
        path: 'src/server/services/standard-clinical-sync-queue.integration.test.ts',
        testCount: 1,
      },
      {
        path: 'src/server/services/first-visit-document-version.integration.test.ts',
        testCount: 9,
      },
      { path: 'src/lib/db/display-id.test.ts', testCount: 27 },
      {
        path: 'src/app/api/patients/[id]/patient-patch-occ.integration.test.ts',
        testCount: 5,
      },
    ]);
    expect(order).toEqual([
      'prepared',
      'src/server/services/standard-clinical-sync-queue.integration.test.ts',
      'src/server/services/first-visit-document-version.integration.test.ts',
      'src/lib/db/display-id.test.ts',
      'src/app/api/patients/[id]/patient-patch-occ.integration.test.ts',
    ]);
    expect(verifyPreparedSchema).toHaveBeenCalledWith(SAFE_ADMIN_URL, SAFE_APP_URL);
    expect(selectedUrls).toEqual([SAFE_ADMIN_URL, SAFE_ADMIN_URL, SAFE_ADMIN_URL, SAFE_APP_URL]);
  });

  it('does not run any suite when the prepared-schema proof fails', async () => {
    const runSuite = vi.fn();
    await expect(
      runPostgresIntegrationManifest({
        env: DISPOSABLE_CI_ENV,
        manifest: MANIFEST,
        verifyPreparedSchema: async () => {
          throw new Error('schema is not prepared');
        },
        runSuite,
      }),
    ).rejects.toThrow(/not prepared/);
    expect(runSuite).not.toHaveBeenCalled();
  });
});
