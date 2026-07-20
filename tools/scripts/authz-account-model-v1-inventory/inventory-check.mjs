import {
  assert,
  DEFAULT_MANIFEST_PATH,
  OVERRIDE_FLAGS,
  PERMISSION_CAPABILITIES,
  PHOS_ROLES,
  PLATFORM_ROLES,
  readRepoFile,
  REQUIRED_BINDINGS,
  REQUIRED_CAPABILITIES,
  REQUIRED_LIFECYCLES,
  REQUIRED_PRINCIPALS,
  REQUIRED_SURFACES,
  sha256,
  stableJson,
  TENANT_ROLES,
} from './core.mjs';
import { validateBrowserFreeze } from './browser-freeze.mjs';
import {
  validateDeclaredSurfaces,
  validateHighRiskContracts,
  validateTopLevelGates,
} from './manifest-validation.mjs';
import {
  discoverMigrationAuthzContracts,
  discoverNonRuntimeAuthzContracts,
  discoverSurfaces,
  exactArray,
  parsePermissionKeys,
  parsePhosRoles,
  parsePhosRouteContracts,
  parsePhosScopes,
  parsePrismaEnum,
} from './surface-discovery.mjs';

export function checkInventory({
  repoRoot = process.cwd(),
  manifestPath = DEFAULT_MANIFEST_PATH,
  validateBrowser = true,
} = {}) {
  const manifest = JSON.parse(readRepoFile(repoRoot, manifestPath, 'manifest'));
  assert(manifest.schema_version === 2, 'unsupported inventory schema version');
  assert(manifest.mode === 'static_source_and_safe_query_preparation', 'invalid inventory mode');
  exactArray(manifest.taxonomy.principals, REQUIRED_PRINCIPALS, 'principal taxonomy');
  exactArray(manifest.taxonomy.lifecycles, REQUIRED_LIFECYCLES, 'lifecycle taxonomy');
  exactArray(manifest.taxonomy.surfaces, REQUIRED_SURFACES, 'surface taxonomy');
  exactArray(manifest.taxonomy.bindings, REQUIRED_BINDINGS, 'binding taxonomy');
  exactArray(manifest.taxonomy.capabilities, REQUIRED_CAPABILITIES, 'capability taxonomy');
  exactArray(manifest.frozen_value_sets.tenant_member_roles, TENANT_ROLES, 'tenant roles');
  exactArray(manifest.frozen_value_sets.platform_roles, PLATFORM_ROLES, 'platform roles');
  exactArray(manifest.frozen_value_sets.phos_roles, PHOS_ROLES, 'PHOS roles');
  exactArray(manifest.frozen_value_sets.override_flags, OVERRIDE_FLAGS, 'override flags');
  exactArray(
    manifest.frozen_value_sets.permission_capabilities,
    PERMISSION_CAPABILITIES,
    'permission capabilities',
  );

  const organizationSchema = readRepoFile(repoRoot, 'prisma/schema/organization.prisma');
  const platformSchema = readRepoFile(repoRoot, 'prisma/schema/platform.prisma');
  const phosContracts = readRepoFile(repoRoot, 'src/phos/contracts/phos_contracts.ts');
  const permissionMatrix = readRepoFile(repoRoot, 'src/lib/auth/permission-matrix.ts');
  const routeContract = readRepoFile(repoRoot, 'src/phos/infra/api-gateway-routes.ts');
  exactArray(parsePrismaEnum(organizationSchema, 'MemberRole'), TENANT_ROLES, 'live MemberRole');
  exactArray(
    parsePrismaEnum(platformSchema, 'PlatformOperatorRole'),
    PLATFORM_ROLES,
    'live PlatformOperatorRole',
  );
  exactArray(parsePhosRoles(phosContracts), PHOS_ROLES, 'live PHOS UserRole');
  exactArray(
    parsePermissionKeys(permissionMatrix),
    manifest.frozen_value_sets.permission_capabilities,
    'permission capabilities',
  );
  exactArray(parsePhosScopes(routeContract), manifest.frozen_value_sets.phos_scopes, 'PHOS scopes');
  exactArray(
    parsePhosRouteContracts(routeContract),
    manifest.frozen_value_sets.phos_route_contracts,
    'PHOS route contracts',
  );
  for (const flag of OVERRIDE_FLAGS)
    assert(
      new RegExp(`\\b${flag}\\b`).test(organizationSchema),
      `live override flag missing: ${flag}`,
    );

  validateTopLevelGates(repoRoot, manifest);
  validateHighRiskContracts(repoRoot, manifest.high_risk_contracts);
  const discovered = discoverSurfaces(repoRoot, manifest.scope);
  validateDeclaredSurfaces(
    repoRoot,
    manifest.declared_surfaces,
    discovered,
    manifest.binding_profiles,
    manifest.capability_profiles,
  );
  const nonRuntimeContracts = discoverNonRuntimeAuthzContracts(repoRoot);
  assert(
    Array.isArray(manifest.non_runtime_contract_baseline),
    'non-runtime authz contract baseline must be an array',
  );
  assert(
    nonRuntimeContracts.some(
      (entry) => entry.path === 'prisma/seed.ts' && entry.classes.includes('seed'),
    ),
    'prisma seed authz contract must remain classified',
  );
  assert(
    nonRuntimeContracts.some((entry) => entry.classes.includes('test')),
    'test authz contract discovery must not be empty',
  );
  assert(
    nonRuntimeContracts.some((entry) => entry.classes.includes('fixture')),
    'fixture authz contract discovery must not be empty',
  );
  assert(
    nonRuntimeContracts.some((entry) => entry.classes.includes('tooling')),
    'tooling authz contract discovery must not be empty',
  );
  assert(
    stableJson(nonRuntimeContracts) === stableJson(manifest.non_runtime_contract_baseline),
    'non-runtime authz contract freeze drift',
  );
  const migrationContracts = discoverMigrationAuthzContracts(repoRoot);
  assert(
    Array.isArray(manifest.migration_contract_baseline),
    'migration authz contract baseline must be an array',
  );
  assert(
    migrationContracts.some((entry) => entry.defines_role_enum),
    'migration role enum contract discovery must not be empty',
  );
  assert(
    migrationContracts.some((entry) => entry.defines_rls_contract),
    'migration RLS contract discovery must not be empty',
  );
  assert(
    stableJson(migrationContracts) === stableJson(manifest.migration_contract_baseline),
    'migration authz contract freeze drift',
  );
  if (validateBrowser) validateBrowserFreeze(repoRoot, manifest.browser_cutover_gate);
  return {
    entries: discovered.length,
    digest: sha256(stableJson(discovered)),
    detectors: new Set(discovered.map((entry) => entry.detector)).size,
    browserAssets: manifest.browser_cutover_gate.asset_baseline.length,
    browserScenarios: manifest.browser_cutover_gate.scenario_baseline.length,
    nonRuntimeContracts: nonRuntimeContracts.length,
    migrationContracts: migrationContracts.length,
  };
}
