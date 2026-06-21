import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = [
  join(process.cwd(), 'src', 'app', 'api'),
  join(process.cwd(), 'src', 'server'),
];

const FORBIDDEN_DASHBOARD_IMPORT_PATTERN =
  /(?:from\s+['"]|import\(\s*['"])(@\/app\/\(dashboard\)[^'"]*)/g;

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

describe('API/server dependency boundary', () => {
  it('does not import dashboard route modules from production API/server code', () => {
    const actual: Record<string, string[]> = {};

    for (const root of SOURCE_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const relativePath = relative(process.cwd(), file);
        const source = readFileSync(file, 'utf8');
        const imports = [...source.matchAll(FORBIDDEN_DASHBOARD_IMPORT_PATTERN)]
          .map((match) => match[1]!)
          .sort();
        if (imports.length > 0) {
          actual[relativePath] = imports;
        }
      }
    }

    expect(actual).toEqual({});
  });
});
