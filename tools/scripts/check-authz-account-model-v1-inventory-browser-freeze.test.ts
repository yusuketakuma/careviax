import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discoverBrowserAssets,
  discoverBrowserScenarios,
  validateBrowserFreeze,
} from './check-authz-account-model-v1-inventory.mjs';
import {
  type InventoryManifest,
  MANIFEST_PATH,
  REPO_ROOT,
  temporaryRoot,
  writePlaywrightFixtureConfig,
  writeRepoFile,
} from './authz-account-model-v1-inventory/fixtures/test-fixtures';
import {
  sourceContainsDynamicModuleLoader,
  sourceReferencesPlaywrightPackage,
} from './authz-account-model-v1-inventory/browser-module-detection.mjs';

describe('check-authz-account-model-v1-inventory browser freeze', { timeout: 120_000 }, () => {
  it('recognizes Playwright subpaths and statically resolvable loader aliases', () => {
    expect(
      sourceReferencesPlaywrightPackage(
        'src/reporter.mts',
        "import type { Reporter } from '@playwright/test/reporter';\n",
      ),
    ).toBe(true);
    for (const source of [
      "const { createRequire: cr } = require('node:module'); const req = cr(import.meta.url); const pkg = '@play' + 'wright/test'; req(pkg);",
      "import Module from 'node:module'; const req = Module.createRequire(import.meta.url); const pkg = '@play' + 'wright/test'; req(pkg);",
      "const req = require.bind(null); const pkg = '@play' + 'wright/test'; req(pkg);",
    ]) {
      expect(sourceReferencesPlaywrightPackage('src/neutral-loader.mts', source)).toBe(true);
    }
    expect(
      sourceReferencesPlaywrightPackage(
        'src/joined-loader.mts',
        "const pkg = '@' + ['play', 'wright'].join('') + '/test'; import(pkg);",
      ),
    ).toBe(true);
    expect(
      sourceContainsDynamicModuleLoader(
        'src/encoded-loader.mts',
        'const pkg = String.fromCharCode(112, 108, 97, 121); import(pkg);',
      ),
    ).toBe(true);
    for (const source of [
      'const pkg = String.fromCharCode(112, 108, 97, 121); require(pkg);',
      'const req = require; const pkg = Buffer.from("cGxheXdyaWdodA==", "base64").toString(); req(pkg);',
      'const req = require.bind(null); const pkg = String.fromCharCode(112); req(pkg);',
      'import { createRequire as makeRequire } from "node:module"; const req = makeRequire(import.meta.url); req(String.fromCharCode(112));',
      'const { createRequire: makeRequire } = require("node:module"); const req = makeRequire(import.meta.url); req(Buffer.from("cA==", "base64").toString());',
      'import Module from "node:module"; const req = Module.createRequire(import.meta.url); req(String.fromCharCode(112));',
    ]) {
      expect(sourceContainsDynamicModuleLoader('src/dynamic-loader.mts', source)).toBe(true);
    }
    expect(
      sourceContainsDynamicModuleLoader(
        'src/non-loader.mts',
        'const inspect = (value: string) => value; inspect(process.env.VALUE);',
      ),
    ).toBe(false);
  });

  it('freezes every Playwright asset and scenario before cutover', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'),
    ) as InventoryManifest;
    expect(discoverBrowserAssets(REPO_ROOT)).toEqual(manifest.browser_cutover_gate.asset_baseline);
    expect(discoverBrowserScenarios(REPO_ROOT)).toEqual(
      manifest.browser_cutover_gate.scenario_baseline,
    );

    const root = temporaryRoot('authz-browser-freeze-');
    mkdirSync(path.join(root, 'tools/tests'), { recursive: true });
    mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
    for (let index = 0; index < 29; index += 1) {
      writeRepoFile(
        root,
        `tools/tests/scenario-${index}.spec.ts`,
        `test('scenario ${index}', async () => {});\n`,
      );
    }
    const executableSpecExtensions = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'];
    for (const [offset, extension] of executableSpecExtensions.entries()) {
      const index = 21 + offset;
      if (extension !== 'ts') unlinkSync(path.join(root, `tools/tests/scenario-${index}.spec.ts`));
      writeRepoFile(
        root,
        `tools/tests/scenario-${index}.spec.${extension}`,
        `test('extension ${extension}', async () => {});\n`,
      );
    }
    writeRepoFile(
      root,
      'tools/tests/scenario-0.spec.ts',
      [
        "import './helpers/browser-helper';",
        "const ROUTES = [{ path: '/alpha' }, { path: '/beta' }] as const;",
        "const VIEWPORTS = ['desktop', 'mobile'] as const;",
        'for (const route of ROUTES) {',
        '  for (const viewport of VIEWPORTS) {',
        '    test(`${route.path} ${viewport} renders`, async () => {});',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const snapshotPath = path.join(
      root,
      'tools/tests/ui-visual-regression.spec.ts-snapshots/example-chromium.png',
    );
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
    for (const config of [
      'playwright.config.ts',
      'playwright.local.config.ts',
      'playwright.audit.config.ts',
      'playwright.production-parity.config.ts',
    ]) {
      writeRepoFile(root, config, "export default { testDir: './tools/tests' };\n");
    }
    writeRepoFile(
      root,
      'package.json',
      JSON.stringify({
        scripts: {
          'start:e2e:local': 'tsx tools/scripts/start-next-standalone.ts',
          'test:e2e:harness:patient-detail':
            'sh tools/browser-harness/run.sh < tools/browser-harness/patient-detail-smoke.py',
        },
        devDependencies: { '@playwright/test': '1.0.0', '@axe-core/playwright': '1.0.0' },
      }),
    );
    writeRepoFile(
      root,
      'tools/tests/helpers/browser-helper.ts',
      "import '../../scripts/browser-core';\n",
    );
    writeRepoFile(
      root,
      'tools/scripts/browser-core.ts',
      "export * from './browser-leaf';\nexport * from '../shared/browser-shared';\n",
    );
    writeRepoFile(root, 'tools/scripts/browser-leaf.ts', 'export const browserLeaf = true;\n');
    writeRepoFile(root, 'tools/shared/browser-shared.ts', 'export const browserShared = true;\n');
    writeRepoFile(root, 'tools/scripts/start-next-standalone.ts', 'export {};\n');
    writeRepoFile(root, 'tools/browser-harness/README.md', '# Browser harness\n');
    writeRepoFile(root, 'tools/browser-harness/run.sh', '#!/usr/bin/env sh\nexit 0\n');
    writeRepoFile(root, 'tools/browser-harness/patient-detail-smoke.py', 'print("ok")\n');
    writeRepoFile(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    writeRepoFile(root, '.github/workflows/ci.yml', 'playwright: frozen\n');
    writeRepoFile(root, '.agent-loop/GATE_CONFIG.md', 'playwright frozen\n');
    writeRepoFile(
      root,
      'tools/scripts/playwright-preflight.test.ts',
      "import { chromium } from '@playwright/test';\nvoid chromium;\n",
    );
    writeRepoFile(root, 'next.config.ts', 'export const browser = process.env.PLAYWRIGHT;\n');
    writeRepoFile(
      root,
      'src/runtime-browser-gate.ts',
      "export const browserGate = process.env.PLAYWRIGHT === '1';\n",
    );
    writeRepoFile(
      root,
      'src/neutral-runner.mts',
      "const req = require;\nconst packageName = '@play' + 'wright/test';\nvoid req(packageName);\n",
    );
    writeRepoFile(
      root,
      'src/create-require-runner.cts',
      "import { createRequire as makeRequire } from 'node:module';\nconst req = makeRequire(import.meta.url);\nconst packageName = '@play' + 'wright/test';\nvoid req(packageName);\n",
    );
    writeRepoFile(root, 'docs/env-catalog.md', '# Playwright environment contract\n');
    writeRepoFile(root, 'docs/testing/TESTING.md', '# Playwright execution contract\n');
    const gate = {
      asset_baseline: discoverBrowserAssets(root),
      scenario_baseline: discoverBrowserScenarios(root),
    };
    expect(gate.scenario_baseline).toEqual(
      expect.arrayContaining([
        {
          path: 'tools/tests/scenario-0.spec.ts',
          suite: '',
          title: '/alpha desktop renders',
          modifier: 'run',
        },
        {
          path: 'tools/tests/scenario-0.spec.ts',
          suite: '',
          title: '/alpha mobile renders',
          modifier: 'run',
        },
        {
          path: 'tools/tests/scenario-0.spec.ts',
          suite: '',
          title: '/beta desktop renders',
          modifier: 'run',
        },
        {
          path: 'tools/tests/scenario-0.spec.ts',
          suite: '',
          title: '/beta mobile renders',
          modifier: 'run',
        },
      ]),
    );
    expect(gate.scenario_baseline.some((entry) => entry.title.includes('${'))).toBe(false);
    for (const extension of executableSpecExtensions) {
      expect(gate.scenario_baseline.some((entry) => entry.title === `extension ${extension}`)).toBe(
        true,
      );
    }
    expect(gate.asset_baseline.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'tools/tests/helpers/browser-helper.ts',
        'tools/scripts/browser-core.ts',
        'tools/scripts/browser-leaf.ts',
        'tools/shared/browser-shared.ts',
        'tools/scripts/start-next-standalone.ts',
        'tools/browser-harness/README.md',
        'tools/browser-harness/run.sh',
        'tools/browser-harness/patient-detail-smoke.py',
        'tools/scripts/playwright-preflight.test.ts',
        'next.config.ts',
        'src/runtime-browser-gate.ts',
        'src/neutral-runner.mts',
        'src/create-require-runner.cts',
        'docs/env-catalog.md',
        'docs/testing/TESTING.md',
      ]),
    );
    expect(() => validateBrowserFreeze(root, gate)).not.toThrow();
    writeRepoFile(
      root,
      'src/neutral-runner.mts',
      "const packageName = `@play${'wright/test'}`;\nvoid import(packageName);\n",
    );
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(
      root,
      'src/neutral-runner.mts',
      "const req = require;\nconst packageName = '@play' + 'wright/test';\nvoid req(packageName);\n",
    );
    writeRepoFile(root, 'next.config.ts', 'export const browser = process.env.PLAYWRIGHT_TEST;\n');
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(root, 'next.config.ts', 'export const browser = process.env.PLAYWRIGHT;\n');
    unlinkSync(path.join(root, 'docs/env-catalog.md'));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(root, 'docs/env-catalog.md', '# Playwright environment contract\n');
    writeRepoFile(root, 'tools/browser-harness/run.sh', '#!/usr/bin/env sh\nexit 1\n');
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(root, 'tools/browser-harness/run.sh', '#!/usr/bin/env sh\nexit 0\n');
    unlinkSync(path.join(root, 'tools/browser-harness/patient-detail-smoke.py'));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(
      /browser package script asset missing|browser asset freeze drift/,
    );
    writeRepoFile(root, 'tools/browser-harness/patient-detail-smoke.py', 'print("ok")\n');
    writeRepoFile(root, 'tools/shared/browser-shared.ts', 'export const browserShared = false;\n');
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(root, 'tools/shared/browser-shared.ts', 'export const browserShared = true;\n');
    unlinkSync(path.join(root, 'tools/shared/browser-shared.ts'));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(
      /browser asset dependency unresolved/,
    );
    writeRepoFile(root, 'tools/shared/browser-shared.ts', 'export const browserShared = true;\n');
    writeRepoFile(root, 'tools/scripts/browser-leaf.ts', 'export const browserLeaf = false;\n');
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeRepoFile(root, 'tools/scripts/browser-leaf.ts', 'export const browserLeaf = true;\n');
    unlinkSync(path.join(root, 'tools/scripts/browser-leaf.ts'));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(
      /browser asset dependency unresolved/,
    );
    writeRepoFile(root, 'tools/scripts/browser-leaf.ts', 'export const browserLeaf = true;\n');
    unlinkSync(path.join(root, 'tools/tests/scenario-0.spec.ts'));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(
      /Playwright spec baseline must remain 29|browser asset freeze drift/,
    );
    writeRepoFile(
      root,
      'tools/tests/scenario-0.spec.ts',
      [
        "import './helpers/browser-helper';",
        "const ROUTES = [{ path: '/alpha' }, { path: '/beta' }] as const;",
        "const VIEWPORTS = ['desktop', 'mobile'] as const;",
        'for (const route of ROUTES) {',
        '  for (const viewport of VIEWPORTS) {',
        '    test(`${route.path} ${viewport} renders`, async () => {});',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    unlinkSync(snapshotPath);
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeFileSync(snapshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0xff]));
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(/browser asset freeze drift/);
    writeFileSync(snapshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
    expect(() => validateBrowserFreeze(root, gate)).not.toThrow();
    writeRepoFile(root, 'playwright.extra.config.mts', "export default { testDir: './e2e' };\n");
    writeRepoFile(
      root,
      'e2e/new-entrypoint.spec.mjs',
      "import './helpers/new-helper.mjs';\ntest('new root', async () => {});\n",
    );
    writeRepoFile(root, 'e2e/helpers/new-helper.mjs', 'export const helper = true;\n');
    expect(discoverBrowserScenarios(root)).toEqual(
      expect.arrayContaining([
        {
          path: 'e2e/new-entrypoint.spec.mjs',
          suite: '',
          title: 'new root',
          modifier: 'run',
        },
      ]),
    );
    expect(() => validateBrowserFreeze(root, gate)).toThrowError(
      /Playwright spec baseline must remain 29|Playwright config baseline must remain 4|browser asset freeze drift/,
    );
    const expandedAssets = discoverBrowserAssets(root);
    expect(expandedAssets.map((entry) => entry.path)).toContain('e2e/helpers/new-helper.mjs');
    writeRepoFile(root, 'e2e/helpers/new-helper.mjs', 'export const helper = false;\n');
    expect(discoverBrowserAssets(root)).not.toEqual(expandedAssets);
    unlinkSync(path.join(root, 'e2e/helpers/new-helper.mjs'));
    expect(() => discoverBrowserAssets(root)).toThrowError(/browser asset dependency unresolved/);

    const inheritedConfigRoot = temporaryRoot('authz-browser-config-inherited-');
    mkdirSync(path.join(inheritedConfigRoot, 'tools/tests'), { recursive: true });
    mkdirSync(path.join(inheritedConfigRoot, 'tools/scripts'), { recursive: true });
    writeRepoFile(
      inheritedConfigRoot,
      'playwright.base.config.ts',
      "export default { testDir: './inherited-e2e' };\n",
    );
    writeRepoFile(
      inheritedConfigRoot,
      'playwright.config.ts',
      [
        "import baseConfig from './playwright.base.config';",
        'const effectiveConfig = { ...baseConfig };',
        'export default effectiveConfig;',
        '',
      ].join('\n'),
    );
    writeRepoFile(
      inheritedConfigRoot,
      'inherited-e2e/inherited.spec.ts',
      "test('inherited root', async () => {});\n",
    );
    expect(discoverBrowserScenarios(inheritedConfigRoot)).toEqual([
      {
        path: 'inherited-e2e/inherited.spec.ts',
        suite: '',
        title: 'inherited root',
        modifier: 'run',
      },
    ]);

    const decoyConfigRoot = temporaryRoot('authz-browser-config-decoy-');
    writeRepoFile(decoyConfigRoot, 'tools/tests/decoy.spec.ts', "test('decoy', async () => {});\n");
    writeRepoFile(
      decoyConfigRoot,
      'playwright.config.ts',
      [
        "const decoy = { testDir: './tools/tests' };",
        'void decoy;',
        'export default { testDir: process.env.PLAYWRIGHT_TEST_DIR };',
        '',
      ].join('\n'),
    );
    expect(() => discoverBrowserScenarios(decoyConfigRoot)).toThrowError(
      /Playwright config testDir is not statically resolved/,
    );

    const unusedImportRoot = temporaryRoot('authz-browser-config-unused-import-');
    writeRepoFile(
      unusedImportRoot,
      'playwright.unused.config.ts',
      "export default { testDir: './tools/tests' };\n",
    );
    writeRepoFile(
      unusedImportRoot,
      'playwright.config.ts',
      [
        "import unusedConfig from './playwright.unused.config';",
        'void unusedConfig;',
        'export default { testDir: resolveTestDirectory() };',
        '',
      ].join('\n'),
    );
    writeRepoFile(
      unusedImportRoot,
      'tools/tests/unused.spec.ts',
      "test('unused', async () => {});\n",
    );
    expect(() => discoverBrowserScenarios(unusedImportRoot)).toThrowError(
      /Playwright config testDir is not statically resolved/,
    );

    const canonicalDefineConfigRoot = temporaryRoot('authz-browser-config-canonical-call-');
    mkdirSync(path.join(canonicalDefineConfigRoot, 'tools/scripts'), { recursive: true });
    writeRepoFile(
      canonicalDefineConfigRoot,
      'playwright.config.ts',
      [
        "import { defineConfig as makeConfig } from '@playwright/test';",
        "export default makeConfig({ testDir: './tools/tests' });",
        '',
      ].join('\n'),
    );
    writeRepoFile(
      canonicalDefineConfigRoot,
      'playwright.namespace.config.ts',
      [
        "import * as playwright from '@playwright/test';",
        "export default playwright.defineConfig({ testDir: './tools/tests' });",
        '',
      ].join('\n'),
    );
    writeRepoFile(
      canonicalDefineConfigRoot,
      'tools/tests/canonical.spec.ts',
      "test('canonical config', async () => {});\n",
    );
    expect(discoverBrowserScenarios(canonicalDefineConfigRoot)).toEqual([
      {
        path: 'tools/tests/canonical.spec.ts',
        suite: '',
        title: 'canonical config',
        modifier: 'run',
      },
    ]);

    for (const [name, configSource] of [
      [
        'local-call',
        "const defineConfig = () => ({ testDir: process.env.DYNAMIC }); export default defineConfig({ testDir: './tools/tests' });\n",
      ],
      [
        'wrong-module-call',
        "import { defineConfig } from './telemetry'; export default defineConfig({ testDir: './tools/tests' });\n",
      ],
      [
        'object-member-call',
        "const helper = { defineConfig: () => ({ testDir: process.env.DYNAMIC }) }; export default helper.defineConfig({ testDir: './tools/tests' });\n",
      ],
    ] as const) {
      const noncanonicalRoot = temporaryRoot(`authz-browser-config-${name}-`);
      mkdirSync(path.join(noncanonicalRoot, 'tools/scripts'), { recursive: true });
      writeRepoFile(
        noncanonicalRoot,
        'tools/tests/noncanonical.spec.ts',
        "test('noncanonical', async () => {});\n",
      );
      writeRepoFile(noncanonicalRoot, 'playwright.config.ts', configSource);
      expect(() => discoverBrowserScenarios(noncanonicalRoot)).toThrowError(
        /Playwright config default export call is not statically supported/,
      );
    }

    const modifierRoot = temporaryRoot('authz-browser-modifier-');
    mkdirSync(path.join(modifierRoot, 'tools/scripts'), { recursive: true });
    writePlaywrightFixtureConfig(modifierRoot);
    writeRepoFile(
      modifierRoot,
      'tools/tests/modifier.spec.ts',
      [
        "test.only('focused scenario', async () => {});",
        "test.skip('skipped scenario', async () => {});",
        "test.skip(process.env.SKIP === '1', 'conditional annotation');",
        '',
      ].join('\n'),
    );
    expect(discoverBrowserScenarios(modifierRoot)).toEqual([
      {
        path: 'tools/tests/modifier.spec.ts',
        suite: '',
        title: 'focused scenario',
        modifier: 'only',
      },
      {
        path: 'tools/tests/modifier.spec.ts',
        suite: '',
        title: 'skipped scenario',
        modifier: 'skip',
      },
    ]);

    const importedRoot = temporaryRoot('authz-browser-imported-');
    mkdirSync(path.join(importedRoot, 'tools/scripts'), { recursive: true });
    writePlaywrightFixtureConfig(importedRoot);
    writeRepoFile(
      importedRoot,
      'tools/tests/helpers/cases.ts',
      "export const CASES = [{ name: 'alpha' }, { name: 'beta' }] as const;\n",
    );
    writeRepoFile(
      importedRoot,
      'tools/tests/imported.spec.ts',
      [
        "import { CASES } from './helpers/cases';",
        'for (const item of CASES) {',
        '  test(`${item.name} imported`, async () => {});',
        '}',
        '',
      ].join('\n'),
    );
    expect(discoverBrowserScenarios(importedRoot)).toEqual([
      {
        path: 'tools/tests/imported.spec.ts',
        suite: '',
        title: 'alpha imported',
        modifier: 'run',
      },
      {
        path: 'tools/tests/imported.spec.ts',
        suite: '',
        title: 'beta imported',
        modifier: 'run',
      },
    ]);
    writeRepoFile(
      importedRoot,
      'tools/tests/helpers/cases.ts',
      [
        "const LABEL = 'actual';",
        "const BASE = ['base'] as const;",
        'export const CASES = [...BASE, LABEL] as const;',
        '',
      ].join('\n'),
    );
    writeRepoFile(
      importedRoot,
      'tools/tests/helpers/reexport.ts',
      "export { CASES as RENAMED_CASES } from './cases';\n",
    );
    writeRepoFile(
      importedRoot,
      'tools/tests/imported.spec.ts',
      [
        "import { RENAMED_CASES } from './helpers/reexport';",
        "const LABEL = 'wrong';",
        'for (const item of RENAMED_CASES) {',
        '  test(`${item} imported`, async () => {});',
        '}',
        '',
      ].join('\n'),
    );
    expect(discoverBrowserScenarios(importedRoot)).toEqual([
      {
        path: 'tools/tests/imported.spec.ts',
        suite: '',
        title: 'actual imported',
        modifier: 'run',
      },
      {
        path: 'tools/tests/imported.spec.ts',
        suite: '',
        title: 'base imported',
        modifier: 'run',
      },
    ]);
    writeRepoFile(
      importedRoot,
      'tools/tests/helpers/cycle-a.ts',
      "export { CASES } from './cycle-b';\n",
    );
    writeRepoFile(
      importedRoot,
      'tools/tests/helpers/cycle-b.ts',
      "export { CASES } from './cycle-a';\n",
    );
    writeRepoFile(
      importedRoot,
      'tools/tests/imported.spec.ts',
      [
        "import { CASES } from './helpers/cycle-a';",
        'for (const item of CASES) test(`${item} cycle`, async () => {});',
        '',
      ].join('\n'),
    );
    expect(() => discoverBrowserScenarios(importedRoot)).toThrowError(
      /parameterized scenario is not statically enumerable/,
    );

    const suiteRoot = temporaryRoot('authz-browser-suites-');
    mkdirSync(path.join(suiteRoot, 'tools/scripts'), { recursive: true });
    writePlaywrightFixtureConfig(suiteRoot);
    writeRepoFile(
      suiteRoot,
      'tools/tests/suites.spec.ts',
      [
        "test.describe('alpha suite', () => { test('same title', async () => {}); });",
        "test.describe('beta suite', () => { test('same title', async () => {}); });",
        '',
      ].join('\n'),
    );
    expect(discoverBrowserScenarios(suiteRoot)).toEqual([
      {
        path: 'tools/tests/suites.spec.ts',
        suite: 'alpha suite',
        title: 'same title',
        modifier: 'run',
      },
      {
        path: 'tools/tests/suites.spec.ts',
        suite: 'beta suite',
        title: 'same title',
        modifier: 'run',
      },
    ]);

    for (const [name, unsupported, message] of [
      [
        'each',
        "test.each([['a'], ['b']])('%s case', async () => {});\n",
        /test\.each scenario registration is unsupported/,
      ],
      [
        'classic-loop',
        "for (let index = 0; index < 2; index += 1) test('scenario ' + index, async () => {});\n",
        /classic-loop scenario registration is unsupported/,
      ],
      [
        'foreach',
        "['a', 'b'].forEach((name) => test(name, async () => {}));\n",
        /forEach scenario registration is unsupported/,
      ],
      [
        'filtered',
        "const CASES = ['a', 'b'].filter(Boolean); for (const name of CASES) test(name, async () => {});\n",
        /parameterized scenario is not statically enumerable/,
      ],
      [
        'duplicate',
        "test('same', async () => {}); test('same', async () => {});\n",
        /duplicate browser scenario identity/,
      ],
      [
        'factory',
        "function register() { test('never', async () => {}); }\n",
        /registration factory is unsupported/,
      ],
      [
        'callback-factory',
        "register(() => test('maybe', async () => {}));\n",
        /registration callback factory is unsupported/,
      ],
    ] as const) {
      const unsupportedRoot = temporaryRoot(`authz-browser-${name}-`);
      mkdirSync(path.join(unsupportedRoot, 'tools/scripts'), { recursive: true });
      writePlaywrightFixtureConfig(unsupportedRoot);
      writeRepoFile(unsupportedRoot, `tools/tests/${name}.spec.ts`, unsupported);
      expect(() => discoverBrowserScenarios(unsupportedRoot)).toThrowError(message);
    }
  });
});
