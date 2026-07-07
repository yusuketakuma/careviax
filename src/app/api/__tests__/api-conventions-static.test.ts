import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = join(process.cwd(), 'src', 'app', 'api');
const sensitiveFileApiRoutes = [
  'src/app/api/files/presigned-upload/route.ts',
  'src/app/api/files/complete/route.ts',
  'src/app/api/files/[id]/presigned-download/route.ts',
  'src/app/api/files/[id]/download/route.ts',
] as const;

const sensitiveFileApiRouteTests = [
  'src/app/api/files/presigned-upload/route.test.ts',
  'src/app/api/files/complete/route.test.ts',
  'src/app/api/files/[id]/presigned-download/route.test.ts',
  'src/app/api/files/[id]/download/route.test.ts',
] as const;

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

  it('keeps sensitive file API routes behind no-store response wrappers', () => {
    const routesMissingNoStore = sensitiveFileApiRoutes.filter((filePath) => {
      const source = readFileSync(join(process.cwd(), filePath), 'utf8');
      return !source.includes('withSensitiveNoStore');
    });

    expect(routesMissingNoStore).toEqual([]);
  });

  it('keeps file API public DTO and PHI leakage regression tests in place', () => {
    const testsMissingNoStoreAssertions = sensitiveFileApiRouteTests.filter((filePath) => {
      const source = readFileSync(join(process.cwd(), filePath), 'utf8');
      return !source.includes('expectSensitiveNoStore');
    });
    const completeTest = readFileSync(
      join(process.cwd(), 'src/app/api/files/complete/route.test.ts'),
      'utf8',
    );
    const completeRoute = readFileSync(
      join(process.cwd(), 'src/app/api/files/complete/route.ts'),
      'utf8',
    );
    const presignedUploadTest = readFileSync(
      join(process.cwd(), 'src/app/api/files/presigned-upload/route.test.ts'),
      'utf8',
    );
    const presignedDownloadTest = readFileSync(
      join(process.cwd(), 'src/app/api/files/[id]/presigned-download/route.test.ts'),
      'utf8',
    );
    const presignedDownloadRoute = readFileSync(
      join(process.cwd(), 'src/app/api/files/[id]/presigned-download/route.ts'),
      'utf8',
    );
    const downloadTest = readFileSync(
      join(process.cwd(), 'src/app/api/files/[id]/download/route.test.ts'),
      'utf8',
    );
    const downloadRoute = readFileSync(
      join(process.cwd(), 'src/app/api/files/[id]/download/route.ts'),
      'utf8',
    );

    expect(testsMissingNoStoreAssertions).toEqual([]);
    expect(completeRoute).toContain('withAuthContext');
    expect(completeRoute).not.toContain('requireAuthContext');
    expect(completeTest).toContain("not.toHaveProperty('originalName')");
    expect(completeTest).toContain("not.toContain('storageKey')");
    expect(presignedUploadTest).toContain("not.toContain('objectKey')");
    expect(presignedUploadTest).toContain("not.toContain('storageKey')");
    expect(presignedDownloadTest).toContain("not.toContain('downloadUrl')");
    expect(presignedDownloadRoute).not.toContain('downloadUrl');
    expect(presignedDownloadRoute).not.toContain('createPresignedDownload');
    expect(downloadTest).toContain("not.toContain('downloadUrl')");
    expect(downloadTest).toContain("headers.get('location')).toBeNull()");
    expect(downloadTest).toContain("responseMode: 'stream'");
    expect(downloadRoute).not.toContain('createPresignedDownload');
    expect(downloadRoute).not.toContain('NextResponse.redirect');
    expect(downloadRoute).not.toContain('downloadUrl');
  });

  it('keeps communication event attachment DTOs away from raw FileAsset names and keys', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/communication-events/route.ts'),
      'utf8',
    );

    expect(source).not.toContain('original_name');
    expect(source).not.toContain('storage_key');
    expect(source).not.toContain('file_name');
  });
});
