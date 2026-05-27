import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

const APP_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3012';
const APP_PORT = new URL(APP_ORIGIN).port || '3012';
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const E2E_ENV = {
  ...process.env,
  DATABASE_URL: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
  DIRECT_URL: 'postgresql://ph_os:ph_os@localhost:5433/ph_os_e2e?schema=public',
  PLAYWRIGHT: '1',
  AUTH_SECRET: 'ph-os-local-auth-secret',
  NEXTAUTH_SECRET: 'ph-os-local-auth-secret',
  NEXTAUTH_URL: APP_ORIGIN,
  NEXT_PUBLIC_DISABLE_NOTIFICATION_STREAM: '1',
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES: `${process.cwd()}/tools/tests/helpers/next-font-google-mocked-responses.cjs`,
};

let appProcess: ChildProcess | null = null;
let appExited = false;

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`));
    });
  });
}

async function waitForApp() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (appExited) {
      throw new Error('E2E app server exited before it became ready');
    }

    try {
      const response = await fetch(APP_ORIGIN, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${APP_ORIGIN}`);
}

async function stopApp() {
  if (
    !appProcess ||
    appProcess.killed ||
    appProcess.exitCode !== null ||
    appProcess.signalCode !== null ||
    appExited
  ) {
    return;
  }

  appProcess.kill('SIGTERM');
  const timeout = setTimeout(() => {
    appProcess?.kill('SIGKILL');
  }, 5_000);

  await once(appProcess, 'exit').catch(() => null);
  clearTimeout(timeout);
}

async function main() {
  process.on('SIGINT', () => {
    void stopApp().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void stopApp().finally(() => process.exit(143));
  });

  await run('pnpm', ['--config.verify-deps-before-run=false', 'build:e2e:local']);

  appProcess = spawn('node_modules/.bin/next', ['start', '--port', APP_PORT], {
    env: E2E_ENV,
    stdio: 'inherit',
  });
  appProcess.once('exit', () => {
    appExited = true;
  });

  try {
    await waitForApp();
    await run('pnpm', ['--config.verify-deps-before-run=false', 'medical-ui:e2e:gate']);
  } finally {
    await stopApp();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
