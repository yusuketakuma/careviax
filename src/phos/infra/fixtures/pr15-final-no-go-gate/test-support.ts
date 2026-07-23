import { expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Keep shared gate setup in the excluded test-fixture boundary.
export const repoRoot = process.cwd();

export const canonicalRoot = join(repoRoot, 'src/phos');

export const phosAppRoot = join(repoRoot, 'src/app/(phos)');

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export function readRelative(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

export function readSub(value: unknown): string {
  expect(value).toEqual(expect.objectContaining({ 'Fn::Sub': expect.any(String) }));
  return (value as { 'Fn::Sub': string })['Fn::Sub'];
}

export function expectEvidence(path: string, patterns: readonly RegExp[]) {
  const fullPath = join(repoRoot, path);
  expect(existsSync(fullPath), path).toBe(true);
  const content = readFileSync(fullPath, 'utf8');
  for (const pattern of patterns) {
    expect(content, path).toMatch(pattern);
  }
}

export function expectMissingFiles(paths: readonly string[]) {
  for (const path of paths) {
    expect(existsSync(join(repoRoot, path)), path).toBe(false);
  }
}
