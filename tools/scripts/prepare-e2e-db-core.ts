export const DEFAULT_E2E_DATABASE_URL =
  'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';
export const E2E_DATABASE_NAME = 'ph_os_e2e';
export const E2E_DATABASE_PORT = '5433';
export const E2E_DATABASE_SCHEMA = 'public';
export const E2E_DATABASE_USER = 'ph_os';

export type E2eDatabaseTarget = {
  databaseName: string;
  host: string;
  port: string;
  label: string;
};

export type ResetReason = 'non-empty-database' | 'failed-migration';

export type PrismaCommandResult = {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
};

export type PrismaRunner = (args: string[]) => PrismaCommandResult;

export type PrepareE2eDbLogger = {
  warn: (message: string) => void;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
};

export type PrepareE2eDbResult = {
  exitCode: number;
};

function normalizeLocalHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

export function parseLocalE2eDatabaseTarget(urlText: string, envName: string): E2eDatabaseTarget {
  const url = new URL(urlText);
  const databaseName = url.pathname.replace(/^\//, '');
  const host = normalizeLocalHost(url.hostname);
  const schema = url.searchParams.get('schema') ?? E2E_DATABASE_SCHEMA;
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  const port = url.port || '';
  const username = decodeURIComponent(url.username);

  if (
    url.protocol !== 'postgresql:' ||
    !isLocalHost ||
    port !== E2E_DATABASE_PORT ||
    username !== E2E_DATABASE_USER ||
    databaseName !== E2E_DATABASE_NAME ||
    schema !== E2E_DATABASE_SCHEMA
  ) {
    throw new Error(
      `${envName} must point to postgresql://ph_os@localhost:5433/ph_os_e2e?schema=public before reset-capable E2E preparation runs`,
    );
  }

  return {
    databaseName,
    host,
    port,
    label: `${host.includes(':') ? `[${host}]` : host}:${port}/${databaseName}`,
  };
}

export function assertMatchingE2eTargets(
  databaseUrl: string,
  directUrl: string,
): E2eDatabaseTarget {
  const databaseTarget = parseLocalE2eDatabaseTarget(databaseUrl, 'DATABASE_URL');
  const directTarget = parseLocalE2eDatabaseTarget(directUrl, 'DIRECT_URL');

  if (
    databaseTarget.host !== directTarget.host ||
    databaseTarget.port !== directTarget.port ||
    databaseTarget.databaseName !== directTarget.databaseName
  ) {
    throw new Error(
      [
        'DATABASE_URL and DIRECT_URL must point to the same local E2E database before reset-capable preparation runs.',
        `DATABASE_URL=${databaseTarget.label}`,
        `DIRECT_URL=${directTarget.label}`,
      ].join('\n'),
    );
  }

  return databaseTarget;
}

export function detectResetReason(prismaOutput: string): ResetReason | null {
  if (prismaOutput.includes('P3005')) return 'non-empty-database';
  if (prismaOutput.includes('P3009')) return 'failed-migration';
  return null;
}

export function resetReasonDetail(reason: ResetReason): string {
  if (reason === 'non-empty-database') {
    return 'Prisma reported P3005, the database is not empty and has no migration history.';
  }
  return 'Prisma reported P3009, the migration history contains a failed migration.';
}

export function buildResetWarning(target: E2eDatabaseTarget, reason: ResetReason): string {
  return [
    `Resetting dedicated local E2E database ${target.label}.`,
    `Safety guard: reset is allowed only after DATABASE_URL and DIRECT_URL both target local ph_os_e2e.`,
    `Reason: ${resetReasonDetail(reason)}`,
  ].join('\n');
}

function writePrismaResult(result: PrismaCommandResult, logger: PrepareE2eDbLogger) {
  if (result.stdout) logger.writeStdout(result.stdout);
  if (result.stderr) logger.writeStderr(result.stderr);
}

export function runPrepareE2eDb(options: {
  databaseUrl: string;
  directUrl: string;
  runPrisma: PrismaRunner;
  logger: PrepareE2eDbLogger;
}): PrepareE2eDbResult {
  const e2eDatabaseTarget = assertMatchingE2eTargets(options.databaseUrl, options.directUrl);

  const deploy = options.runPrisma(['migrate', 'deploy', '--schema=prisma/schema/']);
  writePrismaResult(deploy, options.logger);

  if (deploy.status === 0) {
    const seed = options.runPrisma(['db', 'seed']);
    writePrismaResult(seed, options.logger);
    return { exitCode: seed.status ?? 1 };
  }

  const combinedOutput = `${deploy.stdout ?? ''}\n${deploy.stderr ?? ''}`;
  const resetReason = detectResetReason(combinedOutput);
  if (!resetReason) {
    return { exitCode: deploy.status ?? 1 };
  }

  options.logger.warn(buildResetWarning(e2eDatabaseTarget, resetReason));

  const reset = options.runPrisma(['migrate', 'reset', '--force', '--schema=prisma/schema/']);
  writePrismaResult(reset, options.logger);
  return { exitCode: reset.status ?? 1 };
}
