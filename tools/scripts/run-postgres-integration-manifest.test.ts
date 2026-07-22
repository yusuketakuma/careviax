import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSuiteResult,
  resolveDatabaseUrl,
  runPostgresIntegrationManifest,
  validateManifest,
  type PostgresIntegrationManifest,
  type VitestJsonResult,
} from './run-postgres-integration-manifest';

const SAFE_URL = 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';
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
  it('requires the exact three registered integration suites and counts', () => {
    expect(validateManifest(MANIFEST)).toEqual({
      schema_version: 1,
      suites: [
        {
          path: 'src/server/services/standard-clinical-sync-queue.integration.test.ts',
          database_url_env: 'CLINICAL_SYNC_QUEUE_DATABASE_URL',
          expected_test_count: 1,
        },
        {
          path: 'src/server/services/first-visit-document-version.integration.test.ts',
          database_url_env: 'FIRST_VISIT_DOCUMENT_VERSION_DATABASE_URL',
          expected_test_count: 9,
        },
        {
          path: 'src/lib/db/display-id.test.ts',
          database_url_env: 'DISPLAY_ID_DATABASE_URL',
          expected_test_count: 27,
        },
      ],
    });

    const incomplete = structuredClone(MANIFEST) as PostgresIntegrationManifest;
    incomplete.suites.pop();
    expect(() => validateManifest(incomplete)).toThrow(/must contain exactly/);
  });

  it.each([
    'postgresql://ph_os:ph_os@db.internal:5433/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5432/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5433/ph_os?schema=public',
    'postgresql://postgres:postgres@localhost:5433/ph_os_e2e?schema=public',
    'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=private',
  ])('rejects unsafe database target %s', (databaseUrl) => {
    expect(() => resolveDatabaseUrl({ POSTGRES_INTEGRATION_DATABASE_URL: databaseUrl })).toThrow(
      /must point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e/,
    );
  });

  it('accepts localhost aliases and gives the dedicated override precedence', () => {
    expect(
      resolveDatabaseUrl({
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://ph_os:ph_os@[::1]:5433/ph_os_e2e?schema=public',
        DATABASE_URL: 'postgresql://ph_os:ph_os@db.internal:5432/production',
      }),
    ).toContain('[::1]:5433/ph_os_e2e');
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public',
      }),
    ).toContain('127.0.0.1:5433/ph_os_e2e');
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
    const runSuite = vi.fn((suite: { path: string; expected_test_count: number }) => {
      order.push(suite.path);
      return passingResult(suite.expected_test_count);
    });

    await expect(
      runPostgresIntegrationManifest({
        env: { POSTGRES_INTEGRATION_DATABASE_URL: SAFE_URL },
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
    ]);
    expect(order).toEqual([
      'prepared',
      'src/server/services/standard-clinical-sync-queue.integration.test.ts',
      'src/server/services/first-visit-document-version.integration.test.ts',
      'src/lib/db/display-id.test.ts',
    ]);
  });

  it('does not run any suite when the prepared-schema proof fails', async () => {
    const runSuite = vi.fn();
    await expect(
      runPostgresIntegrationManifest({
        env: { POSTGRES_INTEGRATION_DATABASE_URL: SAFE_URL },
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
