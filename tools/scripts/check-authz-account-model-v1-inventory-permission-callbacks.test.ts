import { parseApiPermissionContracts as parseApiPermissionContractsRaw } from './check-authz-account-model-v1-inventory.mjs';
import { temporaryRoot } from './authz-account-model-v1-inventory/fixtures/test-fixtures';
import { describe, expect, it } from 'vitest';

describe(
  'check-authz-account-model-v1-inventory tracks permission evaluator and callback boundaries',
  { timeout: 120_000 },
  () => {
    it('tracks permission evaluator and callback boundaries', () => {
      const root = temporaryRoot('authz-permission-callbacks-');
      for (const [sourcePath, content] of [
        [
          'src/app/api/wrong-permission-evaluator/route.ts',
          "import { hasPermission } from './telemetry'; export const GET = () => hasPermission(role, 'canAdmin');\n",
        ],
        [
          'src/app/api/local-permission-evaluator/route.ts',
          "function hasPermission() { return true; } export const GET = () => hasPermission(role, 'canAdmin');\n",
        ],
        [
          'src/app/api/ambient-permission-evaluator/route.ts',
          "export const GET = () => hasPermission(role, 'canAdmin');\n",
        ],
      ] as const) {
        expect(parseApiPermissionContractsRaw(sourcePath, content, root)[0]?.permissions).toEqual([
          expect.stringMatching(/^unknown_permission:unresolved_expression:/),
        ]);
      }
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/local-permission-wrapper/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            "function checkPermission() { return hasPermission(role, 'canAdmin'); }",
            'export const GET = () => checkPermission();',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      for (const [sourcePath, content] of [
        [
          'src/app/api/parameter-shadow-wrapper/route.ts',
          [
            "import { withAuthContext } from '@/lib/auth/context';",
            'function build(withAuthContext) {',
            "  return withAuthContext(handler, { permission: 'canAdmin' });",
            '}',
            'export const GET = () => build((handler) => handler);',
            '',
          ].join('\n'),
        ],
        [
          'src/app/api/parameter-shadow-evaluator/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            "const build = (hasPermission) => hasPermission(role, 'canAdmin');",
            'export const GET = () => build(() => true);',
            '',
          ].join('\n'),
        ],
        [
          'src/app/api/catch-shadow-evaluator/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            'export function GET() {',
            "  try { throw new Error('x'); } catch (hasPermission) {",
            "    return hasPermission(role, 'canAdmin');",
            '  }',
            '}',
            '',
          ].join('\n'),
        ],
        [
          'src/app/api/destructured-shadow-evaluator/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            'export function GET() {',
            '  const { hasPermission } = telemetry;',
            "  return hasPermission(role, 'canAdmin');",
            '}',
            '',
          ].join('\n'),
        ],
      ] as const) {
        expect(
          parseApiPermissionContractsRaw(sourcePath, content, root)[0]?.permissions.some((value) =>
            value.startsWith('unknown_permission:'),
          ),
        ).toBe(true);
      }
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/default-parameter-auth/route.ts',
          [
            "import { withAuthContext } from '@/lib/auth/context';",
            'const handler = () => new Response();',
            "function build(wrapper = withAuthContext(handler, { permission: 'canAdmin' })) {",
            '  return wrapper;',
            '}',
            'export const GET = build();',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/catch-shadow-scope/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            'export function GET() {',
            "  try { throw new Error('x'); } catch (hasPermission) { void hasPermission; }",
            "  return hasPermission(role, 'canAdmin');",
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: ['canAdmin'] }]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/var-function-scope/route.ts',
          [
            "import { hasPermission } from '@/lib/auth/permissions';",
            'export function GET() {',
            '  if (condition) {',
            "    var guard = () => hasPermission(role, 'canAdmin');",
            '  }',
            '  return guard();',
            '}',
            'export function POST() {',
            '  if (condition) {',
            "    let blockGuard = () => hasPermission(role, 'canVisit');",
            '    return blockGuard();',
            '  }',
            '  return new Response();',
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'POST', permissions: ['canVisit'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/predeclaration-variable-shadow/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { hasPermission } from '@/lib/auth/permissions';",
            'export function GET(request: Request) {',
            "  requireAuthContext(request, { permission: 'canAdmin' });",
            "  var requireAuthContext = () => ({ role: 'clerk' });",
            '  return new Response();',
            '}',
            'export function POST() {',
            "  hasPermission(role, 'canAdmin');",
            '  const hasPermission = () => true;',
            '  return new Response();',
            '}',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/imported-active-callbacks/route.ts',
          [
            "import { checkAccess } from './checks';",
            'export const GET = () => [1].map(checkAccess);',
            'export const POST = () => [1].filter(checkAccess);',
            'export const PUT = () => [1].forEach(checkAccess);',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/unresolved-active-callbacks/route.ts',
          [
            "import { checkAccess } from './checks';",
            "import * as checks from './checks';",
            'const localCheck = (value: number) => value > 0;',
            'const unresolvedAlias = missingCallback;',
            'export const GET = () => [1].map(flag ? checkAccess : localCheck);',
            'export const POST = () => [1].map(...[checkAccess]);',
            'export const PUT = () => [1].map(checks.checkAccess);',
            'export const DELETE = () => [1].map(unresolvedAlias);',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/inert-global-callback/route.ts',
          [
            'export const GET = () => [0, 1].filter(Boolean);',
            'export function POST(Boolean: (value: number) => boolean) {',
            '  return [0, 1].filter(Boolean);',
            '}',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: [] },
        { method: 'POST', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/additional-active-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { checkAccess } from './checks';",
            "import * as checks from './checks';",
            "const localCheck = () => requireAuthContext(request, { permission: 'canAdmin' });",
            'export const GET = () => [2, 1].sort(checkAccess);',
            'export const POST = () => [2, 1].toSorted(flag ? checkAccess : localCheck);',
            'export const PUT = () => Array.from(items, checkAccess);',
            "export const PATCH = () => 'a'.replace(/a/, checkAccess);",
            "export const DELETE = () => 'a'.replaceAll(/a/g, checks.checkAccess);",
            'export const OPTIONS = () => JSON.parse(payload, checkAccess);',
            'export const HEAD = () => [2, 1].sort(localCheck);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'GET', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'HEAD', permissions: ['canAdmin'] },
        { method: 'OPTIONS', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'PATCH', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'POST', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'PUT', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/non-callback-values/route.ts',
          [
            "export const GET = () => 'a'.replace(/a/, 'b');",
            "export const POST = () => JSON.stringify(value, ['id']);",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: [] },
        { method: 'POST', permissions: [] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/imported-promise-executor/route.ts',
          [
            "import { checkAccess } from './checks';",
            'export const GET = new Promise(checkAccess);',
            '',
          ].join('\n'),
          root,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:/)]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/bound-active-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { checkAccess } from './checks';",
            "import * as checks from './checks';",
            "const localCheck = () => requireAuthContext(request, { permission: 'canAdmin' });",
            'const localBound = localCheck.bind(null);',
            'const importedBound = checkAccess.bind(null);',
            "export const GET = () => [1].map((() => requireAuthContext(request, { permission: 'canVisit' })).bind(null));",
            'export const POST = () => [1].map(localBound);',
            'export const PUT = () => [1].map(importedBound);',
            'export const PATCH = () => [1].map(checks.checkAccess.bind(null));',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'PATCH', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'POST', permissions: ['canAdmin'] },
        { method: 'PUT', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/callback-factory-results/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { makeImportedGuard } from './guards';",
            "const makeLocalGuard = () => () => requireAuthContext(request, { permission: 'canAdmin' });",
            'const localFactoryResult = makeLocalGuard();',
            'export const GET = () => [1].map(makeLocalGuard());',
            'export const POST = () => [1].map(localFactoryResult);',
            'export const PUT = () => [1].map(makeImportedGuard());',
            'export const PATCH = () => [1].map(makeLocalGuard().bind(null));',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length >= 1 &&
            contract.permissions.some((permission) => permission.startsWith('unknown_permission:')),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-member-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { importedGuard } from './guards';",
            "const taskOptions = { execute: async () => requireAuthContext(request, { permission: 'canReport' }) };",
            "export const GET = () => new ReadableStream({ async start() { requireAuthContext(request, { permission: 'canAdmin' }); } });",
            "export const POST = () => runTask({ execute: async () => requireAuthContext(request, { permission: 'canVisit' }) });",
            'export const PUT = () => runTask({ execute: importedGuard });',
            'export const PATCH = () => runTask(taskOptions);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'PATCH', permissions: ['canReport'] },
        { method: 'POST', permissions: ['canVisit'] },
        { method: 'PUT', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-lifecycle/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { makeImportedSource } from './stream-source';",
            "const makeLocalSource = () => ({ start() { requireAuthContext(request, { permission: 'canAdmin' }); } });",
            "const mutated = {}; mutated.start = () => requireAuthContext(request, { permission: 'canVisit' });",
            "const assigned = {}; Object.assign(assigned, { start() { requireAuthContext(request, { permission: 'canReport' }); } });",
            "const aliased = {}; const alias = aliased; alias.start = () => requireAuthContext(request, { permission: 'canManageUsers' });",
            'const escaped = {}; configureSource(escaped);',
            'export const GET = () => new ReadableStream(makeLocalSource());',
            'export const POST = () => new ReadableStream(makeImportedSource());',
            'export const PUT = () => new ReadableStream(flag ? makeLocalSource() : makeImportedSource());',
            'export const PATCH = () => new ReadableStream(mutated);',
            'export const DELETE = () => new ReadableStream(assigned);',
            'export const OPTIONS = () => new ReadableStream(aliased);',
            'export const HEAD = () => new ReadableStream(escaped);',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length >= 1 &&
            contract.permissions.some((permission) => permission.startsWith('unknown_permission:')),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-reverse-aliases/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { ReadableStream as ImportedStream } from 'node:stream/web';",
            "const base = {}; const reverseAlias = base; base.start = () => requireAuthContext(request, { permission: 'canAdmin' });",
            "const assignedBase = {}; const assignedAlias = assignedBase; Object.assign(assignedBase, { start() { requireAuthContext(request, { permission: 'canVisit' }); } });",
            'const escapedBase = {}; const escapedAlias = escapedBase; configureSource(escapedBase);',
            "const contained = {}; const box = { contained }; box.contained.start = () => requireAuthContext(request, { permission: 'canReport' });",
            "const destructured = {}; const holder = { destructured }; const { destructured: extracted } = holder; extracted.start = () => requireAuthContext(request, { permission: 'canManageUsers' });",
            'const makeSource = () => ({ start() {} });',
            'const LocalStream = ReadableStream;',
            'export const GET = () => new ReadableStream(reverseAlias);',
            'export const POST = () => new ReadableStream(assignedAlias);',
            'export const PUT = () => new ReadableStream(escapedAlias);',
            'export const PATCH = () => new ReadableStream(contained);',
            'export const DELETE = () => new ReadableStream(destructured);',
            'export const OPTIONS = () => new ImportedStream(makeSource());',
            'export const HEAD = () => new LocalStream(makeSource());',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length >= 1 &&
            contract.permissions.some((permission) => permission.startsWith('unknown_permission:')),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-boundary-aliases/route.ts',
          [
            "import * as streamWeb from 'node:stream/web';",
            "import { ReadableStream as WrongModuleStream } from './lookalike';",
            'const makeSource = () => ({ start() {} });',
            'const ShadowedStream = ReadableStream;',
            'export const GET = () => new streamWeb.ReadableStream(makeSource());',
            "export const POST = () => new globalThis['ReadableStream'](makeSource());",
            'export const PUT = () => new WrongModuleStream(makeSource());',
            'export const PATCH = () => new ShadowedStream(makeSource());',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-boundary-transforms/route.ts',
          [
            'const makeSource = () => ({ start() {} });',
            'const BoundStream = ReadableStream.bind(globalThis);',
            'const ConditionalStream = flag ? ReadableStream : WritableStream;',
            'const CommaStream = (0, ReadableStream);',
            'const IdentityStream = identity(ReadableStream);',
            'let AssignedStream; AssignedStream = ReadableStream;',
            'function selectStream() { return ReadableStream; }',
            'const FactoryStream = selectStream();',
            'export const GET = () => new BoundStream(makeSource());',
            'export const POST = () => new ConditionalStream(makeSource());',
            'export const PUT = () => new CommaStream(makeSource());',
            'export const PATCH = () => new IdentityStream(makeSource());',
            'export const DELETE = () => new AssignedStream(makeSource());',
            'export const OPTIONS = () => new FactoryStream(makeSource());',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-boundary-logical-factories/route.ts',
          [
            'const makeSource = () => ({ start() {} });',
            'const OrStream = globalThis.ReadableStream || globalThis.WritableStream;',
            'const NullishStream = globalThis.ReadableStream ?? globalThis.WritableStream;',
            'const AndStream = enabled && ReadableStream;',
            'const selectArrowStream = () => ReadableStream;',
            'const ArrowFactoryStream = selectArrowStream();',
            'const selectFunctionStream = function () { return ReadableStream; };',
            'const FunctionFactoryStream = selectFunctionStream();',
            'const streamFactories = { select() { return ReadableStream; } };',
            'const MemberFactoryStream = streamFactories.select();',
            'export const GET = () => new OrStream(makeSource());',
            'export const POST = () => new NullishStream(makeSource());',
            'export const PUT = () => new AndStream(makeSource());',
            'export const PATCH = () => new ArrowFactoryStream(makeSource());',
            'export const DELETE = () => new FunctionFactoryStream(makeSource());',
            'export const OPTIONS = () => new MemberFactoryStream(makeSource());',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length === 1 &&
            contract.permissions[0].startsWith('unknown_permission:'),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-accessors-computed/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { importedGuard, makeImportedGuard } from './guards';",
            "const localGuard = () => requireAuthContext(request, { permission: 'canAdmin' });",
            "const startKey = 'start'; const dynamicKey = getKey();",
            'export const GET = () => new ReadableStream({ get start() { return localGuard; } });',
            'export const POST = () => new ReadableStream({ get [startKey]() { return localGuard; } });',
            'export const PUT = () => new ReadableStream({ get [dynamicKey]() { return importedGuard; } });',
            'export const PATCH = () => new ReadableStream({ [dynamicKey]: importedGuard });',
            'export const DELETE = () => new ReadableStream({ [dynamicKey]: localGuard });',
            'export const OPTIONS = () => new ReadableStream({ [dynamicKey]: makeImportedGuard() });',
            'export const HEAD = () => new ReadableStream({ set start(callback) { consume(callback); } });',
            '',
          ].join('\n'),
          root,
        ).every(
          (contract) =>
            contract.permissions.length >= 1 &&
            contract.permissions.some((permission) => permission.startsWith('unknown_permission:')),
        ),
      ).toBe(true);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/registered-constructor-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { importedGuard, makeImportedGuard } from './guards';",
            "const localGuard = () => requireAuthContext(request, { permission: 'canReport' });",
            "export const GET = () => new IntersectionObserver(() => requireAuthContext(request, { permission: 'canAdmin' }));",
            "export const POST = () => new MutationObserver(function () { requireAuthContext(request, { permission: 'canVisit' }); });",
            'export const PUT = () => new ResizeObserver(localGuard);',
            'export const PATCH = () => new IntersectionObserver(importedGuard);',
            'export const DELETE = () => new MutationObserver(makeImportedGuard());',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'PATCH', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'POST', permissions: ['canVisit'] },
        { method: 'PUT', permissions: ['canReport'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/registered-call-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { importedGuard, makeImportedGuard } from './guards';",
            "const visitGuard = () => requireAuthContext(request, { permission: 'canVisit' });",
            "const reportGuard = () => requireAuthContext(request, { permission: 'canReport' });",
            "const adminGuard = () => requireAuthContext(request, { permission: 'canAdmin' });",
            'export const GET = () => runTask(visitGuard);',
            'export const POST = () => createBackgroundTask(reportGuard);',
            'export const PUT = () => registerFooHandler(adminGuard);',
            'export const PATCH = () => runTask(importedGuard);',
            'export const DELETE = () => createBackgroundTask(makeImportedGuard());',
            'export const OPTIONS = () => consumeData(visitGuard);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'OPTIONS', permissions: [] },
        { method: 'PATCH', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'POST', permissions: ['canReport'] },
        { method: 'PUT', permissions: ['canAdmin'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/transformed-registered-call-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "const guard = () => requireAuthContext(request, { permission: 'canVisit' });",
            'const registry = { runTask };',
            'const { runTask: executeTask } = registry;',
            'export const GET = () => executeTask(guard);',
            'export const POST = () => runTask.call(null, guard);',
            'export const PUT = () => runTask.apply(null, [guard]);',
            'export const PATCH = () => Reflect.apply(runTask, null, [guard]);',
            "export const DELETE = () => runTask['call'](null, guard);",
            "export const OPTIONS = () => runTask['apply'](null, [guard]);",
            "export const HEAD = () => Reflect['apply'](runTask, null, [guard]);",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: ['canVisit'] },
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'HEAD', permissions: ['canVisit'] },
        { method: 'OPTIONS', permissions: ['canVisit'] },
        { method: 'PATCH', permissions: ['canVisit'] },
        { method: 'POST', permissions: ['canVisit'] },
        { method: 'PUT', permissions: ['canVisit'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/reflect-alias-callbacks/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "const guard = () => requireAuthContext(request, { permission: 'canVisit' });",
            'const R = Reflect; const { apply } = Reflect;',
            'export const GET = () => R.apply(runTask, null, [guard]);',
            'export const POST = () => apply(runTask, null, [guard]);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'POST', permissions: ['canVisit'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/transformed-standard-callbacks/route.ts',
          [
            "import { importedCheck } from './guards';",
            'export const GET = () => Array.prototype.map.call([1], importedCheck);',
            'export const POST = () => Array.prototype.map.apply([1], [importedCheck]);',
            'export const PUT = () => Reflect.apply(Array.prototype.map, [1], [importedCheck]);',
            "export const DELETE = () => Array.prototype.map['call']([1], importedCheck);",
            "export const OPTIONS = () => Array.prototype.map['apply']([1], [importedCheck]);",
            "export const PATCH = () => Reflect['apply'](Array.prototype.map, [1], [importedCheck]);",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'GET', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'OPTIONS', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'PATCH', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'POST', permissions: [expect.stringMatching(/^unknown_permission:/)] },
        { method: 'PUT', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/custom-data-method/route.ts',
          [
            "import { config, service } from './service';",
            'export const GET = () => service.map(config);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([{ method: 'GET', permissions: [] }]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/custom-local-data-method/route.ts',
          [
            'const service = { map(value) { return value; }, filter(value) { return value; } };',
            "const textConfig = 'x'; const numericConfig = 1;",
            "import { importedCheck } from './guards'; let deferred = null; deferred = importedCheck;",
            'export const GET = () => service.map(textConfig);',
            'export const POST = () => service.filter(numericConfig);',
            'export const PUT = () => [1].map(deferred);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: [] },
        { method: 'POST', permissions: [] },
        { method: 'PUT', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/destructured-registered-constructors/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "import { importedGuard } from './guards';",
            "const guard = () => requireAuthContext(request, { permission: 'canVisit' });",
            'const { Observer } = { Observer: IntersectionObserver };',
            'export const GET = () => new Observer(guard);',
            "export const POST = async () => { const { ReadableStream: StreamCtor } = await import('node:stream/web'); return new StreamCtor({ start: importedGuard }); };",
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canVisit'] },
        { method: 'POST', permissions: [expect.stringMatching(/^unknown_permission:/)] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/awaited-registered-constructors/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            'async function getObserver() { return IntersectionObserver; }',
            "import { getObserver as getImportedObserver } from './observer';",
            "const guard = () => requireAuthContext(request, { permission: 'canVisit' });",
            "export const GET = async () => new (await getObserver())(() => requireAuthContext(request, { permission: 'canAdmin' }));",
            "export const POST = async () => new (await Promise.resolve(MutationObserver))(() => requireAuthContext(request, { permission: 'canVisit' }));",
            "export const PUT = async () => new (await import('node:stream/web'))['ReadableStream']({ start() { requireAuthContext(request, { permission: 'canReport' }); } });",
            'export const PATCH = async () => new (await getImportedObserver())(guard);',
            'const getChainedObserver = async () => Promise.resolve(IntersectionObserver).then((Ctor) => Ctor);',
            'export const DELETE = async () => new (await getChainedObserver())(guard);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'DELETE', permissions: ['canVisit'] },
        { method: 'GET', permissions: ['canAdmin'] },
        {
          method: 'PATCH',
          permissions: ['canVisit', expect.stringMatching(/^unknown_permission:/)],
        },
        { method: 'POST', permissions: ['canVisit'] },
        { method: 'PUT', permissions: ['canReport'] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/object-callback-boundary-negative/route.ts',
          [
            "import { requireAuthContext } from '@/lib/auth/context';",
            "const unchanged = { start() { requireAuthContext(request, { permission: 'canAdmin' }); } };",
            'const unchangedAlias = unchanged; const unchangedAliasTwo = unchangedAlias;',
            "const ordinaryData = {}; ordinaryData.start = () => requireAuthContext(request, { permission: 'canVisit' });",
            'export const GET = () => new ReadableStream(unchangedAliasTwo);',
            'export const POST = () => consumeData(ordinaryData);',
            '',
          ].join('\n'),
          root,
        ),
      ).toEqual([
        { method: 'GET', permissions: ['canAdmin'] },
        { method: 'POST', permissions: [] },
      ]);
      expect(
        parseApiPermissionContractsRaw(
          'src/app/api/imported-zero-argument-factory/route.ts',
          ["import { createGET } from './factory';", 'export const GET = createGET();', ''].join(
            '\n',
          ),
          root,
        )[0]?.permissions,
      ).toEqual([expect.stringMatching(/^unknown_permission:unresolved_direct_method:/)]);
    });
  },
);
