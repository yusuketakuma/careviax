import { spawnSync } from 'node:child_process';
import { DEFAULT_E2E_DATABASE_URL, runPrepareE2eDb } from './prepare-e2e-db-core';

const E2E_DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
const E2E_DIRECT_URL = process.env.DIRECT_URL ?? DEFAULT_E2E_DATABASE_URL;

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

const result = runPrepareE2eDb({
  databaseUrl: E2E_DATABASE_URL,
  directUrl: E2E_DIRECT_URL,
  runPrisma,
  logger: {
    warn: (message) => console.warn(message),
    writeStdout: (message) => process.stdout.write(message),
    writeStderr: (message) => process.stderr.write(message),
  },
});

process.exit(result.exitCode);
