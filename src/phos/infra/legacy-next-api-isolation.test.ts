import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PHOS_API_ROUTES } from './api-gateway-routes';

const repoRoot = process.cwd();
const nextApiRoot = join(repoRoot, 'src/app/api');
const debtDocPath = join(repoRoot, 'docs/phos-legacy-api-isolation.md');
const envExamplePath = join(repoRoot, '.env.example');
const legacyFileRouteFiles = [
  'src/app/api/files/presigned-upload/route.ts',
  'src/app/api/files/complete/route.ts',
  'src/app/api/files/[id]/download/route.ts',
  'src/app/api/files/[id]/presigned-download/route.ts',
] as const;

function listRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? listRouteFiles(path)
      : path.endsWith(`${sep}route.ts`)
        ? [path]
        : [];
  });
}

function normalizeSegment(segment: string): string {
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `{${segment.slice(1, -1)}}`;
  }
  return segment;
}

function toNextApiPath(routeFile: string): string {
  const relativePath = relative(nextApiRoot, routeFile);
  const segments = relativePath
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith('__'))
    .map(normalizeSegment);
  return `/${segments.join('/')}`;
}

function toNextPublicApiPath(routeFile: string): string {
  return `/api${toNextApiPath(routeFile)}`;
}

function phosPublicApiPath(path: string): string {
  return `/api/phos${path}`;
}

function pathToRegExp(path: string): RegExp {
  const pattern = path
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment.startsWith('{') && segment.endsWith('}')) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${pattern}(?:/|$)`);
}

describe('PH-OS legacy Next API isolation', () => {
  it('does not expose canonical PH-OS API Gateway routes as Next.js Route Handlers', () => {
    const routeFiles = listRouteFiles(nextApiRoot);
    const nextApiPaths = new Set(routeFiles.map(toNextApiPath));
    const nextPublicApiPaths = new Set(routeFiles.map(toNextPublicApiPath));
    const phosPaths = PHOS_API_ROUTES.flatMap((route) => [
      route.path,
      `/phos${route.path}`,
      phosPublicApiPath(route.path),
    ]);

    for (const path of phosPaths) {
      expect(nextApiPaths.has(path), path).toBe(false);
      expect(nextPublicApiPaths.has(path), path).toBe(false);
    }
  });

  it('does not let Next.js API route subtrees shadow canonical PH-OS API Gateway paths', () => {
    const routeFiles = listRouteFiles(nextApiRoot);
    const nextApiPaths = [...routeFiles.map(toNextApiPath), ...routeFiles.map(toNextPublicApiPath)];

    for (const route of PHOS_API_ROUTES) {
      const matchers = [
        pathToRegExp(route.path),
        pathToRegExp(`/phos${route.path}`),
        pathToRegExp(phosPublicApiPath(route.path)),
      ];
      const shadowingPaths = nextApiPaths.filter((path) =>
        matchers.some((matcher) => matcher.test(path)),
      );
      expect(shadowingPaths, route.path).toEqual([]);
    }
  });

  it('documents near-overlap legacy routes as non-canonical PH-OS migration debt', () => {
    const doc = readFileSync(debtDocPath, 'utf8');
    const documentedLegacyRoutes = [
      '/api/handoff-board',
      '/api/visit-records/{id}/handoff',
      '/api/visit-preparations/{scheduleId}',
      '/api/visit-schedules',
      '/api/facility-visit-batches',
      '/api/care-reports/{id}/send',
      '/api/care-reports/generate-from-visit',
      '/api/tracing-reports',
      '/api/billing-candidates',
      '/api/billing-rules',
      '/api/billing-evidence/analytics',
      '/api/files/presigned-upload',
      '/api/prescription-intakes',
      '/api/set-plans',
      '/api/dispense-tasks',
      '/api/dashboard/workflow',
    ];

    for (const route of documentedLegacyRoutes) {
      expect(doc).toContain(route);
    }
    expect(doc).toContain('API Gateway + Lambda');
    expect(doc.replace(/\s+/g, ' ')).toContain('not the canonical PH-OS v1.1 API boundary');
  });

  it('keeps PH-OS production from serving legacy file APIs beside canonical evidence upload', () => {
    const doc = readFileSync(debtDocPath, 'utf8');
    const envExample = readFileSync(envExamplePath, 'utf8');
    const boundarySource = readFileSync(
      join(repoRoot, 'src/lib/api/legacy-file-api-boundary.ts'),
      'utf8',
    );

    for (const routeFile of legacyFileRouteFiles) {
      const source = readFileSync(join(repoRoot, routeFile), 'utf8');
      expect(source, routeFile).toContain('legacyFileApiDisabledResponse');
    }

    expect(boundarySource).toContain('PHOS_DISABLE_LEGACY_FILE_API');
    expect(boundarySource).toContain('PHOS_ENABLE_LEGACY_FILE_API');
    expect(boundarySource).toContain("env.NODE_ENV?.trim().toLowerCase() === 'production'");
    expect(boundarySource).toContain('PHOS_LEGACY_FILE_API_DISABLED');
    expect(doc).toContain('PHOS_DISABLE_LEGACY_FILE_API=1');
    expect(doc).toContain('PHOS_ENABLE_LEGACY_FILE_API=1');
    expect(doc).toContain('fails closed');
    expect(envExample).toContain('PHOS_DISABLE_LEGACY_FILE_API=1');
    expect(envExample).toContain('PHOS_ENABLE_LEGACY_FILE_API=');
    expect(doc).toContain('/api/files/complete');
    expect(doc).toContain('/api/files/{id}/download');
    expect(doc).toContain('/api/files/{id}/presigned-download');
    expect(doc).toContain('/evidence/presign-upload');
  });
});
