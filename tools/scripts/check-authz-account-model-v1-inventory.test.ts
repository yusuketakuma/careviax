import { mkdirSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertNoUnsupportedRoleAccess,
  AuthzInventoryError,
  checkInventory,
  discoverMigrationAuthzContracts,
  discoverNonRuntimeAuthzContracts,
  discoverSurfaces,
} from './check-authz-account-model-v1-inventory.mjs';
import {
  CHECKER_TEST_PATH,
  cloneManifest,
  copyRepoFile,
  createFixture,
  expectInventoryFailure,
  type InventoryManifest,
  MANIFEST_PATH,
  PERMISSION_CAPABILITIES,
  REPO_ROOT,
  temporaryRoot,
  writeManifest,
  writeRepoFile,
} from './authz-account-model-v1-inventory/fixtures/test-fixtures';

// Repository-wide discovery hashes hundreds of source and browser assets per case.
describe('check-authz-account-model-v1-inventory', { timeout: 120_000 }, () => {
  it('accepts the checked-in independent declarations while the dedicated suite owns browser freeze', () => {
    expect(checkInventory({ validateBrowser: false })).toEqual({
      entries: 975,
      detectors: 15,
      browserAssets: 448,
      browserScenarios: 381,
      nonRuntimeContracts: expect.any(Number),
      migrationContracts: 58,
      digest: expect.any(String),
    });
  });

  it('freezes role-bearing seed, test, and fixture contracts independently', () => {
    const root = temporaryRoot('authz-non-runtime-contracts-');
    writeRepoFile(root, 'prisma/seed.ts', "export const role = 'admin';\n");
    writeRepoFile(root, 'src/auth.test.ts', "export const permission = 'canVisit';\n");
    writeRepoFile(root, 'tools/fixtures/auth.json', '{"role":"pharmacist"}\n');
    const baseline = discoverNonRuntimeAuthzContracts(root);
    expect(baseline).toHaveLength(3);
    expect(baseline.flatMap((entry) => entry.classes)).toEqual(
      expect.arrayContaining(['seed', 'test', 'fixture']),
    );
    writeRepoFile(root, 'prisma/seed.ts', "export const role = 'owner';\n");
    expect(discoverNonRuntimeAuthzContracts(root)).not.toEqual(baseline);
    writeRepoFile(root, 'prisma/seed.ts', "export const role = 'admin';\n");
    unlinkSync(path.join(root, 'src/auth.test.ts'));
    expect(discoverNonRuntimeAuthzContracts(root)).not.toEqual(baseline);
    writeRepoFile(root, 'src/auth.test.ts', "export const permission = 'canVisit';\n");
    writeRepoFile(root, 'src/new-auth.spec.ts', "export const permission = 'canAdmin';\n");
    expect(discoverNonRuntimeAuthzContracts(root)).toHaveLength(4);
  });

  it('freezes executable migration role and RLS contracts independently', () => {
    const root = temporaryRoot('authz-migration-contracts-');
    copyRepoFile(root, 'prisma/migrations/20260326000000_baseline/migration.sql');
    copyRepoFile(
      root,
      'prisma/migrations/20260703100000_add_platform_operator_break_glass/migration.sql',
    );
    const baseline = discoverMigrationAuthzContracts(root);
    expect(baseline.some((entry) => entry.defines_role_enum)).toBe(true);
    expect(baseline.some((entry) => entry.defines_rls_contract)).toBe(true);
    const sourcePath = 'prisma/migrations/20260326000000_baseline/migration.sql';
    const content = readFileSync(path.join(root, sourcePath), 'utf8');
    writeRepoFile(root, sourcePath, content.replace("'clerk'", "'clerk_changed'"));
    expect(discoverMigrationAuthzContracts(root)).not.toEqual(baseline);
    writeRepoFile(
      root,
      'prisma/migrations/20260721000000_role_grant/migration.sql',
      'CREATE ROLE reporting_reader; GRANT SELECT ON TABLE "User" TO reporting_reader;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000001_disable_rls/migration.sql',
      'ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000002_commented_rls/migration.sql',
      'ALTER TABLE "User" DISABLE /* outer /* nested */ comment */ ROW -- split\n LEVEL SECURITY;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000003_comment_only/migration.sql',
      '-- canAdmin MemberRole CREATE POLICY ignored ON t USING (true);\nSELECT 1;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000004_inert_function/migration.sql',
      "CREATE FUNCTION note_only() RETURNS void AS $$ BEGIN RAISE NOTICE 'DISABLE ROW LEVEL SECURITY'; END $$ LANGUAGE plpgsql;\n",
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000005_dynamic_rls/migration.sql',
      'DO $body$ BEGIN EXECUTE \'ALTER TABLE "Membership" DISABLE ROW LEVEL SECURITY\'; END $body$;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000006_dynamic_rls_string/migration.sql',
      "DO 'BEGIN EXECUTE ''ALTER TABLE \"Patient\" DISABLE ROW LEVEL SECURITY''; END';\n",
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000007_dynamic_rls_language/migration.sql',
      'DO LANGUAGE plpgsql $$ BEGIN EXECUTE \'ALTER TABLE "User" NO FORCE ROW LEVEL SECURITY\'; END $$;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000008_dynamic_rls_escape/migration.sql',
      "DO E'BEGIN EXECUTE ''ALTER TABLE \"User\" DISABLE ROW LEVEL SECURITY''; END';\n",
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000009_dynamic_grant_escape/migration.sql',
      `DO LANGUAGE plpgsql E'BEGIN EXECUTE ''REVOKE SELECT ON TABLE users FROM reporting_reader''; END';\n`,
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000010_authz_function/migration.sql',
      'CREATE OR REPLACE FUNCTION public.app_enforced_org_id() RETURNS text AS $$ BEGIN RETURN NULL; END $$ LANGUAGE plpgsql;\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000011_generic_dynamic_rls_function/migration.sql',
      'CREATE OR REPLACE FUNCTION public.configure_security() RETURNS void AS $$ BEGIN EXECUTE \'ALTER TABLE "Membership" DISABLE ROW LEVEL SECURITY\'; END $$ LANGUAGE plpgsql; SELECT public.configure_security();\n',
    );
    writeRepoFile(
      root,
      'prisma/migrations/20260721000012_concatenated_dynamic_grant/migration.sql',
      "CREATE OR REPLACE FUNCTION public.configure_access() RETURNS void AS $$ BEGIN EXECUTE 'GR' || 'ANT SELECT ON users TO reporting_reader'; END $$ LANGUAGE plpgsql; SELECT public.configure_access();\n",
    );
    const expanded = discoverMigrationAuthzContracts(root);
    expect(expanded.find((entry) => entry.path.includes('role_grant'))?.defines_role_enum).toBe(
      true,
    );
    expect(expanded.find((entry) => entry.path.includes('disable_rls'))?.defines_rls_contract).toBe(
      true,
    );
    expect(
      expanded.find((entry) => entry.path.includes('commented_rls'))?.defines_rls_contract,
    ).toBe(true);
    expect(expanded.some((entry) => entry.path.includes('comment_only'))).toBe(false);
    expect(expanded.some((entry) => entry.path.includes('inert_function'))).toBe(false);
    expect(expanded.find((entry) => entry.path.includes('dynamic_rls'))?.defines_rls_contract).toBe(
      true,
    );
    expect(
      expanded.find((entry) => entry.path.includes('dynamic_rls_string'))?.defines_rls_contract,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('dynamic_rls_language'))?.defines_rls_contract,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('dynamic_rls_escape'))?.defines_rls_contract,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('dynamic_grant_escape'))?.defines_role_enum,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('authz_function'))?.defines_rls_contract,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('generic_dynamic_rls_function'))
        ?.defines_rls_contract,
    ).toBe(true);
    expect(
      expanded.find((entry) => entry.path.includes('concatenated_dynamic_grant'))
        ?.defines_rls_contract,
    ).toBe(true);
  });

  it('pins discovery scope and scans executable mts and cts modules', () => {
    const { root, manifest } = createFixture();
    const narrowed = cloneManifest(manifest);
    narrowed.scope.excluded_path_patterns.push('^src/app/api/private/route\\.ts$');
    writeManifest(root, narrowed);
    expectInventoryFailure(root, /inventory source exclusions drift/);

    writeManifest(root, manifest);
    writeRepoFile(root, 'src/authz/new-gate.mts', "export const permission = 'canAdmin';\n");
    writeRepoFile(root, 'src/authz/new-worker.cts', "export const role = 'pharmacist';\n");
    const discovered = discoverSurfaces(root, manifest.scope);
    expect(discovered.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['src/authz/new-gate.mts', 'src/authz/new-worker.cts']),
    );
  });

  it('keeps every required discovery class and previously missed raw branches declared', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8'),
    ) as InventoryManifest;
    const detectors = new Set(manifest.declared_surfaces.map((entry) => entry.detector));
    expect(detectors).toEqual(
      new Set([
        'identity_role_claim',
        'long_lived_or_offline',
        'mapping_precedence',
        'override_flag',
        'permission_capability',
        'phos_role',
        'phos_scope',
        'platform_role',
        'qualification',
        'raw_role_semantics',
        'rls_authz',
        'role_projection',
        'service_job',
        'tenant_role',
        'ui_role_affordance',
      ]),
    );
    for (const sourcePath of [
      'src/lib/analytics/capacity.ts',
      'src/app/api/visit-preparations/[scheduleId]/route.ts',
    ]) {
      expect(manifest.declared_surfaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ detector: 'raw_role_semantics', path: sourcePath }),
        ]),
      );
    }
    for (const permission of PERMISSION_CAPABILITIES) {
      expect(
        manifest.declared_surfaces.some(
          (entry) =>
            entry.detector === 'permission_capability' &&
            entry.exact_values_or_scopes.some(
              (value) =>
                value === `effective:${permission}` || value === `supporting_literal:${permission}`,
            ),
        ),
        permission,
      ).toBe(true);
    }
    expect(manifest.declared_surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detector: 'permission_capability',
          path: 'src/app/api/billing-candidates/[id]/route.ts',
          exact_values_or_scopes: expect.arrayContaining(['effective:canManageBilling']),
        }),
      ]),
    );
    expect(manifest.declared_surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detector: 'permission_capability',
          path: 'src/app/api/management-plans/route.ts',
          route_method_purpose:
            'GET[canViewDashboard|unknown_permission:unresolved_expression:37e39fd793f6];POST[canVisit] /api/management-plans purpose=legacy_unspecified_pending_review',
          mapping_disposition: 'candidate_requires_human',
        }),
        expect.objectContaining({
          detector: 'permission_capability',
          path: 'src/app/api/medication-cycles/[id]/transition/route.ts',
          route_method_purpose:
            'PATCH[canAuditDispense|canAuditSet|canReport|canSet|canVisit] /api/medication-cycles/[id]/transition purpose=legacy_unspecified_pending_review',
          exact_values_or_scopes: expect.arrayContaining([
            'effective:canAuditDispense',
            'supporting_literal:canAdmin',
          ]),
        }),
      ]),
    );
  });

  it('leaves each new semantic class unresolved until separately declared', () => {
    const { root } = createFixture();
    const cases: Array<[string, string]> = [
      ['src/raw-comparison.ts', "export const allowed = ctx.role === 'admin';\n"],
      ['src/raw-unknown-comparison.ts', "export const allowed = ctx.role === 'super_admin';\n"],
      ['src/raw-unknown-variable.ts', "export const role = 'super_admin';\n"],
      ['src/raw-unknown-property.ts', "export const value = { role: 'super_admin' };\n"],
      ['src/raw-unknown-type.ts', "export type Role = 'super_admin';\n"],
      ['src/raw-union.ts', "export type Role = 'owner' | 'clerk';\n"],
      [
        'src/raw-multiline-array.ts',
        "export const TASK_WORKLOAD_MEMBER_ROLES = [\n  'pharmacist',\n  'driver',\n] as const;\n",
      ],
      ['src/raw-zod.ts', "export const Role = z.enum(['pharmacist', 'driver']);\n"],
      [
        'src/raw-prisma-filter.ts',
        "export const where = { role: { in: ['admin', 'pharmacist'] } };\n",
      ],
      [
        'src/raw-switch.ts',
        "export function allowed(role: string) { switch (role) { case 'owner': return true; default: return false; } }\n",
      ],
      [
        'src/aliased-enum.ts',
        "import { UserRole as Roles } from '@/phos/contracts/phos_contracts';\nexport const role = Roles.MANAGER;\n",
      ],
      ['src/conversion.ts', 'export const phosRoleFromMemberRole = (role: string) => role;\n'],
      [
        'src/membership-selection.ts',
        'export const membership = await db.membership.findFirst({ where: { user_id } });\n',
      ],
      ['src/claim-fallback.ts', "export const role = claim.role ?? 'admin';\n"],
      ['src/synthetic-context.ts', 'export const context: RequestAuthContext = synthetic;\n'],
      ['src/new-rls.ts', 'export const sql = "setRlsContext target_org_id";\n'],
      ['src/new-role-ui.tsx', "export const roleOptionLabel = 'admin';\n"],
      ['src/new-assignment.ts', "export const assigneeRole = 'pharmacist';\n"],
      ['src/new-notification.ts', "export const authActorRole = 'clerk';\n"],
      ['src/new-output-contract.ts', "export type Output = { actor_role: 'admin' };\n"],
      ['src/new-role-store.ts', "export const authStoredRole = 'driver';\n"],
      ['src/new-offline.ts', 'export const queue = offlineActionQueue;\n'],
      ['src/new-config.json', '{"allowed_roles":["ADMIN"]}\n'],
      ['src/new-iac.yaml', 'required_scopes: [phos/cards.read]\n'],
      ['src/new-history.ts', "export const actor_role = 'owner';\n"],
      ['src/server/jobs/new-human-role-job.ts', "export const jobActorRole = 'admin';\n"],
      [
        'src/app/api/new-stream/route.ts',
        'export const stream = new ReadableStream(); // authz epoch absent\n',
      ],
      [
        'src/app/api/unknown-permission/route.ts',
        "export const GET = withAuthContext(handler, { permission: 'canSuperAdmin' });\n",
      ],
      ...PERMISSION_CAPABILITIES.map((permission, index): [string, string] => [
        `src/app/api/permission-${index}/route.ts`,
        `export const GET = withAuthContext(handler, {\n  permission: '${permission}',\n});\n`,
      ]),
    ];
    for (const [sourcePath, content] of cases) {
      writeRepoFile(root, sourcePath, content);
      expectInventoryFailure(root, /unresolved candidates or stale declarations/, sourcePath);
      unlinkSync(path.join(root, sourcePath));
    }
  });

  it('rejects direct, imported-alias, and propagated-alias dynamic role lookups', () => {
    for (const content of [
      "import { UserRole } from './roles';\nconst key = getKey();\nexport const role = UserRole[key];\n",
      "import { UserRole as Roles } from './roles';\nconst key = getKey();\nexport const role = Roles[key];\n",
      "import { UserRole } from './roles';\nconst Roles = UserRole;\nconst key = getKey();\nexport const role = Roles[key];\n",
    ]) {
      expect(() => assertNoUnsupportedRoleAccess('src/dynamic.ts', content)).toThrowError(
        /unsupported dynamic UserRole access/,
      );
    }
  });

  it('rejects declaration laundering after candidate regeneration', () => {
    const { root, manifest } = createFixture();
    writeRepoFile(root, 'src/new-role-reader.ts', "export const allowed = ctx.role === 'admin';\n");
    const candidates = discoverSurfaces(root, manifest.scope);
    expect(candidates.length).toBeGreaterThan(manifest.declared_surfaces.length);
    expectInventoryFailure(root, /unresolved candidates or stale declarations/);
  });

  it('rejects semantic sentinels, unrelated test references, and open approval values', () => {
    const mutations: Array<[RegExp, (manifest: InventoryManifest) => void]> = [
      [
        /exact values drift/,
        (manifest) => {
          manifest.declared_surfaces[0].exact_values_or_scopes = [
            'not_applicable:source-level-sentinel',
          ];
        },
      ],
      [
        /route method purpose drift/,
        (manifest) => {
          const route = manifest.declared_surfaces.find((entry) =>
            /^src\/app\/api\/.+\/route\.ts$/.test(entry.path),
          );
          if (!route) throw new Error('route declaration fixture missing');
          route.route_method_purpose = 'not_applicable:source-level-sentinel';
        },
      ],
      [
        /test refs drift/,
        (manifest) => {
          manifest.declared_surfaces[0].test_refs = [CHECKER_TEST_PATH];
        },
      ],
      [
        /disposition invalid/,
        (manifest) => {
          manifest.declared_surfaces[0].mapping_disposition = 'grant_without_review';
        },
      ],
      [
        /approval invalid/,
        (manifest) => {
          manifest.declared_surfaces[0].approval_status = 'approved';
        },
      ],
    ];
    for (const [message, mutate] of mutations) {
      const { root, manifest } = createFixture();
      mutate(manifest);
      writeManifest(root, manifest);
      expectInventoryFailure(root, message);
    }
  });

  it('content-addresses normalized profiles', () => {
    const { root, manifest } = createFixture();
    const profile = Object.values(manifest.binding_profiles)[0];
    const unusedKey = [
      'assignment',
      'assignment_version',
      'authz_epoch',
      'consent',
      'contract_version',
      'purpose',
      'qualification',
      'qualification_version',
      'recheck_revocation_point',
      'site',
      'subject',
      'tenant',
      'ttl',
    ].find((key) => !(key in profile.overrides));
    if (!unusedKey) throw new Error('profile fixture has no unused binding key');
    profile.overrides[unusedKey] =
      profile.default_state === 'present_observed' ? 'absent_observed' : 'present_observed';
    writeManifest(root, manifest);
    expectInventoryFailure(root, /content-address drift/);
  });

  it('validates mapping, human gates, route tuples, profiles, and credential authority', () => {
    const base = createFixture();
    const mutations: Array<[RegExp, (manifest: InventoryManifest) => void]> = [
      [/parent Phase 0 must remain Partial/, (m) => (m.parent_phase_status = 'Complete')],
      [/mapping decisions drift/, (m) => m.mapping_decisions.pop()],
      [
        /live evidence must remain human-gated/,
        (m) => ((m.live_evidence_gate as { status: string }).status = 'Complete'),
      ],
      [
        /browser deletion hard dependency weakened/,
        (m) => (m.browser_cutover_gate.hard_dependency_before_legacy_deletion = false),
      ],
      [/PHOS route contracts drift/, (m) => m.frozen_value_sets.phos_route_contracts.pop()],
      [/binding profile missing/, (m) => (m.declared_surfaces[0].binding_profile = 'missing')],
      [
        /legacy credential cannot be authoritative/,
        (m) => {
          const credential = m.high_risk_contracts.find(
            (entry) => entry.id === 'legacy-pharmacist-credential',
          )!;
          credential.qualification_authority = 'legacy_expiry_date';
        },
      ],
    ];
    for (const [message, mutate] of mutations) {
      const manifest = cloneManifest(base.manifest);
      mutate(manifest);
      writeManifest(base.root, manifest);
      expectInventoryFailure(base.root, message);
    }
  });

  it('rejects final and parent-directory symlink escapes', () => {
    const root = temporaryRoot('authz-symlink-root-');
    const outside = temporaryRoot('authz-symlink-outside-');
    writeRepoFile(outside, 'role.ts', "export const role = 'admin';\n");
    mkdirSync(path.join(root, 'src'), { recursive: true });
    symlinkSync(path.join(outside, 'role.ts'), path.join(root, 'src', 'final.ts'));
    expect(() =>
      discoverSurfaces(root, { source_roots: ['src/final.ts'], excluded_path_patterns: [] }),
    ).toThrowError(/resolves outside repository|must not be a symlink/);
    symlinkSync(outside, path.join(root, 'src', 'parent'));
    expect(() =>
      discoverSurfaces(root, { source_roots: ['src/parent'], excluded_path_patterns: [] }),
    ).toThrowError(/resolves outside repository|must not be a symlink/);
  });
  it('exposes path-only error details without source content', () => {
    const error = new AuthzInventoryError('failure', ['path-only']);
    expect(error.name).toBe('AuthzInventoryError');
    expect(error.details).toEqual(['path-only']);
  });
});
