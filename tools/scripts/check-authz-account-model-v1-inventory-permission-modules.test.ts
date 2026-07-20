import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  discoverSurfaces,
  parseApiPermissionContracts as parseApiPermissionContractsRaw,
  sourceExactValues,
} from './check-authz-account-model-v1-inventory.mjs';
import {
  parsePermissionFixture,
  REPO_ROOT,
  temporaryRoot,
  writeRepoFile,
} from './authz-account-model-v1-inventory/fixtures/test-fixtures';
import { describe, expect, it } from 'vitest';

describe(
  'check-authz-account-model-v1-inventory tracks permission semantics through modules and re-exports',
  { timeout: 120_000 },
  () => {
    it('tracks permission semantics through modules and re-exports', () => {
      const root = temporaryRoot('authz-permission-modules-');
      const movementTimelineRoutePath = 'src/app/api/patients/[id]/movement-timeline/route.ts';
      expect(
        parseApiPermissionContractsRaw(
          movementTimelineRoutePath,
          readFileSync(path.join(REPO_ROOT, movementTimelineRoutePath), 'utf8'),
          REPO_ROOT,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)]);
      for (const [sourcePath, content] of [
        [
          'src/app/api/wrong-auth-entrypoint-no-options/route.ts',
          "import { requireAuthContext } from './telemetry'; export const GET = () => requireAuthContext(request);\n",
        ],
        [
          'src/app/api/local-auth-entrypoint-no-options/route.ts',
          'function requireAuthContext() { return {}; } export const GET = () => requireAuthContext(request);\n',
        ],
        [
          'src/app/api/ambient-auth-entrypoint-no-options/route.ts',
          'export const GET = () => requireAuthContext(request);\n',
        ],
      ] as const) {
        expect(parseApiPermissionContractsRaw(sourcePath, content, root)[0]?.permissions).toEqual([
          expect.stringMatching(/^unknown_permission:/),
        ]);
      }
      expect(
        parsePermissionFixture(
          'src/app/api/promise-callback/route.ts',
          [
            "const handler = () => hasPermission(role, 'canVisit');",
            'export const GET = () => Promise.resolve().then(handler);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canVisit'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/custom-map-data/route.ts',
          [
            'const service = { map(value) { return value; } };',
            'const config = { value: 1 };',
            'export const GET = () => service.map(config);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: [] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/imported-promise-callback/route.ts',
          [
            "import { handler } from './handler';",
            'export const GET = () => task.then(handler);',
            '',
          ].join('\n'),
          root,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_expression:/)]);
      expect(
        parsePermissionFixture(
          'src/app/api/active-identifier-callbacks/route.ts',
          [
            "const checkEach = () => requireAuthContext(request, { permission: 'canAdmin' });",
            'export const GET = () => [1].map(checkEach);',
            'export const POST = () => queueMicrotask(checkEach);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'POST', permissions: ['canAdmin'] },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/cyclic-callee/route.ts',
          [
            'const first = second;',
            'const second = first;',
            'export const GET = () => first();',
            '',
          ].join('\n'),
          root,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_expression:/)]);
      for (const nonAuthorizationPermission of [
        "export const GET = async () => Response.json({ permission: 'canAdmin' });\n",
        [
          'export async function GET() {',
          "  function unused() { return checkPermission({ permission: 'canAdmin' }); }",
          "  const alsoUnused = () => checkPermission({ permission: 'canVisit' });",
          "  return Response.json({ permission: 'canReport' });",
          '}',
          '',
        ].join('\n'),
        "export const GET = withAuthContext(run, { telemetry: { permission: 'canAdmin' } });\n",
      ]) {
        expect(
          parsePermissionFixture(
            'src/app/api/non-auth-permission/route.ts',
            nonAuthorizationPermission,
            root,
          ),
        ).toEqual([{ method: 'GET', permissions: [] }]);
      }
      const importedPermissionRoute = [
        "import { permission, handler, key } from './auth';",
        'export const GET = withAuthContext(handler, { permission });',
        'export const POST = withAuthContext(handler);',
        "export const PUT = withAuthContext(handler, { [key]: 'canAdmin' });",
        '',
      ].join('\n');
      const importedPermissionContracts = parsePermissionFixture(
        'src/app/api/imported-permission/route.ts',
        importedPermissionRoute,
        root,
      );
      expect(importedPermissionContracts).toEqual([
        {
          method: 'GET',
          permissions: expect.arrayContaining([
            expect.stringMatching(/^unknown_permission:unresolved_expression:/),
            expect.stringMatching(/^unknown_permission:unresolved_direct_method:/),
          ]),
        },
        {
          method: 'POST',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)],
        },
        {
          method: 'PUT',
          permissions: expect.arrayContaining([
            expect.stringMatching(/^unknown_permission:unresolved_expression:/),
            expect.stringMatching(/^unknown_permission:unresolved_direct_method:/),
          ]),
        },
      ]);
      writeRepoFile(root, 'src/app/api/imported-permission/route.ts', importedPermissionRoute);
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/imported-permission/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();
      const importedWrapperRoute = [
        "import { secure } from './secure';",
        'function handler() {',
        "  return checkPermission({ permission: 'canVisit' });",
        '}',
        'export const GET = secure(handler);',
        "export const POST = secure(() => checkPermission({ permission: 'canAdmin' }));",
        '',
      ].join('\n');
      for (const contract of parsePermissionFixture(
        'src/app/api/imported-wrapper/route.ts',
        importedWrapperRoute,
        root,
      )) {
        expect(contract.permissions).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^unknown_permission:unresolved_direct_method:/),
          ]),
        );
      }
      writeRepoFile(root, 'src/app/api/imported-wrapper/route.ts', importedWrapperRoute);
      expect(
        sourceExactValues(
          'permission_capability',
          'src/app/api/imported-wrapper/route.ts',
          importedWrapperRoute,
          root,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^effective:unknown_permission:unresolved_direct_method:/),
        ]),
      );
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/imported-wrapper/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();

      writeRepoFile(
        root,
        'src/app/api/admin/example/route.ts',
        "export const GET = withAuthContext(handler, { permission: 'canReport' });\n",
      );
      const relativeReexport = "export { GET } from '../admin/example/route';\n";
      writeRepoFile(root, 'src/app/api/example/route.ts', relativeReexport);
      expect(
        parsePermissionFixture('src/app/api/example/route.ts', relativeReexport, root),
      ).toEqual([{ method: 'GET', permissions: ['canReport'] }]);
      expect(
        discoverSurfaces(root, {
          source_roots: ['src/app/api/example/route.ts'],
          excluded_path_patterns: [],
        }).find((entry) => entry.detector === 'permission_capability'),
      ).toBeDefined();

      writeRepoFile(
        root,
        'src/app/api/admin/aliased/route.ts',
        "const handler = withAuthContext(run, { permission: 'canAdmin' });\nexport { handler as GET };\n",
      );
      const aliasedReexport = "export { GET } from '../admin/aliased/route';\n";
      expect(parsePermissionFixture('src/app/api/aliased/route.ts', aliasedReexport, root)).toEqual(
        [{ method: 'GET', permissions: ['canAdmin'] }],
      );

      writeRepoFile(
        root,
        'src/app/api/admin/competing/route.ts',
        [
          "export const GET = withAuthContext(read, { permission: 'canViewDashboard' });",
          "export const handler = withAuthContext(write, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/competing/route.ts',
          "export { handler as GET } from '../admin/competing/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      writeRepoFile(
        root,
        'src/app/api/admin/unresolved-competing/route.ts',
        [
          "import { handler } from './handler';",
          'function helper() {',
          "  function handler() { return checkPermission({ permission: 'canAdmin' }); }",
          '  return handler();',
          '}',
          "export const GET = withAuthContext(read, { permission: 'canVisit' });",
          'export { handler };',
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/unresolved-competing/route.ts',
          "export { handler as GET } from '../admin/unresolved-competing/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      for (const bindingPatternRoute of [
        "export const { GET } = { GET: withAuthContext(run, { permission: 'canAdmin' }) };\n",
        "export const [GET] = [withAuthContext(run, { permission: 'canAdmin' })];\n",
        [
          "const { handler } = { handler: withAuthContext(run, { permission: 'canAdmin' }) };",
          'export { handler as GET };',
          '',
        ].join('\n'),
      ]) {
        expect(
          parsePermissionFixture('src/app/api/binding-pattern/route.ts', bindingPatternRoute, root),
        ).toEqual([
          {
            method: 'GET',
            permissions: [expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)],
          },
        ]);
      }

      expect(
        parsePermissionFixture(
          'src/app/api/direct-precedence/route.ts',
          [
            "const handler = withAuthContext(write, { permission: 'canAdmin' });",
            "export const GET = withAuthContext(read, { permission: 'canVisit' });",
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      expect(
        parsePermissionFixture(
          'src/app/api/overloaded/route.ts',
          [
            'function handler(req: Request): Response;',
            'function handler(req: Request) {',
            "  return hasPermission(role, 'canAdmin');",
            '}',
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/duplicate-direct-function/route.ts',
          [
            'export function GET() {',
            "  return checkPermission({ permission: 'canVisit' });",
            '}',
            'export function GET() {',
            "  return checkPermission({ permission: 'canAdmin' });",
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/duplicate-handler-functions/route.ts',
          [
            'function handler() {',
            "  return checkPermission({ permission: 'canVisit' });",
            '}',
            'function handler() {',
            "  return checkPermission({ permission: 'canAdmin' });",
            '}',
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/duplicate-handler-variables/route.ts',
          [
            "const handler = withAuthContext(read, { permission: 'canVisit' });",
            "const handler = withAuthContext(read, { permission: 'canAdmin' });",
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/duplicate-handler-mixed/route.ts',
          [
            'function handler() {',
            "  return checkPermission({ permission: 'canVisit' });",
            '}',
            "var handler = withAuthContext(read, { permission: 'canAdmin' });",
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/direct-star-precedence/route.ts',
          [
            "export const GET = withAuthContext(read, { permission: 'canAdmin' });",
            "export * from '../admin/example/route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      for (const directDeclaration of [
        'export function GET(req: Request): Response;',
        'export declare const GET: (req: Request) => Response;',
        "import { handler } from './handler'; export const GET = handler;",
      ]) {
        expect(
          parsePermissionFixture('src/app/api/unresolved-direct/route.ts', directDeclaration, root),
        ).toEqual([
          {
            method: 'GET',
            permissions: [expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)],
          },
        ]);
      }

      expect(
        parsePermissionFixture(
          'src/app/api/not-direct/route.ts',
          [
            "import { handler } from './handler';",
            "const GET = withAuthContext(local, { permission: 'canAdmin' });",
            'function helper() {',
            "  const GET = withAuthContext(local, { permission: 'canReport' });",
            '  return GET;',
            '}',
            'export { handler as GET };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      writeRepoFile(
        root,
        'src/app/api/admin/star-target/route.ts',
        [
          "export const GET = withAuthContext(read, { permission: 'canVisit' });",
          "export const POST = withAuthContext(write, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star/route.ts',
          "export * from '../admin/star-target/route';\n",
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'POST', permissions: ['canAdmin'] },
      ]);

      writeRepoFile(
        root,
        'src/app/api/admin/star-symbol-leaf/route.ts',
        [
          "export const GET = withAuthContext(read, { permission: 'canVisit' });",
          "export const handler = withAuthContext(write, { permission: 'canAdmin' });",
          '',
        ].join('\n'),
      );
      writeRepoFile(
        root,
        'src/app/api/admin/star-symbol-mid/route.ts',
        "export * from '../star-symbol-leaf/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star-symbol-outer/route.ts',
          "export { handler as GET } from '../admin/star-symbol-mid/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      writeRepoFile(
        root,
        'src/app/api/admin/star-conflict-a/route.ts',
        "export const GET = withAuthContext(read, { permission: 'canVisit' });\n",
      );
      writeRepoFile(
        root,
        'src/app/api/admin/star-conflict-b/route.ts',
        "export const GET = withAuthContext(read, { permission: 'canReport' });\n",
      );
      const ambiguousStar = [
        "export * from '../admin/star-conflict-a/route';",
        "export * from '../admin/star-conflict-b/route';",
        '',
      ].join('\n');
      expect(
        parsePermissionFixture('src/app/api/star-conflict/route.ts', ambiguousStar, root),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      expect(
        parsePermissionFixture(
          'src/app/api/named-conflict/route.ts',
          [
            "export { GET } from '../admin/star-conflict-a/route';",
            "export { GET } from '../admin/star-conflict-b/route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/named-duplicate/route.ts',
          [
            "export { GET } from '../admin/star-conflict-a/route';",
            "export { GET } from '../admin/star-conflict-a/./route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/direct-named-precedence/route.ts',
          [
            "export const GET = withAuthContext(read, { permission: 'canAdmin' });",
            "export { GET } from '../admin/star-conflict-a/route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      expect(
        parsePermissionFixture(
          'src/app/api/star-duplicate/route.ts',
          [
            "export * from '../admin/star-target/route';",
            "export * from '../admin/star-target/./route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'POST', permissions: ['canAdmin'] },
      ]);

      writeRepoFile(
        root,
        'src/app/api/admin/star-nonprovider/route.ts',
        "export const POST = withAuthContext(write, { permission: 'canVisit' });\n",
      );
      writeRepoFile(
        root,
        'src/app/api/admin/star-one-provider/route.ts',
        [
          "export * from '../star-symbol-leaf/route';",
          "export * from '../star-nonprovider/route';",
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star-one-provider/route.ts',
          "export { handler as GET } from '../admin/star-one-provider/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      writeRepoFile(
        root,
        'src/app/api/admin/star-http-nonprovider/route.ts',
        "export { GET } from '../star-conflict-b/route';\n",
      );
      writeRepoFile(
        root,
        'src/app/api/admin/star-named-provider/route.ts',
        [
          "export { GET } from '../star-http-nonprovider/route';",
          "export * from '../star-symbol-leaf/route';",
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star-named-provider/route.ts',
          "export { handler as GET } from '../admin/star-named-provider/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      writeRepoFile(
        root,
        'src/app/api/admin/export-authority-leaf/route.ts',
        "export const handler = withAuthContext(run, { permission: 'canVisit' });\n",
      );
      writeRepoFile(
        root,
        'src/app/api/admin/export-authority-mid/route.ts',
        [
          "const handler = withAuthContext(run, { permission: 'canAdmin' });",
          "export * from '../export-authority-leaf/route';",
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/export-authority-outer/route.ts',
          "export { handler as GET } from '../admin/export-authority-mid/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canVisit'] }]);
      writeRepoFile(
        root,
        'src/app/api/admin/nonexport-only/route.ts',
        "const handler = withAuthContext(run, { permission: 'canAdmin' });\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/nonexport-only/route.ts',
          "export { handler as GET } from '../admin/nonexport-only/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      expect(
        parsePermissionFixture(
          'src/app/api/default-get/route.ts',
          [
            'export default function GET() {',
            "  return checkPermission({ permission: 'canAdmin' });",
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([]);
      writeRepoFile(
        root,
        'src/app/api/admin/default-provider/route.ts',
        [
          'export default function handler() {',
          "  return checkPermission({ permission: 'canAdmin' });",
          '}',
          '',
        ].join('\n'),
      );
      writeRepoFile(
        root,
        'src/app/api/admin/default-provider-mid/route.ts',
        "export * from '../default-provider/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/default-provider-outer/route.ts',
          "export { handler as GET } from '../admin/default-provider-mid/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      for (const typeOnlyExport of [
        "export type { GET } from '../admin/star-target/route';\n",
        "export { type GET } from '../admin/star-target/route';\n",
        "export type * from '../admin/star-target/route';\n",
      ]) {
        expect(
          parsePermissionFixture('src/app/api/type-only/route.ts', typeOnlyExport, root),
        ).toEqual([]);
      }
      for (const namespaceGet of [
        "export * as GET from '../admin/star-target/route';\n",
        'export * as "GET" from \'../admin/star-target/route\';\n',
      ]) {
        expect(
          parsePermissionFixture('src/app/api/namespace-get/route.ts', namespaceGet, root),
        ).toEqual([
          {
            method: 'GET',
            permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
          },
        ]);
      }
      expect(
        parsePermissionFixture(
          'src/app/api/namespace-helper/route.ts',
          "export * as helper from '../admin/star-target/route';\n",
          root,
        ),
      ).toEqual([]);
      expect(
        parsePermissionFixture(
          'src/app/api/string-export-name/route.ts',
          'export { handler as "GET" } from \'../admin/star-symbol-leaf/route\';\n',
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      expect(
        parsePermissionFixture(
          'src/app/api/local-star-name/route.ts',
          [
            "const handler = withAuthContext(run, { permission: 'canAdmin' });",
            'export { handler as "*" };',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([]);
      expect(
        parsePermissionFixture(
          'src/app/api/remote-star-name/route.ts',
          'export { handler as "*" } from \'../admin/star-symbol-leaf/route\';\n',
          root,
        ),
      ).toEqual([]);
      writeRepoFile(
        root,
        'src/app/api/admin/named-star-provider/route.ts',
        [
          "const handler = withAuthContext(run, { permission: 'canAdmin' });",
          'export { handler as "*" };',
          '',
        ].join('\n'),
      );
      expect(
        parsePermissionFixture(
          'src/app/api/namespace-named-star/route.ts',
          "export * as GET from '../admin/named-star-provider/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);
      expect(
        parsePermissionFixture(
          'src/app/api/direct-namespace-conflict/route.ts',
          [
            "export const GET = withAuthContext(read, { permission: 'canAdmin' });",
            "export * as GET from '../admin/named-star-provider/route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      for (const branch of ['left', 'right']) {
        writeRepoFile(
          root,
          `src/app/api/admin/star-${branch}/route.ts`,
          "export { GET } from '../star-target/route';\n",
        );
      }
      expect(
        parsePermissionFixture(
          'src/app/api/star-convergent/route.ts',
          [
            "export * from '../admin/star-left/route';",
            "export * from '../admin/star-right/route';",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canVisit'] }]);

      for (const unresolvedStar of [
        "export * from '../admin/missing-star/route';\n",
        "export * from '@careviax/auth-route';\n",
      ]) {
        expect(
          parsePermissionFixture('src/app/api/unresolved-star/route.ts', unresolvedStar, root),
        ).toEqual([
          {
            method: 'UNKNOWN',
            permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
          },
        ]);
      }

      writeRepoFile(
        root,
        'src/app/api/star-cycle-a/route.ts',
        "export * from '../star-cycle-b/route';\n",
      );
      writeRepoFile(
        root,
        'src/app/api/star-cycle-b/route.ts',
        "export * from '../star-cycle-a/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star-cycle-a/route.ts',
          "export * from '../star-cycle-b/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'UNKNOWN',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      writeRepoFile(
        root,
        'src/app/api/star-cycle-provider/route.ts',
        [
          "export * from '../star-cycle-provider-loop/route';",
          "export * from '../admin/star-symbol-leaf/route';",
          '',
        ].join('\n'),
      );
      writeRepoFile(
        root,
        'src/app/api/star-cycle-provider-loop/route.ts',
        "export * from '../star-cycle-provider/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/star-cycle-provider-outer/route.ts',
          "export { handler as GET } from '../star-cycle-provider/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      writeRepoFile(
        root,
        'src/app/api/cycle-a/route.ts',
        "export { GET } from '../cycle-b/route';\n",
      );
      writeRepoFile(
        root,
        'src/app/api/cycle-b/route.ts',
        "export { GET } from '../cycle-a/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/cycle-a/route.ts',
          "export { GET } from '../cycle-b/route';\n",
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      writeRepoFile(
        root,
        'src/app/api/symbol-cycle-b/route.ts',
        [
          "export const bar = withAuthContext(run, { permission: 'canAdmin' });",
          "export { foo as handler } from '../symbol-cycle-c/route';",
          '',
        ].join('\n'),
      );
      writeRepoFile(
        root,
        'src/app/api/symbol-cycle-c/route.ts',
        "export { bar as foo } from '../symbol-cycle-b/route';\n",
      );
      expect(
        parsePermissionFixture(
          'src/app/api/symbol-cycle-outer/route.ts',
          "export { handler as GET } from '../symbol-cycle-b/route';\n",
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);

      const unresolvedLocalReexport =
        "import { authHandler } from '@/lib/auth/config';\nexport { authHandler as GET };\n";
      expect(
        parsePermissionFixture(
          'src/app/api/auth/[...nextauth]/route.ts',
          unresolvedLocalReexport,
          root,
        ),
      ).toEqual([
        {
          method: 'GET',
          permissions: [expect.stringMatching(/^unknown_permission:unresolved_reexport:/)],
        },
      ]);

      const lexicallyScopedRoute = `
      async function readHandler() {
        const requiredPermission = 'canViewDashboard';
        return hasPermission(role, requiredPermission);
      }
      async function writeHandler() {
        const requiredPermission = 'canVisit';
        return hasPermission(role, requiredPermission);
      }
      export const GET = withAuthContext(readHandler);
      export const POST = withAuthContext(writeHandler);
    `;
      expect(parsePermissionFixture('src/app/api/lexical/route.ts', lexicallyScopedRoute)).toEqual([
        { method: 'GET', permissions: ['canViewDashboard'] },
        { method: 'POST', permissions: ['canVisit'] },
      ]);
      const lexicalSwap = lexicallyScopedRoute
        .replace("'canViewDashboard'", "'temporaryPermission'")
        .replace("'canVisit'", "'canViewDashboard'")
        .replace("'temporaryPermission'", "'canVisit'");
      expect(parsePermissionFixture('src/app/api/lexical/route.ts', lexicalSwap)).not.toEqual(
        parsePermissionFixture('src/app/api/lexical/route.ts', lexicallyScopedRoute),
      );
    });
  },
);
