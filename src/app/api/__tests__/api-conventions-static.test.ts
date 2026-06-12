import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = join(process.cwd(), 'src', 'app', 'api');

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return collectRouteFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

function relativeRoutePath(filePath: string): string {
  return relative(process.cwd(), filePath);
}

describe('API route conventions', () => {
  const routeFiles = collectRouteFiles(apiRoot);

  it('keeps new API route handlers on withAuthContext or explicit auth context', () => {
    const legacyWithAuthRoutes = routeFiles
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('withAuth('))
      .map(relativeRoutePath);

    expect(legacyWithAuthRoutes).toEqual([]);
  });

  it('keeps API audit writes behind createAuditLogEntry helpers', () => {
    const rawAuditLogRoutes = routeFiles
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('auditLog.create'))
      .map(relativeRoutePath);

    expect(rawAuditLogRoutes).toEqual([]);
  });
});
