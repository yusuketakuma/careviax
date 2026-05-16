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
    expect(packageJson).not.toContain(
      'medical-ui:e2e:gate": "pnpm db:check-care-report-duplicates',
    );
    expect(preflight).toContain('db:e2e:check-care-report-duplicates');
  });
});
