import {
  discoverSurfaces,
  parseApiPermissionContracts as parseApiPermissionContractsRaw,
  sourceExactValues,
  sourceRouteMethodPurpose,
} from './check-authz-account-model-v1-inventory.mjs';
import {
  parsePermissionFixture,
  temporaryRoot,
  writeRepoFile,
} from './authz-account-model-v1-inventory/fixtures/test-fixtures';
import { describe, expect, it } from 'vitest';

describe(
  'check-authz-account-model-v1-inventory keeps raw-role context and basic permission semantics source-linked',
  { timeout: 120_000 },
  () => {
    it('keeps raw-role context and basic permission semantics source-linked', () => {
      const root = temporaryRoot('authz-semantic-context-');
      writeRepoFile(root, 'src/context.ts', "export const allowed = ctx.role === 'admin';\n");
      const authorizationEntry = discoverSurfaces(root, {
        source_roots: ['src'],
        excluded_path_patterns: [],
      }).find((entry) => entry.detector === 'raw_role_semantics');
      expect(authorizationEntry).toBeDefined();
      writeRepoFile(root, 'src/context.ts', "export const label = 'admin';\n");
      const displayEntry = discoverSurfaces(root, {
        source_roots: ['src'],
        excluded_path_patterns: [],
      }).find((entry) => entry.detector === 'raw_role_semantics');
      expect(displayEntry).toBeUndefined();
      for (const container of [
        'sessionDisplay',
        'authStatus',
        'userBadge',
        'requestContextDisplay',
      ]) {
        writeRepoFile(root, 'src/context.ts', `export const ${container} = { role: 'rootgod' };\n`);
        expect(
          discoverSurfaces(root, {
            source_roots: ['src/context.ts'],
            excluded_path_patterns: [],
          }).find((entry) => entry.detector === 'raw_role_semantics'),
        ).toBeDefined();
      }
      writeRepoFile(
        root,
        'src/lib/auth/profile.ts',
        "export const display = { role: 'rootgod', authz_epoch: 1, canAdmin: true };\n",
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/lib/auth/profile.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'raw_role_semantics'),
      ).toBeDefined();

      const route =
        "import { withAuthContext } from '@/lib/auth/context';\nexport const GET = withAuthContext(handler, {\n  permission: 'canManageBilling',\n});\n";
      expect(
        sourceExactValues('permission_capability', 'src/app/api/billing/route.ts', route),
      ).toEqual(['effective:canManageBilling']);
      expect(
        sourceRouteMethodPurpose('src/app/api/billing/route.ts', route, 'permission_capability'),
      ).toBe('GET[canManageBilling] /api/billing purpose=legacy_unspecified_pending_review');

      const rootApiRoute =
        "import { withAuthContext } from '@/lib/auth/context';\nexport const GET = withAuthContext(handler, { permission: 'canVisit' });\n";
      expect(parsePermissionFixture('src/app/api/route.ts', rootApiRoute, root)).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
      ]);
      expect(
        sourceRouteMethodPurpose(
          'src/app/api/route.ts',
          rootApiRoute,
          'permission_capability',
          root,
        ),
      ).toBe('GET[canVisit] /api purpose=legacy_unspecified_pending_review');
      writeRepoFile(
        root,
        'src/app/api/admin/root-target/route.ts',
        "export const GET = withAuthContext(handler, { permission: 'canReport' });\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/route.ts',
          "export { GET } from './admin/root-target/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canReport'] }]);
      const rootImportedHandler =
        "import { handler } from './handler';\nexport const GET = handler;\n";
      writeRepoFile(root, 'src/app/api/route.ts', rootImportedHandler);
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();
      expect(
        parsePermissionFixture('src/app/api/route.ts', rootImportedHandler, root)[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)]);
      for (const nestedWrapperRoute of [
        [
          'const handler = async () => null;',
          "export const GET = async () => customWrapper(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
        [
          "import { secure } from './secure';",
          'const handler = async () => null;',
          "export const GET = async () => secure(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
        [
          "import { secure } from './secure';",
          'const auth = secure;',
          'const handler = async () => null;',
          "export const GET = async () => auth(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
      ]) {
        expect(
          parsePermissionFixture(
            'src/app/api/nested-unresolved-wrapper/route.ts',
            nestedWrapperRoute,
            root,
          )[0]?.permissions,
        ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_expression:/)]);
      }

      const mixedRoute = `
      export const GET = withAuthContext(readHandler, { permission: 'canViewDashboard' });
      export const POST = withAuthContext(writeHandler, { permission: 'canVisit' });
      const DENIAL_MESSAGES = { canAdmin: 'unused' };
    `;
      expect(parsePermissionFixture('src/app/api/mixed/route.ts', mixedRoute)).toEqual([
        { method: 'GET', permissions: ['canViewDashboard'] },
        { method: 'POST', permissions: ['canVisit'] },
      ]);
      const swappedRoute = mixedRoute
        .replace("permission: 'canViewDashboard'", "permission: 'temporaryPermission'")
        .replace("permission: 'canVisit'", "permission: 'canViewDashboard'")
        .replace("permission: 'temporaryPermission'", "permission: 'canVisit'");
      expect(parsePermissionFixture('src/app/api/mixed/route.ts', swappedRoute)).not.toEqual(
        parsePermissionFixture('src/app/api/mixed/route.ts', mixedRoute),
      );
      writeRepoFile(root, 'src/app/api/mixed/route.ts', mixedRoute);
      const originalPermissionEvidence = discoverSurfaces(root, {
        source_roots: ['src/app/api/mixed/route.ts'],
        excluded_path_patterns: [],
      }).find((entry) => entry.detector === 'permission_capability')?.evidence_sha256;
      writeRepoFile(root, 'src/app/api/mixed/route.ts', swappedRoute);
      const swappedPermissionEvidence = discoverSurfaces(root, {
        source_roots: ['src/app/api/mixed/route.ts'],
        excluded_path_patterns: [],
      }).find((entry) => entry.detector === 'permission_capability')?.evidence_sha256;
      expect(swappedPermissionEvidence).not.toBe(originalPermissionEvidence);
      expect(
        parsePermissionFixture(
          'src/app/api/mixed/route.ts',
          mixedRoute.replace("canAdmin: 'unused'", "canAdmin: 'changed message'"),
        ),
      ).toEqual(parsePermissionFixture('src/app/api/mixed/route.ts', mixedRoute));

      expect(
        parsePermissionFixture(
          'src/app/api/permission-property-forms/route.ts',
          [
            "const permission = 'canAdmin';",
            "const key = 'permission';",
            "const spreadPolicy = { permission: 'canReport' };",
            "const policy = { permission: 'canViewDashboard' };",
            'export const GET = withAuthContext(read, { permission });',
            "export const POST = withAuthContext(write, { ['permission']: 'canVisit' });",
            "export const PUT = withAuthContext(write, { [key]: 'canManageBilling' });",
            'export const PATCH = withAuthContext(write, { ...spreadPolicy });',
            'export const DELETE = withAuthContext(write, policy);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: ['canViewDashboard'] },
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'PATCH', permissions: ['canReport'] },
        { method: 'POST', permissions: ['canVisit'] },
        { method: 'PUT', permissions: ['canManageBilling'] },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/member-permissions/route.ts',
          [
            "const permissions = { read: 'canVisit', write: 'canAdmin', nested: { read: 'canReport' } };",
            "const ordered = ['canViewDashboard', 'canManageBilling'];",
            'export const GET = withAuthContext(read, { permission: permissions.read });',
            "export const POST = withAuthContext(write, { permission: permissions['write'] });",
            'export const PUT = withAuthContext(write, { permission: permissions.nested.read });',
            'export const PATCH = withAuthContext(write, { permission: ordered[0] });',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'PATCH', permissions: ['canViewDashboard'] },
        { method: 'POST', permissions: ['canAdmin'] },
        { method: 'PUT', permissions: ['canReport'] },
      ]);
      for (const [options, expected] of [
        ["{ ...{ permission: 'canVisit' }, permission: 'canAdmin' }", 'canAdmin'],
        ["{ permission: 'canAdmin', ...{ permission: 'canVisit' } }", 'canVisit'],
        ["{ permission: 'canVisit', permission: 'canReport' }", 'canReport'],
        ["{ ['permission']: 'canVisit', permission: 'canManageBilling' }", 'canManageBilling'],
      ] as const) {
        expect(
          parsePermissionFixture(
            'src/app/api/permission-precedence/route.ts',
            `export const GET = withAuthContext(run, ${options});\n`,
            root,
          ),
        ).toEqual([{ method: 'GET', permissions: [expected] }]);
      }
      for (const [memberExpression, expected] of [
        ["({ read: 'canVisit', ...{ read: 'canAdmin' } }).read", 'canAdmin'],
        ["({ read: 'canAdmin', ...{ read: 'canVisit' } }).read", 'canVisit'],
        ["({ read: 'canVisit', read: 'canReport' }).read", 'canReport'],
      ] as const) {
        expect(
          parsePermissionFixture(
            'src/app/api/member-precedence/route.ts',
            `export const GET = withAuthContext(run, { permission: ${memberExpression} });\n`,
            root,
          ),
        ).toEqual([{ method: 'GET', permissions: [expected] }]);
      }
      expect(
        parsePermissionFixture(
          'src/app/api/wrapped-handler/route.ts',
          [
            'const authenticatedGET = withAuthContext(',
            '  async (_request, ctx) => {',
            "    const allowed = hasPermission(ctx.role, 'canManageBilling');",
            '    return allowed;',
            '  },',
            "  { permission: 'canReport' },",
            ');',
            'export async function GET(request) {',
            '  return withRoutePerformance(request, async () => authenticatedGET(request));',
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canManageBilling', 'canReport'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/direct-context-guard/route.ts',
          [
            'async function authenticatedPOST(request) {',
            "  return requireApiKeyOrAuthContext(request, { permission: 'canAdmin' });",
            '}',
            'export async function POST(request) {',
            '  return withRoutePerformance(request, async () => authenticatedPOST(request));',
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'POST', permissions: ['canAdmin'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/aliased-auth-wrapper/route.ts',
          [
            'const auth = withAuthContext;',
            'const authAgain = auth;',
            'const handler = async () => null;',
            "export const GET = authAgain(handler, { permission: 'canAdmin' });",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      for (const nonCanonicalAuthRoute of [
        [
          'function withAuthContext(handler) { return handler; }',
          'const handler = async () => null;',
          "export const GET = withAuthContext(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
        [
          "import { withAuthContext } from './telemetry';",
          'const handler = async () => null;',
          "export const GET = withAuthContext(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
        [
          'async function requireAuthContext() { return { ctx: {} }; }',
          'export const GET = async (request) => {',
          "  await requireAuthContext(request, { permission: 'canManageBilling' });",
          '  return null;',
          '};',
          '',
        ].join('\n'),
        [
          'const handler = async () => null;',
          "export const GET = withAuthContext(handler, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
      ]) {
        expect(
          parseApiPermissionContractsRaw(
            'src/app/api/noncanonical-auth-wrapper/route.ts',
            nonCanonicalAuthRoute,
            root,
          )[0]?.permissions,
        ).toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              /^unknown_permission:(?:unresolved_direct_method|unresolved_expression):/,
            ),
          ]),
        );
      }
      expect(
        parsePermissionFixture(
          'src/app/api/sequence-auth-wrapper/route.ts',
          [
            'const handler = async () => null;',
            "export const GET = (0, withAuthContext)(handler, { permission: 'canAdmin' });",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/ambient-wrapper/route.ts',
          [
            'const handler = async () => null;',
            "export const GET = customWrapper(handler, { permission: 'canAdmin' });",
            '',
          ].join('\n'),
          root,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)]);
      const aliasedImportedWrapper = parsePermissionFixture(
        'src/app/api/aliased-imported-wrapper/route.ts',
        [
          "import { secure } from './secure';",
          'const auth = secure;',
          'export const GET = auth(async () => null);',
          '',
        ].join('\n'),
        root,
      );
      expect(aliasedImportedWrapper).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/aliased-local-callee/route.ts',
          [
            "const handler = () => hasPermission(role, 'canAdmin');",
            'const invoke = handler;',
            "const handlers = { run: () => hasPermission(role, 'canReport') };",
            'export const GET = () => invoke();',
            'export const POST = () => handlers.run();',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'POST', permissions: ['canReport'] },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/aliased-permission-check/route.ts',
          [
            "import { hasPermission as allowed, unrelated } from '@/lib/auth/permissions';",
            'const localAllowed = allowed;',
            'const checks = { allowed };',
            'export const GET = withAuthContext(async (_request, ctx) => {',
            "  localAllowed(ctx.role, 'canAdmin');",
            "  checks.allowed(ctx.role, 'canReport');",
            '  unrelated(ctx.role);',
            '});',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin', 'canReport'] }]);
    });
  },
);
