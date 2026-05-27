import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

type CheckStatus = 'pass' | 'warn' | 'fail';

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

const PACKAGE_JSON_PATH = 'package.json';
const E2E_DUPLICATE_CHECK_SCRIPT = 'db:e2e:check-care-report-duplicates';

const REQUIRED_PLAYWRIGHT_SPECS = [
  'tools/tests/ui-audit-extensions.spec.ts',
  'tools/tests/ui-mobile-layout.spec.ts',
  'tools/tests/ui-schedule-visit-report.spec.ts',
  'tools/tests/e2e-prescription-dispensing-flow.spec.ts',
  'tools/tests/ui-detail-layout.spec.ts',
];

const REQUIRED_PACKAGE_SCRIPTS = [
  'db:e2e:push',
  'db:e2e:seed',
  'db:e2e:prepare',
  'db:check-care-report-duplicates',
  'db:e2e:check-care-report-duplicates',
  'medical-ui:e2e:preflight',
  'medical-ui:e2e:targeted',
  'medical-ui:e2e:gate',
  'medical-ui:e2e:gate:prod',
];

function readPackageScripts(): Record<string, string> {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}

function checkCommand(command: string): CheckResult {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
    encoding: 'utf8',
  });
  const path = result.stdout.trim();
  return {
    name: `command:${command}`,
    status: path ? 'pass' : 'fail',
    detail: path || `${command} is not available on PATH`,
  };
}

async function checkTcpPort(name: string, port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 1000 }, () => {
      socket.destroy();
      resolve({
        name,
        status: 'pass',
        detail: `127.0.0.1:${port} is reachable`,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        name,
        status: 'fail',
        detail: `127.0.0.1:${port} timed out`,
      });
    });

    socket.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        name,
        status: 'fail',
        detail: `127.0.0.1:${port} ${error.code ?? error.message}`,
      });
    });
  });
}

function checkDatabaseUrl(envName: 'DATABASE_URL' | 'DIRECT_URL'): CheckResult {
  const databaseUrl =
    process.env[envName] ??
    'postgresql://ph-os:ph-os@localhost:5433/ph-os_e2e?schema=public';

  try {
    const url = new URL(databaseUrl);
    const databaseName = url.pathname.replace(/^\//, '');
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const isE2eDatabase = databaseName === 'ph-os_e2e';
    return {
      name: envName,
      status: isLocalHost && isE2eDatabase ? 'pass' : 'fail',
      detail:
        isLocalHost && isE2eDatabase
          ? `local ${databaseName} database target`
          : `expected local ph-os_e2e, got host=${url.hostname} database=${databaseName}`,
    };
  } catch (error) {
    return {
      name: envName,
      status: 'fail',
      detail: error instanceof Error ? error.message : `invalid ${envName}`,
    };
  }
}

function checkSpecFiles(): CheckResult[] {
  return REQUIRED_PLAYWRIGHT_SPECS.map((specPath) => ({
    name: `playwright-spec:${specPath}`,
    status: fs.existsSync(specPath) ? 'pass' : 'fail',
    detail: fs.existsSync(specPath) ? 'found' : 'missing',
  }));
}

function checkPackageScripts(scripts: Record<string, string>): CheckResult[] {
  return REQUIRED_PACKAGE_SCRIPTS.map((scriptName) => {
    const script = scripts[scriptName];
    if (!script) {
      return {
        name: `package-script:${scriptName}`,
        status: 'fail',
        detail: 'missing',
      };
    }

    const shouldPinE2eDatabase =
      scriptName.startsWith('db:e2e:') || scriptName.startsWith('medical-ui:e2e:');
    if (shouldPinE2eDatabase && !script.includes('ph-os_e2e')) {
      return {
        name: `package-script:${scriptName}`,
        status: 'fail',
        detail: 'script does not pin local ph-os_e2e',
      };
    }

    if (scriptName === 'medical-ui:e2e:gate' && !script.includes(E2E_DUPLICATE_CHECK_SCRIPT)) {
      return {
        name: `package-script:${scriptName}`,
        status: 'fail',
        detail: `script must run ${E2E_DUPLICATE_CHECK_SCRIPT}`,
      };
    }

    return {
      name: `package-script:${scriptName}`,
      status: 'pass',
      detail:
        scriptName === 'medical-ui:e2e:gate'
          ? `found; runs ${E2E_DUPLICATE_CHECK_SCRIPT}`
          : 'found',
    };
  });
}

function checkScriptEntry(): CheckResult {
  return {
    name: 'script:db:check-care-report-duplicates',
    status: fs.existsSync('tools/scripts/check-care-report-duplicates.ts') ? 'pass' : 'fail',
    detail: fs.existsSync('tools/scripts/check-care-report-duplicates.ts')
      ? 'found'
      : 'tools/scripts/check-care-report-duplicates.ts is missing',
  };
}

function printResults(results: CheckResult[]) {
  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${marker} ${result.name}: ${result.detail}`);
  }
}

async function main() {
  const packageScripts = readPackageScripts();
  const results: CheckResult[] = [
    checkDatabaseUrl('DATABASE_URL'),
    checkDatabaseUrl('DIRECT_URL'),
    checkCommand('pnpm'),
    checkCommand('node'),
    ...checkPackageScripts(packageScripts),
    ...checkSpecFiles(),
    checkScriptEntry(),
    await checkTcpPort('port:app-3012', 3012),
    await checkTcpPort('port:db-5433', 5433),
  ];

  printResults(results);

  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length > 0) {
    console.error(
      [
        '',
        'Medical UI/UX E2E gate is not ready.',
        'Required next steps:',
        '1. Start local PostgreSQL for ph-os_e2e on localhost:5433.',
        '2. Run pnpm --config.verify-deps-before-run=false db:e2e:prepare.',
        '3. Start the app with pnpm dev:e2e:local or pnpm start:e2e:local on localhost:3012, or use pnpm medical-ui:e2e:gate:prod after preparing the database.',
        '4. Run pnpm --config.verify-deps-before-run=false db:e2e:check-care-report-duplicates for local release evidence.',
        '5. Run targeted Playwright/axe specs listed above.',
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log('Medical UI/UX E2E gate preflight passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
