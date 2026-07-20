import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect } from 'vitest';

// Shared fixtures kept outside the production inventory scope.

import {
  checkInventory,
  discoverMigrationAuthzContracts,
  discoverNonRuntimeAuthzContracts,
  discoverSurfaces,
  parseApiPermissionContracts as parseApiPermissionContractsRaw,
} from '../../check-authz-account-model-v1-inventory.mjs';

export const REPO_ROOT = process.cwd();
export const MANIFEST_PATH = 'tools/authz-account-model-v1/inventory.json';
export const CHECKER_TEST_PATH = 'tools/scripts/check-authz-account-model-v1-inventory.test.ts';
export const PERMISSION_CAPABILITIES = [
  'canVisit',
  'canManageOperationalTasks',
  'canReport',
  'canAuthorReport',
  'canSendCareReport',
  'canManageBilling',
  'canManagePatientSharing',
  'canViewDashboard',
  'canAdmin',
  'canDispense',
  'canAuditDispense',
  'canSet',
  'canAuditSet',
];
const temporaryRoots: string[] = [];

export type DeclaredSurface = {
  id: string;
  detector: string;
  path: string;
  evidence_sha256: string;
  exact_values_or_scopes: string[];
  route_method_purpose: string;
  test_refs: string[];
  binding_profile: string;
  mapping_disposition: string;
  approval_status: string;
  [key: string]: unknown;
};

export type InventoryManifest = {
  scope: {
    source_roots: string[];
    excluded_path_patterns: string[];
  };
  declared_surfaces: DeclaredSurface[];
  high_risk_contracts: Array<
    Record<string, unknown> & { id: string; source_refs: string[]; test_refs: string[] }
  >;
  browser_cutover_gate: Record<string, unknown> & {
    asset_baseline: Array<{ path: string; sha256: string }>;
    scenario_baseline: Array<{
      path: string;
      suite: string;
      title: string;
      modifier: string;
    }>;
    hard_dependency_before_legacy_deletion: boolean;
  };
  non_runtime_contract_baseline: Array<{
    path: string;
    classes: string[];
    detectors: string[];
    sha256: string;
  }>;
  migration_contract_baseline: Array<{
    path: string;
    detectors: string[];
    defines_role_enum: boolean;
    defines_rls_contract: boolean;
    sha256: string;
  }>;
  frozen_value_sets: Record<string, unknown> & {
    phos_route_contracts: Array<Record<string, unknown>>;
  };
  mapping_decisions: Array<Record<string, unknown>>;
  binding_profiles: Record<string, { default_state: string; overrides: Record<string, string> }>;
  capability_profiles: Record<string, { default_state: string; overrides: Record<string, string> }>;
  [key: string]: unknown;
};

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

export function temporaryRoot(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

export function writeRepoFile(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const fixtureContent =
    /^src\/app\/api(?:\/.*)?\/route\.[cm]?[jt]sx?$/.test(relativePath) &&
    /\b(?:withAuthContext|requireAuthContext|requireApiKeyOrAuthContext)\b/.test(content) &&
    !/from ['"]@\/lib\/auth\/context['"]/.test(content)
      ? `import { requireApiKeyOrAuthContext, requireAuthContext, withAuthContext } from '@/lib/auth/context';\n${content}`
      : content;
  writeFileSync(absolutePath, fixtureContent);
}

export function copyRepoFile(root: string, relativePath: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(path.join(REPO_ROOT, relativePath), target);
}

export function writeManifest(root: string, manifest: InventoryManifest) {
  writeRepoFile(root, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function createFixture() {
  const root = temporaryRoot('authz-account-inventory-');
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'),
  ) as InventoryManifest;
  const requiredSources = new Set([
    'Plans.md',
    'package.json',
    '.github/workflows/ci.yml',
    '.agent-loop/GATE_CONFIG.md',
    CHECKER_TEST_PATH,
    'prisma/seed.ts',
    'prisma/migrations/20260326000000_baseline/migration.sql',
    'prisma/migrations/20260703100000_add_platform_operator_break_glass/migration.sql',
    'prisma/schema/organization.prisma',
    'prisma/schema/platform.prisma',
    'src/lib/auth/permission-matrix.ts',
    'src/phos/contracts/phos_contracts.ts',
    'src/phos/infra/api-gateway-routes.ts',
    'tools/sql/authz-account-model-v1-inventory.sql',
    'tools/tests/helpers/schedule-vehicle-resource-fixtures.ts',
    ...manifest.high_risk_contracts.flatMap((entry) => [...entry.source_refs, ...entry.test_refs]),
    ...manifest.declared_surfaces.flatMap((entry) =>
      entry.test_refs.filter((testRef) => !testRef.startsWith('uncovered:')),
    ),
  ]);
  for (const sourcePath of requiredSources) copyRepoFile(root, sourcePath);
  manifest.scope = {
    source_roots: [
      'src',
      'prisma/schema',
      'tools/scripts',
      'tools/sql',
      '.github',
      'package.json',
      '.agent-loop/GATE_CONFIG.md',
    ],
    excluded_path_patterns: [
      '(?:^|/)(?:__snapshots__|fixtures?)(?:/|$)',
      '\\.(?:test|spec)\\.[cm]?[jt]sx?$',
      '(?:^|/)tools/tests/',
      '(?:^|/)tools/scripts/(?:(?:check-authz-account-model-v1-inventory|check-human-maintained-file-size)(?:\\.mjs|\\.d\\.mts)|authz-account-model-v1-inventory/[^/]+\\.mjs)$',
    ],
  };
  const discovered = discoverSurfaces(root, manifest.scope);
  const ids = new Set(discovered.map((entry) => `${entry.detector}:${entry.path}`));
  manifest.declared_surfaces = manifest.declared_surfaces.filter((entry) => ids.has(entry.id));
  const usedBindingProfiles = new Set(
    manifest.declared_surfaces.map((entry) => entry.binding_profile),
  );
  const usedCapabilityProfiles = new Set(
    manifest.declared_surfaces.map((entry) => String(entry.capability_profile)),
  );
  manifest.binding_profiles = Object.fromEntries(
    Object.entries(manifest.binding_profiles).filter(([id]) => usedBindingProfiles.has(id)),
  );
  manifest.capability_profiles = Object.fromEntries(
    Object.entries(manifest.capability_profiles).filter(([id]) => usedCapabilityProfiles.has(id)),
  );
  manifest.non_runtime_contract_baseline = discoverNonRuntimeAuthzContracts(root);
  manifest.migration_contract_baseline = discoverMigrationAuthzContracts(root);
  writeManifest(root, manifest);
  return { root, manifest };
}

export function expectInventoryFailure(
  root: string,
  message: RegExp,
  label = 'inventory mutation',
) {
  expect(
    () =>
      checkInventory({
        repoRoot: root,
        manifestPath: MANIFEST_PATH,
        validateBrowser: false,
      }),
    label,
  ).toThrowError(message);
}

export function cloneManifest(manifest: InventoryManifest) {
  return structuredClone(manifest);
}

export function parsePermissionFixture(sourcePath: string, content: string, repoRoot = REPO_ROOT) {
  return parseApiPermissionContractsRaw(
    sourcePath,
    `import { requireApiKeyOrAuthContext, requireAuthContext, withAuthContext } from '@/lib/auth/context';\nimport { hasPermission } from '@/lib/auth/permissions';\n${content}`,
    repoRoot,
  );
}

export function writePlaywrightFixtureConfig(root: string) {
  writeRepoFile(root, 'playwright.config.ts', "export default { testDir: './tools/tests' };\n");
}
