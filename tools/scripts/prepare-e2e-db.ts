import { spawnSync } from 'node:child_process';

const E2E_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';
const E2E_DIRECT_URL =
  process.env.DIRECT_URL ?? 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public';

function assertLocalE2eDatabase(urlText: string, envName: string) {
  const url = new URL(urlText);
  const databaseName = url.pathname.replace(/^\//, '');
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!isLocalHost || databaseName !== 'ph_os_e2e') {
    throw new Error(
      `${envName} must point to local ph_os_e2e before reset-capable E2E preparation runs`,
    );
  }
}

function databaseTarget(urlText: string) {
  const url = new URL(urlText);
  return `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`;
}

function runPrisma(args: string[]) {
  return spawnSync('pnpm', ['--config.verify-deps-before-run=false', 'exec', 'prisma', ...args], {
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      DIRECT_URL: E2E_DIRECT_URL,
    },
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
}

function printResult(result: ReturnType<typeof runPrisma>) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

assertLocalE2eDatabase(E2E_DATABASE_URL, 'DATABASE_URL');
assertLocalE2eDatabase(E2E_DIRECT_URL, 'DIRECT_URL');

const deploy = runPrisma(['migrate', 'deploy', '--schema=prisma/schema/']);
printResult(deploy);

if (deploy.status === 0) {
  const seed = runPrisma(['db', 'seed']);
  printResult(seed);
  process.exit(seed.status ?? 1);
}

const combinedOutput = `${deploy.stdout ?? ''}\n${deploy.stderr ?? ''}`;
const shouldResetForNonEmptyDatabase = combinedOutput.includes('P3005');
const shouldResetForFailedMigration = combinedOutput.includes('P3009');
if (!shouldResetForNonEmptyDatabase && !shouldResetForFailedMigration) {
  process.exit(deploy.status ?? 1);
}

console.warn(
  [
    `Resetting dedicated local E2E database ${databaseTarget(E2E_DATABASE_URL)}.`,
    shouldResetForNonEmptyDatabase
      ? 'Reason: Prisma reported P3005, the database is not empty and has no migration history.'
      : 'Reason: Prisma reported P3009, the migration history contains a failed migration.',
  ].join('\n'),
);

const reset = runPrisma(['migrate', 'reset', '--force', '--schema=prisma/schema/']);
printResult(reset);
process.exit(reset.status ?? 1);
