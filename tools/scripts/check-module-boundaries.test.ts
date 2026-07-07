import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-module-boundaries.mjs');

function createFixtureRepo(files: Record<string, string>, allowlist: unknown = { entries: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-boundary-'));
  for (const dir of [
    'tools/scripts',
    'src/server/services',
    'src/lib',
    'src/core/module-registry',
    'src/modules/pharmacy',
    'src/app/api/example',
  ]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-module-boundaries.mjs'));
  writeFileSync(path.join(root, 'tools/module-boundary-allowlist.json'), JSON.stringify(allowlist));
  writeFileSync(
    path.join(root, 'src/core/module-registry/module-ids.json'),
    JSON.stringify({
      featureModules: [
        { id: 'pharmacy', dir: 'pharmacy' },
        { id: 'home_medical', dir: 'home-medical' },
        { id: 'home_nursing', dir: 'home-nursing' },
        { id: 'network_ops', dir: 'network-ops' },
      ],
    }),
  );
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runBoundaryCheck(root: string, env: Record<string, string> = {}) {
  return execFileSync(process.execPath, ['tools/scripts/check-module-boundaries.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-module-boundaries', () => {
  it('allows app/api to import a feature module public entrypoint', () => {
    const root = createFixtureRepo({
      'src/modules/pharmacy/index.ts': 'export const pharmacyModule = {};\n',
      'src/app/api/example/route.ts': "import { pharmacyModule } from '@/modules/pharmacy';\n",
    });

    expect(runBoundaryCheck(root)).toContain('Module boundary check passed');
  });

  it('rejects app/api imports of feature module internals', () => {
    const root = createFixtureRepo({
      'src/modules/pharmacy/internal.ts': 'export const internal = {};\n',
      'src/app/api/example/route.ts': "import { internal } from '@/modules/pharmacy/internal';\n",
    });

    expect(() => runBoundaryCheck(root)).toThrow(/public entrypoints/);
  });

  it('rejects feature modules importing the active-module composition root', () => {
    const root = createFixtureRepo({
      'src/modules/active-modules.ts': 'export const activeModules = [];\n',
      'src/modules/pharmacy/internal.ts':
        "import { activeModules } from '@/modules/active-modules';\n",
    });

    expect(() => runBoundaryCheck(root)).toThrow(/composition roots/);
  });

  it('rejects core imports of feature modules using the shared module id catalog', () => {
    const root = createFixtureRepo({
      'src/modules/home-medical/index.ts': 'export const homeMedicalModule = {};\n',
      'src/core/example.ts': "import { homeMedicalModule } from '@/modules/home-medical';\n",
    });

    expect(() => runBoundaryCheck(root)).toThrow(/core must not import feature modules/);
  });

  it('allows core services to import registered feature module public services', () => {
    const root = createFixtureRepo({
      'src/modules/pharmacy/index.ts':
        "export const pharmacyModule = { publicServices: ['src/modules/pharmacy/public-service.ts'] };\n",
      'src/modules/pharmacy/public-service.ts': 'export const publicService = {};\n',
      'src/server/services/patient-detail.ts':
        "import { publicService } from '@/modules/pharmacy/public-service';\n",
    });

    expect(runBoundaryCheck(root)).toContain('Module boundary check passed');
  });

  it('rejects core services importing unregistered feature module internals', () => {
    const root = createFixtureRepo({
      'src/modules/pharmacy/index.ts':
        "export const pharmacyModule = { publicServices: ['src/modules/pharmacy/public-service.ts'] };\n",
      'src/modules/pharmacy/internal.ts': 'export const internal = {};\n',
      'src/server/services/patient-detail.ts':
        "import { internal } from '@/modules/pharmacy/internal';\n",
    });

    expect(() => runBoundaryCheck(root)).toThrow(/registered public services/);
  });

  it('rejects non-empty allowlists in normal CI after the debt ratchet reaches zero', () => {
    const root = createFixtureRepo(
      {
        'src/server/services/patient-detail.ts':
          "import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';\n",
      },
      {
        entries: [
          {
            path: 'src/server/services/patient-detail.ts',
            expectedCount: 1,
            owner: 'MOD-PATIENT-001',
            debtId: 'DEBT-PATIENT-001',
            reason: 'Legacy patient detail link helper imports pharmacy-specific navigation.',
            plannedAction: 'Move prescription href construction behind a pharmacy module adapter.',
            targets: ['@/lib/prescriptions/navigation'],
          },
        ],
      },
    );

    expect(() => runBoundaryCheck(root)).toThrow(/must stay empty in normal CI/);
  });

  it.each([
    ['owner', /entries\[0\]\.owner is required/],
    ['debtId', /entries\[0\]\.debtId is required/],
    ['plannedAction', /entries\[0\]\.plannedAction is required/],
    ['targets', /entries\[0\]\.targets must be a non-empty string array/],
  ] as const)('requires %s for allowlisted debt', (missingField, errorPattern) => {
    const allowlistEntry = {
      path: 'src/server/services/patient-detail.ts',
      expectedCount: 1,
      owner: 'MOD-PATIENT-001',
      debtId: 'DEBT-PATIENT-001',
      reason: 'Legacy patient detail link helper imports pharmacy-specific navigation.',
      plannedAction: 'Move prescription href construction behind a pharmacy module adapter.',
      targets: ['@/lib/prescriptions/navigation'],
    };
    delete allowlistEntry[missingField];

    const root = createFixtureRepo(
      {
        'src/server/services/patient-detail.ts':
          "import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';\n",
      },
      {
        entries: [allowlistEntry],
      },
    );

    expect(() => runBoundaryCheck(root)).toThrow(errorPattern);
  });

  it('prints an owner-level ratchet report for allowlisted boundary debt', () => {
    const root = createFixtureRepo(
      {
        'src/server/services/patient-detail.ts':
          "import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';\n",
      },
      {
        entries: [
          {
            path: 'src/server/services/patient-detail.ts',
            expectedCount: 1,
            owner: 'MOD-PATIENT-001',
            debtId: 'DEBT-PATIENT-001',
            reason: 'Legacy patient detail link helper imports pharmacy-specific navigation.',
            plannedAction: 'Move prescription href construction behind a pharmacy module adapter.',
            targets: ['@/lib/prescriptions/navigation'],
          },
        ],
      },
    );

    expect(runBoundaryCheck(root, { PHOS_ALLOW_MODULE_BOUNDARY_DEBT: '1' })).toContain(
      'Allowlisted module-boundary debt by owner: MOD-PATIENT-001=1.',
    );
  });
});
