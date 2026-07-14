import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS_PATH = path.join(process.cwd(), 'src/app/globals.css');

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

describe('Tailwind source boundary', () => {
  it('scans application sources without treating tooling fixtures as UI classes', () => {
    const globalsCss = readFileSync(GLOBALS_CSS_PATH, 'utf8');
    const sourceMatch = globalsCss.match(
      /@import\s+['"]tailwindcss['"]\s+source\(['"]([^'"]+)['"]\);/,
    );

    expect(sourceMatch?.[1]).toBe('..');

    const sourceRoot = path.resolve(path.dirname(GLOBALS_CSS_PATH), sourceMatch?.[1] ?? '');
    expect(sourceRoot).toBe(path.join(process.cwd(), 'src'));
    expect(isWithin(sourceRoot, path.join(process.cwd(), 'src/app/layout.tsx'))).toBe(true);
    expect(
      isWithin(
        sourceRoot,
        path.join(process.cwd(), 'tools/scripts/check-typography-minimum.test.ts'),
      ),
    ).toBe(false);
  });
});
