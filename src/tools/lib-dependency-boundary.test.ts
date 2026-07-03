import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src', 'lib');

const ALLOWED_BOUNDARY_IMPORTS: Record<string, string[]> = {
  'src/lib/api/response.ts': ['@/server/services/label-dictionary'],
  'src/lib/auth/config.ts': ['@/server/services/cognito-auth'],
  // Break-glass step-up re-auth wraps the Cognito auth challenge (same seam as
  // auth/config.ts). server-only module; security-reviewed 2026-07-03.
  'src/lib/platform/step-up-mfa.ts': ['@/server/services/cognito-auth'],
  'src/lib/dispensing/prefill-generator.ts': ['@/server/services/prescription-intake-pair'],
  'src/lib/hooks/use-unsaved-changes-guard.ts': [
    '@/components/providers/navigation-confirm-provider',
  ],
};

const FORBIDDEN_IMPORT_PATTERN =
  /(?:from\s+['"]|import\(\s*['"])(@\/(?:app|components|server)[^'"]*)/g;

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listSourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry) || /\.d\.ts$/.test(entry)) return [];
    return [fullPath];
  });
}

describe('src/lib dependency boundary', () => {
  it('keeps app/component/server imports behind an explicit allowlist', () => {
    const actual: Record<string, string[]> = {};

    for (const file of listSourceFiles(SOURCE_ROOT)) {
      const relativePath = relative(process.cwd(), file);
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(FORBIDDEN_IMPORT_PATTERN)]
        .map((match) => match[1]!)
        .sort();
      if (imports.length > 0) {
        actual[relativePath] = imports;
      }
    }

    expect(actual).toEqual(ALLOWED_BOUNDARY_IMPORTS);
  });
});
