import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('medical UI E2E release contract', () => {
  it('keeps production deploy behind the medical UI E2E gate', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(workflow).toContain('medical-ui-e2e-gate:');
    expect(workflow).toMatch(
      /deploy-production:\n(?:.*\n)*?\s+needs:\s+\[ci,\s*medical-ui-e2e-gate\]/,
    );
    expect(workflow).toContain('pnpm --config.verify-deps-before-run=false db:e2e:prepare');
    expect(workflow).toContain(
      'pnpm --config.verify-deps-before-run=false medical-ui:e2e:gate:prod',
    );
  });

  it('keeps the medical UI gate pinned to the E2E duplicate precheck', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const preflight = readFileSync('tools/scripts/medical-ui-e2e-preflight.ts', 'utf8');

    expect(packageJson).toContain('"medical-ui:e2e:gate"');
    expect(packageJson).toContain('db:e2e:check-care-report-duplicates');
    expect(packageJson).toContain('db:e2e:check-visit-route-order-conflicts');
    expect(packageJson).toContain('db:e2e:verify-migration-preconditions');
    expect(packageJson).not.toContain(
      'medical-ui:e2e:gate": "pnpm db:check-care-report-duplicates',
    );
    expect(preflight).toContain('db:e2e:check-care-report-duplicates');
    expect(preflight).toContain('db:e2e:check-visit-route-order-conflicts');
    expect(preflight).toContain('db:e2e:verify-migration-preconditions');
  });

  it('keeps billing, PCA, and prescription guardrails inside the targeted E2E gate', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const preflight = readFileSync('tools/scripts/medical-ui-e2e-preflight.ts', 'utf8');
    const guardrailSpec = 'tools/tests/e2e-billing-pca-prescription-guardrails.spec.ts';

    expect(packageJson).toContain(guardrailSpec);
    expect(preflight).toContain(guardrailSpec);
  });

  it('keeps recent org-scoped operational tables inside the RLS preflight contract', () => {
    const preflight = readFileSync('tools/scripts/medical-ui-e2e-preflight.ts', 'utf8');

    expect(preflight).toContain("'DrugAlertRule'");
    expect(preflight).toContain("'FileAsset'");
    expect(preflight).toContain("'PatientFieldRevision'");
    expect(preflight).toContain("'PatientMedicalProcedure'");
    expect(preflight).toContain("'PatientNarcoticUse'");
    expect(preflight).toContain("'WebhookDelivery'");
  });
});
