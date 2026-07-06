import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scannedRoots = ['src/app', 'src/components/features'] as const;
const sourceFilePattern = /\.(ts|tsx)$/;
const ignoredFilePattern = /\.(test|spec)\.(ts|tsx)$/;

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    if (!sourceFilePattern.test(path) || ignoredFilePattern.test(path)) return [];
    return [path];
  });
}

describe('DataTable export policy', () => {
  it('keeps production dashboard and feature screens off loaded-row client CSV exports', () => {
    const violations = scannedRoots.flatMap((root) =>
      listSourceFiles(join(repoRoot, root)).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        if (!/\bclientExport\s*:/.test(source)) return [];
        return [relative(repoRoot, file)];
      }),
    );

    expect(violations).toEqual([]);
  });

  it('does not reintroduce legacy enableExport call sites', () => {
    const violations = scannedRoots.flatMap((root) =>
      listSourceFiles(join(repoRoot, root)).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        if (!/\benableExport\s*=|\benableExport\s*:/.test(source)) return [];
        return [relative(repoRoot, file)];
      }),
    );

    expect(violations).toEqual([]);
  });
});
