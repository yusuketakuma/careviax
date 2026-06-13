import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import {
  AUDIT_TRIGGER_CATALOG_SQL,
  describeAuditTriggerIssue,
  EXPECTED_AUDIT_TRIGGER_NAMES,
  validateAuditTriggerContracts,
} from './audit-trigger-contract';
import type { AuditTriggerCatalogRow } from './audit-trigger-contract';
import {
  assertMatchingE2eTargets,
  DEFAULT_E2E_DATABASE_URL,
  parseLocalE2eDatabaseTarget,
} from './prepare-e2e-db-core';

type CheckStatus = 'pass' | 'warn' | 'fail';

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};

const PACKAGE_JSON_PATH = 'package.json';
const E2E_DUPLICATE_CHECK_SCRIPT = 'db:e2e:check-care-report-duplicates';
const E2E_ROUTE_ORDER_CONFLICT_CHECK_SCRIPT = 'db:e2e:check-visit-route-order-conflicts';
const E2E_MIGRATION_PRECONDITION_SCRIPT = 'db:e2e:verify-migration-preconditions';
const REQUIRED_MEDICAL_UI_GATE_PRECHECKS = [
  E2E_DUPLICATE_CHECK_SCRIPT,
  E2E_ROUTE_ORDER_CONFLICT_CHECK_SCRIPT,
  E2E_MIGRATION_PRECONDITION_SCRIPT,
] as const;

const REQUIRED_RLS_TABLES = [
  'AuditLog',
  'BillingCandidate',
  'BillingEvidence',
  'CycleTransitionLog',
  'DispensingDecision',
  'DocumentDeliveryRule',
  'DrugAlertRule',
  'FileAsset',
  'HandoffBoard',
  'PatientInsurance',
  'PcaPump',
  'PcaPumpRental',
  'PcaPumpRentalAccessory',
  'PcaPumpMaintenanceEvent',
  'PushSubscription',
  'ServiceArea',
  'TaskComment',
  'VisitVehicleResource',
  'WebhookDelivery',
] as const;

const ORG_ID_RLS_EXEMPT_TABLES = [
  // Org-scoped configuration/master/auth tables still use route/service guards
  // and need separate migration planning before app-role RLS enforcement.
  'BillingRule',
  'BusinessHoliday',
  'FacilityUnit',
  'FormularyChangeRequest',
  'FormularyTemplate',
  'IntegrationJob',
  'NotificationRule',
  'PackagingMethodMaster',
  'PatientPackagingProfile',
  'PharmacySiteInsuranceConfig',
  'PrescriberInstitution',
  'User',
  'VisitScheduleContactLog',
  'VisitScheduleOverride',
] as const;

const REQUIRED_PLAYWRIGHT_SPECS = [
  'tools/tests/ui-audit-extensions.spec.ts',
  'tools/tests/ui-mobile-layout.spec.ts',
  'tools/tests/ui-schedule-visit-report.spec.ts',
  'tools/tests/e2e-prescription-dispensing-flow.spec.ts',
  'tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts',
  'tools/tests/ui-detail-layout.spec.ts',
];

const REQUIRED_PACKAGE_SCRIPTS = [
  'db:e2e:push',
  'db:e2e:migrate',
  'db:e2e:seed',
  'db:e2e:prepare',
  'db:check-care-report-duplicates',
  'db:check-visit-route-order-conflicts',
  'db:verify-migration-preconditions',
  'db:e2e:check-care-report-duplicates',
  'db:e2e:check-visit-route-order-conflicts',
  'db:e2e:verify-migration-preconditions',
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
  const databaseUrl = process.env[envName] ?? DEFAULT_E2E_DATABASE_URL;

  try {
    const target = parseLocalE2eDatabaseTarget(databaseUrl, envName);
    return {
      name: envName,
      status: 'pass',
      detail: `local ${target.label} database target`,
    };
  } catch (error) {
    return {
      name: envName,
      status: 'fail',
      detail: error instanceof Error ? error.message : `invalid ${envName}`,
    };
  }
}

function checkDatabaseUrlPair(): CheckResult {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  const directUrl = process.env.DIRECT_URL ?? DEFAULT_E2E_DATABASE_URL;

  try {
    const target = assertMatchingE2eTargets(databaseUrl, directUrl);
    return {
      name: 'DATABASE_URL/DIRECT_URL',
      status: 'pass',
      detail: `matching ${target.label} database target`,
    };
  } catch (error) {
    return {
      name: 'DATABASE_URL/DIRECT_URL',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'database URLs do not match',
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

    if (scriptName === 'db:e2e:push') {
      if (script.includes('prisma db push')) {
        return {
          name: `package-script:${scriptName}`,
          status: 'fail',
          detail: 'script must not run prisma db push because it skips raw SQL migrations',
        };
      }

      return {
        name: `package-script:${scriptName}`,
        status: 'pass',
        detail: 'deprecated guard found',
      };
    }

    const shouldPinE2eDatabase =
      scriptName.startsWith('db:e2e:') || scriptName.startsWith('medical-ui:e2e:');
    if (shouldPinE2eDatabase && !script.includes('ph_os_e2e')) {
      return {
        name: `package-script:${scriptName}`,
        status: 'fail',
        detail: 'script does not pin local ph_os_e2e',
      };
    }

    if (scriptName === 'medical-ui:e2e:gate') {
      const missingPrechecks = REQUIRED_MEDICAL_UI_GATE_PRECHECKS.filter(
        (precheck) => !script.includes(precheck),
      );
      if (missingPrechecks.length > 0) {
        return {
          name: `package-script:${scriptName}`,
          status: 'fail',
          detail: `script must run ${missingPrechecks.join(', ')}`,
        };
      }
    }

    if (scriptName === 'db:e2e:prepare' && !script.includes('db:e2e:migrate')) {
      return {
        name: `package-script:${scriptName}`,
        status: 'fail',
        detail: 'script must run db:e2e:migrate so raw SQL migrations are verified',
      };
    }

    return {
      name: `package-script:${scriptName}`,
      status: 'pass',
      detail:
        scriptName === 'medical-ui:e2e:gate'
          ? `found; runs ${REQUIRED_MEDICAL_UI_GATE_PRECHECKS.join(', ')}`
          : 'found',
    };
  });
}

async function checkDatabaseRlsAndAudit(): Promise<CheckResult> {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const rlsResult = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policy_count: number;
    }>(
      `
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity,
          COUNT(p.polname)::int AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a
          ON a.attrelid = c.oid
         AND a.attname = 'org_id'
         AND NOT a.attisdropped
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND c.relname <> ALL($1::text[])
        GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      `,
      [ORG_ID_RLS_EXEMPT_TABLES],
    );

    const rlsByTable = new Map(rlsResult.rows.map((row) => [row.relname, row]));
    const missingTables = REQUIRED_RLS_TABLES.filter((table) => !rlsByTable.has(table));
    const weakRlsTables = rlsResult.rows.filter(
      (row) => !row.relrowsecurity || !row.relforcerowsecurity || row.policy_count < 1,
    );

    const triggerResult = await client.query<AuditTriggerCatalogRow>(AUDIT_TRIGGER_CATALOG_SQL, [
      EXPECTED_AUDIT_TRIGGER_NAMES,
    ]);
    const triggerIssues = validateAuditTriggerContracts(triggerResult.rows);

    if (missingTables.length > 0 || weakRlsTables.length > 0 || triggerIssues.length > 0) {
      return {
        name: 'db:rls-audit-contract',
        status: 'fail',
        detail: [
          missingTables.length ? `missing tables: ${missingTables.join(', ')}` : null,
          weakRlsTables.length
            ? `weak RLS: ${weakRlsTables
                .map(
                  (row) =>
                    `${row.relname}(rls=${row.relrowsecurity},force=${row.relforcerowsecurity},policies=${row.policy_count})`,
                )
                .join(', ')}`
            : null,
          triggerIssues.length
            ? `audit trigger contract mismatch: ${triggerIssues
                .map(describeAuditTriggerIssue)
                .join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('; '),
      };
    }

    return {
      name: 'db:rls-audit-contract',
      status: 'pass',
      detail: `${rlsResult.rows.length} org-scoped RLS tables and ${EXPECTED_AUDIT_TRIGGER_NAMES.length} audit triggers verified`,
    };
  } catch (error) {
    return {
      name: 'db:rls-audit-contract',
      status: 'fail',
      detail: error instanceof Error ? error.message : 'database contract check failed',
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function checkScriptEntries(): CheckResult[] {
  const requiredScriptFiles = [
    'tools/scripts/check-care-report-duplicates.ts',
    'tools/scripts/check-visit-route-order-conflicts.ts',
    'tools/scripts/verify-migration-preconditions.ts',
  ];

  return requiredScriptFiles.map((scriptPath) => ({
    name: `script:${scriptPath}`,
    status: fs.existsSync(scriptPath) ? 'pass' : 'fail',
    detail: fs.existsSync(scriptPath) ? 'found' : `${scriptPath} is missing`,
  }));
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
    checkDatabaseUrlPair(),
    checkCommand('pnpm'),
    checkCommand('node'),
    ...checkPackageScripts(packageScripts),
    ...checkSpecFiles(),
    ...checkScriptEntries(),
    await checkTcpPort('port:app-3012', 3012),
    await checkTcpPort('port:db-5433', 5433),
    await checkDatabaseRlsAndAudit(),
  ];

  printResults(results);

  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length > 0) {
    console.error(
      [
        '',
        'Medical UI/UX E2E gate is not ready.',
        'Required next steps:',
        '1. Start local PostgreSQL for ph_os_e2e on localhost:5433.',
        '2. Run pnpm --config.verify-deps-before-run=false db:e2e:prepare.',
        '3. Start the app with pnpm dev:e2e:local or pnpm start:e2e:local on localhost:3012, or use pnpm medical-ui:e2e:gate:prod after preparing the database.',
        '4. Run pnpm --config.verify-deps-before-run=false db:e2e:check-care-report-duplicates, db:e2e:check-visit-route-order-conflicts, and db:e2e:verify-migration-preconditions for local release evidence.',
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
