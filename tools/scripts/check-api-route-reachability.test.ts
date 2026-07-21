import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-api-route-reachability.mjs');
const FILE_DISCOVERY_PATH = path.join(
  process.cwd(),
  'tools/scripts/api-route-reachability/file-discovery.mjs',
);
const FIXED_TODAY = '2026-07-15';

type InventoryEntry = {
  key: string;
  route: string;
  method: string;
  export_kind: string;
  classification: string;
  owner?: string;
  expiry?: string;
  review_state?: string;
  evidence: Array<{ path: string; kind: string; symbol: string; reference: string }>;
};

type Inventory = {
  route_file_count: number;
  route_method_count: number;
  entries: InventoryEntry[];
};

function createFixtureRepo(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-api-route-reachability-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-api-route-reachability.mjs'));
  mkdirSync(path.join(root, 'tools/scripts/api-route-reachability'), { recursive: true });
  cpSync(
    FILE_DISCOVERY_PATH,
    path.join(root, 'tools/scripts/api-route-reachability/file-discovery.mjs'),
  );
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir');

  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, source);
  }
  return root;
}

function runScript(root: string, args: string[] = []) {
  return execFileSync(
    process.execPath,
    ['tools/scripts/check-api-route-reachability.mjs', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, API_ROUTE_REACHABILITY_TODAY: FIXED_TODAY },
    },
  );
}

function readInventory(root: string) {
  return JSON.parse(
    readFileSync(path.join(root, 'tools/api-route-reachability-inventory.json'), 'utf8'),
  ) as Inventory;
}

function baseFixture() {
  return {
    'src/app/api/example/route.ts': `
      export async function GET() { return new Response(); }
      export const POST = async () => new Response();
    `,
    'src/app/api/local/[id]/route.ts': `
      const handler = async () => new Response();
      export { handler as PATCH };
    `,
    'src/app/api/forward/route.ts': `
      export { GET, POST as PUT } from './handlers';
      export type { DELETE } from './types';
    `,
    'src/app/api/catch/[[...path]]/route.ts': `
      export async function GET() { return new Response(); }
    `,
    'src/app/api/auth/session/route.ts': `
      export const GET = async () => new Response();
    `,
    'src/app/api/external-access/[token]/route.ts': `
      export const POST = async () => new Response();
    `,
    'src/lib/example-api-paths.ts': `
      export function buildLocalApiPath(id: string) {
        return \`/api/local/\${encodeURIComponent(id)}\`;
      }
    `,
    'src/app/dashboard/page.tsx': `
      import { buildLocalApiPath } from '../../lib/example-api-paths';
      export async function load(id: string) {
        await fetch('/api/example');
        await fetch('/api/example', { method: 'POST' });
        await fetch(buildLocalApiPath(id), { method: 'PATCH' });
      }
    `,
  };
}

describe('check-api-route-reachability', () => {
  it('inventories direct, const, local alias, re-export, dynamic, and multi-method routes', () => {
    const root = createFixtureRepo(baseFixture());

    expect(runScript(root, ['--write'])).toContain('6 route files / 8 route-methods');
    expect(runScript(root)).toContain('API route reachability check passed');

    const inventory = readInventory(root);
    expect(inventory).toMatchObject({ route_file_count: 6, route_method_count: 8 });
    expect(inventory.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'GET /api/example',
          export_kind: 'direct',
          classification: 'reachable_ui_rsc_client',
        }),
        expect.objectContaining({
          key: 'POST /api/example',
          export_kind: 'direct',
          classification: 'reachable_ui_rsc_client',
          evidence: [expect.objectContaining({ symbol: 'fetch' })],
        }),
        expect.objectContaining({
          key: 'PATCH /api/local/:id',
          export_kind: 'local_alias',
          classification: 'reachable_ui_rsc_client',
        }),
        expect.objectContaining({
          key: 'GET /api/forward',
          export_kind: 're_export',
        }),
        expect.objectContaining({
          key: 'PUT /api/forward',
          export_kind: 're_export',
        }),
        expect.objectContaining({
          key: 'GET /api/catch/*path?',
          classification: 'owner_review_pending_orphan_retire_candidate',
        }),
        expect.objectContaining({
          key: 'GET /api/auth/session',
          classification: 'internal_job_webhook_bff_auth',
        }),
        expect.objectContaining({
          key: 'POST /api/external-access/:token',
          classification: 'external_public',
        }),
      ]),
    );
  });

  it('fails closed when a new method is not in the reviewed inventory', () => {
    const files = baseFixture();
    const root = createFixtureRepo(files);
    runScript(root, ['--write']);
    writeFileSync(
      path.join(root, 'src/app/api/example/route.ts'),
      `${files['src/app/api/example/route.ts']}\nexport const DELETE = async () => new Response();\n`,
    );

    expect(() => runScript(root)).toThrow(/unclassified live route-method DELETE \/api\/example/u);
  });

  it('fails closed when a stale method remains in the inventory', () => {
    const files = baseFixture();
    const root = createFixtureRepo(files);
    runScript(root, ['--write']);
    writeFileSync(
      path.join(root, 'src/app/api/example/route.ts'),
      `export async function GET() { return new Response(); }\n`,
    );

    expect(() => runScript(root)).toThrow(/stale inventory route-method POST \/api\/example/u);
  });

  it('does not count tests, rate-limit declarations, or route files as consumer evidence', () => {
    const root = createFixtureRepo({
      'src/app/api/unused/route.ts': `export const GET = async () => new Response();`,
      'src/app/api/unused/route.test.ts': `fetch('/api/unused');`,
      'src/lib/api/rate-limit.ts': `export const routes = ['/api/unused'];`,
      'src/lib/unused-api-path.ts': `export const UNUSED_API_PATH = '/api/unused';`,
      'src/lib/unused-api-guard.ts': `export const isUnusedApi = (value: string) => value.startsWith('/api/unused');`,
      'src/lib/unused-api-helper.ts': `
        auditRequest('/api/unused');
        downloadLabel('/api/unused');
        fetchLabel('/api/unused');
      `,
      'src/lib/property-fetch.ts': `
        client.fetch('/api/unused');
        logger.fetchImpl('/api/unused');
        cache.fetchEvidenceSync('/api/unused');
      `,
      'src/lib/shadowed-fetch.ts': `
        function fetch(value: string) { return value; }
        export const result = fetch('/api/unused');
      `,
      'src/lib/destructured-fetch.ts': `
        const { fetch } = fakeClient;
        export const result = fetch('/api/unused');
      `,
      'src/lib/fake-approved-fetch-names.ts': `
        function fetchImpl(value: string) { return value; }
        function fetchEvidenceSync(value: string) { return value; }
        export const results = [fetchImpl('/api/unused'), fetchEvidenceSync('/api/unused')];
      `,
      'src/lib/unused-api-builder.ts': `
        export function buildUnusedApiPath() { return '/api/unused'; }
      `,
      'src/app/external-builder-import.ts': `
        import { buildUnusedApiPath } from 'third-party';
        export const result = fetch(buildUnusedApiPath());
      `,
    });

    runScript(root, ['--write']);
    expect(readInventory(root).entries[0]).toMatchObject({
      classification: 'owner_review_pending_orphan_retire_candidate',
      review_state: 'pending',
      owner: 'API-REACHABILITY-RATCHET-001',
      expiry: '2026-10-15',
    });
  });

  it('resolves constant and spread methods but never invents GET for unknown options', () => {
    const root = createFixtureRepo({
      'src/app/api/methods/route.ts': `
        export const GET = async () => new Response();
        export const POST = async () => new Response();
        export const PATCH = async () => new Response();
      `,
      'src/app/api/shorthand/route.ts': `
        export const GET = async () => new Response();
        export const POST = async () => new Response();
      `,
      'src/app/dashboard/page.tsx': `
        const METHOD = 'POST' as const;
        const method = 'POST' as const;
        const postOptions = { method: METHOD } as const;
        const patchOptions = { method: 'PATCH' as const };
        declare const unknownOptions: RequestInit;
        export async function load() {
          await fetch('/api/methods', postOptions);
          await fetch('/api/methods', { ...patchOptions });
          await fetch('/api/methods', unknownOptions);
          await fetch(new Request('/api/methods', { method: 'POST' }));
          auditRequest('/api/methods');
          await fetch('/api/shorthand', { method });
        }
      `,
    });

    runScript(root, ['--write']);
    const entries = readInventory(root).entries;
    expect(entries.find((entry) => entry.key === 'POST /api/methods')).toMatchObject({
      classification: 'reachable_ui_rsc_client',
    });
    expect(entries.find((entry) => entry.key === 'PATCH /api/methods')).toMatchObject({
      classification: 'reachable_ui_rsc_client',
    });
    expect(entries.find((entry) => entry.key === 'GET /api/methods')).toMatchObject({
      classification: 'owner_review_pending_orphan_retire_candidate',
    });
    expect(entries.find((entry) => entry.key === 'POST /api/shorthand')).toMatchObject({
      classification: 'reachable_ui_rsc_client',
    });
    expect(entries.find((entry) => entry.key === 'GET /api/shorthand')).toMatchObject({
      classification: 'owner_review_pending_orphan_retire_candidate',
    });
  });

  it('does not let a static route reference prove a less-specific dynamic route method', () => {
    const root = createFixtureRepo({
      'src/app/api/reports/[id]/route.ts': `export const GET = async () => new Response();`,
      'src/app/api/reports/analytics/route.ts': `export const POST = async () => new Response();`,
      'src/app/dashboard/page.tsx': `export async function load() { return fetch('/api/reports/analytics'); }`,
    });

    runScript(root, ['--write']);
    const dynamicGet = readInventory(root).entries.find(
      (entry) => entry.key === 'GET /api/reports/:id',
    );
    expect(dynamicGet).toMatchObject({
      classification: 'owner_review_pending_orphan_retire_candidate',
    });
  });

  it('rejects a stale orphan classification after a production consumer is added', () => {
    const root = createFixtureRepo({
      'src/app/api/unused/route.ts': `export const GET = async () => new Response();`,
      'src/app/dashboard/page.tsx': `export const page = true;`,
    });
    runScript(root, ['--write']);
    writeFileSync(
      path.join(root, 'src/app/dashboard/page.tsx'),
      `export async function load() { return fetch('/api/unused'); }`,
    );

    expect(() => runScript(root)).toThrow(/classification.*reachable_ui_rsc_client/u);
  });

  it('rejects duplicate direct and alias exports for the same route method', () => {
    const root = createFixtureRepo({
      'src/app/api/duplicate/route.ts': `
        export const GET = async () => new Response();
        export { GET };
      `,
    });

    expect(() => runScript(root, ['--write'])).toThrow(
      /duplicate live export GET \/api\/duplicate/u,
    );
  });

  it('rejects route files without a supported HTTP method export', () => {
    const root = createFixtureRepo({
      'src/app/api/empty/route.ts': `export const runtime = 'nodejs';`,
    });

    expect(() => runScript(root, ['--write'])).toThrow(
      /route file has no supported HTTP method export/u,
    );
  });

  it('rejects expired orphan reviews', () => {
    const root = createFixtureRepo({
      'src/app/api/unused/route.ts': `export const GET = async () => new Response();`,
    });
    runScript(root, ['--write']);
    const inventory = readInventory(root);
    inventory.entries[0].expiry = '2026-07-14';
    writeFileSync(
      path.join(root, 'tools/api-route-reachability-inventory.json'),
      `${JSON.stringify(inventory, null, 2)}\n`,
    );

    expect(() => runScript(root)).toThrow(/orphan review expired on 2026-07-14/u);
  });
});
