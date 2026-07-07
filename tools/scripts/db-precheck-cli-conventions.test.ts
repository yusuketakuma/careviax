import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dbGatedScripts = [
  'backfill-drug-packages-from-drug-master-jan.ts',
  'backfill-prescription-line-drug-master-ids.ts',
  'backfill-webhook-registration-secrets.ts',
  'backup-recovery-integrity-audit.ts',
  'check-care-report-duplicates.ts',
  'check-visit-route-order-conflicts.ts',
  'explain-care-report-index-candidates.ts',
  'external-access-case-boundary-audit.ts',
  'handoff-confirmation-task-inventory.ts',
  'verify-migration-preconditions.ts',
  'verify-ph-os-audit-migration.ts',
];

const dbGatedPackageScripts = {
  'backup:drill:integrity': 'tools/scripts/backup-recovery-integrity-audit.ts',
  'db:check-care-report-duplicates': 'tools/scripts/check-care-report-duplicates.ts',
  'db:check-visit-route-order-conflicts': 'tools/scripts/check-visit-route-order-conflicts.ts',
  'db:explain-care-report-index-candidates':
    'tools/scripts/explain-care-report-index-candidates.ts',
  'db:external-access-case-boundary-audit': 'tools/scripts/external-access-case-boundary-audit.ts',
  'db:handoff-confirmation-tasks:inventory': 'tools/scripts/handoff-confirmation-task-inventory.ts',
  'db:verify-migration-preconditions': 'tools/scripts/verify-migration-preconditions.ts',
  'db:verify-ph-os-audit-migration': 'tools/scripts/verify-ph-os-audit-migration.ts',
  'db:prescription-line-drug-master:backfill':
    'tools/scripts/backfill-prescription-line-drug-master-ids.ts',
  'db:drug-packages:backfill-from-drug-master-jan':
    'tools/scripts/backfill-drug-packages-from-drug-master-jan.ts',
  'db:webhook-secrets:backfill': 'tools/scripts/backfill-webhook-registration-secrets.ts',
} as const;

function readScript(scriptName: string) {
  return readFileSync(join(process.cwd(), 'tools', 'scripts', scriptName), 'utf8');
}

describe('DB-gated precheck CLI conventions', () => {
  it('keeps DB-gated scripts import-safe', () => {
    for (const scriptName of dbGatedScripts) {
      const source = readScript(scriptName);
      expect(source, scriptName).toContain("import { pathToFileURL } from 'node:url'");
      expect(source, scriptName).toContain(
        "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
      );
    }
  });

  it('allows usage review before DATABASE_URL is required', () => {
    for (const scriptName of dbGatedScripts) {
      const source = readScript(scriptName);
      const helpIndex = source.indexOf('--help');
      const databaseUrlIndex = source.indexOf('DATABASE_URL is required');

      expect(helpIndex, scriptName).toBeGreaterThanOrEqual(0);
      expect(databaseUrlIndex, scriptName).toBeGreaterThanOrEqual(0);
      expect(helpIndex, scriptName).toBeLessThan(databaseUrlIndex);
    }
  });

  it('keeps direct pg clients bounded by query and statement timeouts', () => {
    for (const scriptName of dbGatedScripts) {
      const source = readScript(scriptName);
      expect(source, scriptName).toContain('statement_timeout: 120_000');
      expect(source, scriptName).toContain('query_timeout: 120_000');
    }
  });

  it('prints structured CLI failure output', () => {
    for (const scriptName of dbGatedScripts) {
      const source = readScript(scriptName);
      if (scriptName === 'backup-recovery-integrity-audit.ts') {
        expect(source, scriptName).toContain('formatRecoveryIntegrityCliError');
      } else {
        expect(source, scriptName).toContain('JSON.stringify({');
      }
      expect(source, scriptName).toContain('ok: false');
      expect(source, scriptName).toContain("import { inspect } from 'node:util'");
    }
  });

  it('keeps package scripts and the operational script index aligned', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const scriptReadme = readFileSync(join(process.cwd(), 'tools', 'scripts', 'README.md'), 'utf8');

    for (const [scriptName, scriptPath] of Object.entries(dbGatedPackageScripts)) {
      expect(packageJson.scripts[scriptName], scriptName).toBe(`tsx ${scriptPath}`);
      expect(scriptReadme, scriptPath).toContain(`\`${scriptPath.split('/').at(-1)}\``);
    }
  });

  it('keeps approved-DB release runbook commands backed by package scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const runbook = readFileSync(
      join(process.cwd(), 'docs', 'operations', 'medical-ui-safety-release-runbook.md'),
      'utf8',
    );
    const webhookRunbook = readFileSync(
      join(process.cwd(), 'docs', 'operations', 'webhook-secret-backfill-runbook.md'),
      'utf8',
    );

    for (const scriptName of Object.keys(dbGatedPackageScripts)) {
      expect(packageJson.scripts[scriptName], scriptName).toBeDefined();
    }

    expect(runbook).toContain('db:check-care-report-duplicates');
    expect(runbook).toContain('db:check-visit-route-order-conflicts');
    expect(runbook).toContain('db:verify-migration-preconditions');
    expect(runbook).toContain('db:verify-ph-os-audit-migration');
    expect(runbook).toContain('db:external-access-case-boundary-audit');
    expect(runbook).toContain('db:external-access-case-boundary-audit -- --apply --max-rows');
    expect(webhookRunbook).toContain('db:webhook-secrets:backfill --dry-run');
    expect(webhookRunbook).toContain('db:webhook-secrets:backfill --apply --max-rows');
  });
});
