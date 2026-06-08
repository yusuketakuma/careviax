import { describe, expect, it } from 'vitest';
import {
  assertMatchingE2eTargets,
  buildResetWarning,
  detectResetReason,
  parseLocalE2eDatabaseTarget,
  runPrepareE2eDb,
  type PrismaCommandResult,
} from './prepare-e2e-db-core';

describe('prepare-e2e-db-core', () => {
  it('accepts only local ph_os_e2e targets before reset-capable preparation', () => {
    expect(
      parseLocalE2eDatabaseTarget(
        'postgresql://ph_os:ph_os@LOCALHOST:5433/ph_os_e2e?schema=public',
        'DATABASE_URL',
      ),
    ).toMatchObject({
      databaseName: 'ph_os_e2e',
      host: 'localhost',
      port: '5433',
      label: 'localhost:5433/ph_os_e2e',
    });

    expect(() =>
      parseLocalE2eDatabaseTarget(
        'postgresql://ph_os:ph_os@db.internal:5432/ph_os_e2e?schema=public',
        'DATABASE_URL',
      ),
    ).toThrow(/must point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e/);

    expect(() =>
      parseLocalE2eDatabaseTarget(
        'postgresql://ph_os:ph_os@localhost:5433/ph_os?schema=public',
        'DATABASE_URL',
      ),
    ).toThrow(/must point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e/);
  });

  it('keeps the reset-capable target pinned to the dedicated E2E port, user, protocol, and schema', () => {
    expect(
      parseLocalE2eDatabaseTarget(
        'postgresql://ph_os:ph_os@[::1]:5433/ph_os_e2e?schema=public',
        'DATABASE_URL',
      ),
    ).toMatchObject({
      host: '::1',
      label: '[::1]:5433/ph_os_e2e',
    });

    for (const unsafeUrl of [
      'postgresql://ph_os:ph_os@localhost/ph_os_e2e?schema=public',
      'postgresql://ph_os:ph_os@localhost:5432/ph_os_e2e?schema=public',
      'postgresql://ph_os:ph_os@localhost:5434/ph_os_e2e?schema=public',
      'postgresql://postgres:postgres@localhost:5433/ph_os_e2e?schema=public',
      'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=private',
      'postgres://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
    ]) {
      expect(() => parseLocalE2eDatabaseTarget(unsafeUrl, 'DATABASE_URL')).toThrow(
        /must point to postgresql:\/\/ph_os@localhost:5433\/ph_os_e2e/,
      );
    }
  });

  it('requires DATABASE_URL and DIRECT_URL to point to the same local E2E database', () => {
    expect(
      assertMatchingE2eTargets(
        'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
        'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      ),
    ).toMatchObject({
      label: 'localhost:5433/ph_os_e2e',
    });

    expect(() =>
      assertMatchingE2eTargets(
        'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
        'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public',
      ),
    ).toThrow(/must point to the same local E2E database/);
  });

  it('resets only for Prisma migration states that are safe for the dedicated E2E DB', () => {
    expect(detectResetReason('Error: P3005 database is not empty')).toBe('non-empty-database');
    expect(detectResetReason('Error: P3009 failed migrations found')).toBe('failed-migration');
    expect(detectResetReason('Error: P3018 migration failed')).toBeNull();
  });

  it('prints a reset warning with target, guard, and reason', () => {
    expect(
      buildResetWarning(
        {
          databaseName: 'ph_os_e2e',
          host: 'localhost',
          port: '5433',
          label: 'localhost:5433/ph_os_e2e',
        },
        'failed-migration',
      ),
    ).toContain('Safety guard: reset is allowed only after DATABASE_URL and DIRECT_URL');
  });

  it('runs seed after successful migrate deploy', () => {
    const calls: string[][] = [];
    const result = runPrepareE2eDb({
      databaseUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      directUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      runPrisma: (args) => {
        calls.push(args);
        return { status: 0, stdout: `${args.join(' ')} ok\n`, stderr: '' };
      },
      logger: testLogger(),
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([
      ['migrate', 'deploy', '--schema=prisma/schema/'],
      ['db', 'seed'],
    ]);
  });

  it('resets after P3005 or P3009 and never for other deploy failures', () => {
    for (const errorCode of ['P3005', 'P3009']) {
      const calls: string[][] = [];
      const result = runPrepareE2eDb({
        databaseUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
        directUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
        runPrisma: (args): PrismaCommandResult => {
          calls.push(args);
          if (args[0] === 'migrate' && args[1] === 'deploy') {
            return { status: 1, stderr: `Error: ${errorCode}` };
          }
          return { status: 0, stdout: 'reset ok\n' };
        },
        logger: testLogger(),
      });

      expect(result.exitCode).toBe(0);
      expect(calls).toEqual([
        ['migrate', 'deploy', '--schema=prisma/schema/'],
        ['migrate', 'reset', '--force', '--schema=prisma/schema/'],
      ]);
    }

    const calls: string[][] = [];
    const result = runPrepareE2eDb({
      databaseUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      directUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
      runPrisma: (args) => {
        calls.push(args);
        return { status: 1, stderr: 'Error: P3018 migration failed' };
      },
      logger: testLogger(),
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toEqual([['migrate', 'deploy', '--schema=prisma/schema/']]);
  });

  it('does not run Prisma when DATABASE_URL and DIRECT_URL do not match', () => {
    const calls: string[][] = [];

    expect(() =>
      runPrepareE2eDb({
        databaseUrl: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
        directUrl: 'postgresql://ph_os:ph_os@127.0.0.1:5433/ph_os_e2e?schema=public',
        runPrisma: (args) => {
          calls.push(args);
          return { status: 0 };
        },
        logger: testLogger(),
      }),
    ).toThrow(/must point to the same local E2E database/);

    expect(calls).toEqual([]);
  });
});

function testLogger() {
  return {
    warn: () => undefined,
    writeStdout: () => undefined,
    writeStderr: () => undefined,
  };
}
