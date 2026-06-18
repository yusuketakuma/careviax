import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const allowedAuditCreateFiles = [
  'src/lib/audit/audit-entry.ts',
  'src/lib/auth/security-events.ts',
  'src/server/services/billing-evidence/core.ts',
  'src/server/services/export-audit.ts',
  'src/server/services/visit-brief.ts',
];

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return collectSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.d\.ts$/.test(entry)) return [];
    return [fullPath];
  });
}

function isTestFile(filePath: string) {
  return (
    filePath.includes(`${join('src', '__tests__')}/`) ||
    filePath.includes('/__tests__/') ||
    /\.(test|spec)\.(ts|tsx)$/.test(filePath)
  );
}

describe('audit log conventions', () => {
  it('keeps implementation audit writes on the reviewed allowlist', () => {
    const filesWithAuditCreates = collectSourceFiles(sourceRoot)
      .map((filePath) => relative(process.cwd(), filePath))
      .filter((filePath) => !isTestFile(filePath))
      .filter((filePath) => /auditLog(?:Client)?\??\.create/.test(readFileSync(filePath, 'utf8')))
      .sort();

    expect(filesWithAuditCreates).toEqual(allowedAuditCreateFiles);
  });
});
