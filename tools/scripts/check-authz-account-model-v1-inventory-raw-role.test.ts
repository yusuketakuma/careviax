import { discoverSurfaces, sourceExactValues } from './check-authz-account-model-v1-inventory.mjs';
import {
  parsePermissionFixture,
  temporaryRoot,
  writeRepoFile,
} from './authz-account-model-v1-inventory/fixtures/test-fixtures';
import { describe, expect, it } from 'vitest';

describe(
  'check-authz-account-model-v1-inventory tracks raw-role semantics and rejects non-auth lookalikes',
  { timeout: 120_000 },
  () => {
    it('tracks raw-role semantics and rejects non-auth lookalikes', () => {
      const root = temporaryRoot('authz-raw-role-');
      for (const authRoleContent of [
        "export const allowed = ctx.role === 'nurse';\n",
        "export const value = { role: 'facility_staff' };\n",
        "export const authenticatedUser = { role: 'super_admin', display_name: 'Admin' };\n",
        "export const membership = { role: 'super_admin', label: 'Admin' };\n",
        "export const session = { role: 'super_admin', display_name: 'Admin' };\n",
        "export const authContext = { role: 'super_admin', role_label: 'Admin' };\n",
        "export function allowed(membership: { role: string }) { switch (membership.role) { case 'family': return true; default: return false; } }\n",
      ]) {
        writeRepoFile(root, 'src/auth-role.ts', authRoleContent);
        const roleEntry = discoverSurfaces(root, {
          source_roots: ['src/auth-role.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'raw_role_semantics');
        expect(roleEntry).toBeDefined();
        expect(
          sourceExactValues('raw_role_semantics', 'src/auth-role.ts', authRoleContent),
        ).toEqual(expect.arrayContaining([expect.stringMatching(/^unknown_role:/)]));
      }

      for (const [authPath, container] of [
        ['src/lib/auth/profile.ts', 'profile'],
        ['src/server/auth/account.ts', 'account'],
        ['src/lib/auth/context.ts', 'projection'],
      ]) {
        const authProjection = `export const ${container} = { role: 'super_admin', display_name: 'Admin' };\n`;
        writeRepoFile(root, authPath, authProjection);
        expect(sourceExactValues('raw_role_semantics', authPath, authProjection)).toContain(
          'unknown_role:super_admin',
        );
      }

      writeRepoFile(
        root,
        'src/provider-message.ts',
        "export const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'request' }];\n",
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/provider-message.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'raw_role_semantics'),
      ).toBeUndefined();

      for (const infraAuthContent of [
        "export const allowed = ctx.role === 'super_admin';\n",
        "export const policy = { required_role: 'super_admin' };\n",
      ]) {
        writeRepoFile(root, 'src/phos/infra/auth.ts', infraAuthContent);
        expect(
          discoverSurfaces(root, {
            source_roots: ['src/phos/infra/auth.ts'],
            excluded_path_patterns: [],
          }).find((entry) => entry.detector === 'raw_role_semantics'),
        ).toBeDefined();
      }
      writeRepoFile(
        root,
        'src/phos/infra/cloudformation.ts',
        "export const resource = { Type: 'AWS::Lambda::Function', Properties: { Role: getAtt('FunctionRole', 'Arn') } };\n",
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/phos/infra/cloudformation.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'raw_role_semantics'),
      ).toBeUndefined();

      const unknownPermissionRoute = `
      import { withAuthContext } from '@/lib/auth/context';
      const readPermission = 'canSuperAdmin';
      export const GET = withAuthContext(readHandler, { permission: readPermission });
      export const POST = withAuthContext(writeHandler, { permission: 'canVisit' });
    `;
      expect(
        parsePermissionFixture('src/app/api/unknown-permission/route.ts', unknownPermissionRoute),
      ).toEqual([
        { method: 'GET', permissions: ['unknown_permission:canSuperAdmin'] },
        { method: 'POST', permissions: ['canVisit'] },
      ]);
      expect(
        sourceExactValues(
          'permission_capability',
          'src/app/api/unknown-permission/route.ts',
          unknownPermissionRoute,
        ),
      ).toContain('effective:unknown_permission:canSuperAdmin');
      writeRepoFile(
        root,
        'src/app/api/unknown-permission/route.ts',
        "export const GET = withAuthContext(handler, { permission: 'canSuperAdmin' });\n",
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/unknown-permission/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();

      for (const permission of [
        'canadmin',
        'can_super_admin',
        'manageBilling',
        'arbitrary permission',
      ]) {
        const route = `export const GET = withAuthContext(handler, { permission: ${JSON.stringify(permission)} });\n`;
        const expected = `unknown_permission:${encodeURIComponent(permission)}`;
        expect(parsePermissionFixture('src/app/api/malformed-permission/route.ts', route)).toEqual([
          { method: 'GET', permissions: [expected] },
        ]);
        writeRepoFile(root, 'src/app/api/malformed-permission/route.ts', route);
        expect(
          discoverSurfaces(root, {
            source_roots: ['src/app/api/malformed-permission/route.ts'],
            excluded_path_patterns: [],
          }).find((entry) => entry.detector === 'permission_capability'),
        ).toBeDefined();
      }
      const unresolvedPermissionRoute = `
      import { requiredPermission } from './permissions';
      export const GET = withAuthContext(handler, { permission: requiredPermission });
    `;
      expect(
        parsePermissionFixture(
          'src/app/api/unresolved-permission/route.ts',
          unresolvedPermissionRoute,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_expression:/)]);
      writeRepoFile(root, 'src/app/api/unresolved-permission/route.ts', unresolvedPermissionRoute);
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/unresolved-permission/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();

      writeRepoFile(
        root,
        'src/contact-role.ts',
        "export const contact = { role: 'physician', organization_name: 'clinic', is_primary: true };\n",
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/contact-role.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'raw_role_semantics'),
      ).toBeUndefined();

      for (const nonAuthContent of [
        "export type StatusRole = 'neutral';\n",
        "export const prismaError = code === 'P2034';\n",
      ]) {
        writeRepoFile(root, 'src/non-auth-role.ts', nonAuthContent);
        expect(
          discoverSurfaces(root, {
            source_roots: ['src/non-auth-role.ts'],
            excluded_path_patterns: [],
          }).find((entry) => entry.detector === 'raw_role_semantics'),
        ).toBeUndefined();
      }
    });
  },
);
