import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const fixtureRoots: string[] = [];
const checkerPath = fileURLToPath(new URL('./check-typography-minimum.mjs', import.meta.url));

type ExpectedCounts = Partial<
  Record<'tailwind-text' | 'inline-font-size' | 'jsx-font-size' | 'css-font-size', number>
>;

function createFixture(
  files: Record<string, string>,
  entries: Array<{ path: string; expectedCounts: ExpectedCounts }>,
) {
  const root = mkdtempSync(path.join(tmpdir(), 'careviax-typography-check-'));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  // The copied ESM checker imports TypeScript; link its only production dependency
  // so fixture roots stay outside the shared worktree even after interruption.
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  symlinkSync(
    path.join(process.cwd(), 'node_modules/typescript'),
    path.join(root, 'node_modules/typescript'),
  );
  copyFileSync(checkerPath, path.join(root, 'tools/scripts/check-typography-minimum.mjs'));
  writeFileSync(
    path.join(root, 'tools/typography-minimum-allowlist.json'),
    JSON.stringify({
      entries: entries.map((entry) => ({
        ...entry,
        reason: 'Fixture-only existing typography debt.',
      })),
    }),
  );

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return root;
}

function runCheck(root: string) {
  return spawnSync(process.execPath, ['tools/scripts/check-typography-minimum.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('check-typography-minimum', () => {
  it('accepts an exact syntax-kind baseline and ignores non-production renderer and fixture files', () => {
    const root = createFixture(
      {
        'src/surface.tsx': [
          "const compact = 'text-[11px] text-[11px/16px] text-[length:10.5px] [font-size:9px]';",
          "const style = { fontSize: '10.5px' };",
          "const printStyle = { fontSize: '9pt' };",
          "const dashed = { 'font-size': 11 };",
          "const conditional = { fontSize: ready ? '12px' : '11px' };",
          'const fallback = { fontSize: 12 ?? 10 };',
          'const fallbackOr = { fontSize: 12 || 10 };',
          'const label = <Text fontSize={9} />;',
          'const chart = <svg><text fontSize={10} /></svg>;',
        ].join('\n'),
        'src/print.css': '.note { font-size: 9px; } .print { font-size: 9pt; }',
        'src/surface.test.tsx': "const fixture = 'text-[9px]';",
        'src/surface.spec.ts': "const fixture = 'text-[9px]';",
        'src/surface.stories.ts': "const fixture = 'text-[9px]';",
        'src/__tests__/surface.tsx': "const fixture = 'text-[9px]';",
        'src/types.d.ts': "type Fixture = 'text-[9px]';",
        'src/server/services/pdf-documents.tsx': 'const style = { fontSize: 8 };',
      },
      [
        {
          path: 'src/surface.tsx',
          expectedCounts: {
            'inline-font-size': 5,
            'jsx-font-size': 2,
            'tailwind-text': 4,
          },
        },
        {
          path: 'src/print.css',
          expectedCounts: { 'css-font-size': 1 },
        },
      ],
    );

    const result = runCheck(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('12 allowlisted sub-12px occurrence(s), 0 drift');
  });

  it('rejects a new unallowlisted production occurrence', () => {
    const root = createFixture(
      {
        'src/existing.tsx': "const compact = 'text-[11px]';",
        'src/new.tsx': "const compact = 'text-[10px]';",
      },
      [{ path: 'src/existing.tsx', expectedCounts: { 'tailwind-text': 1 } }],
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('New production sub-12px typography');
    expect(result.stderr).toContain('src/new.tsx:1');
  });

  it('rejects stale allowlist counts after remediation', () => {
    const root = createFixture(
      {
        'src/surface.tsx': "const compact = 'text-[11px]';",
      },
      [{ path: 'src/surface.tsx', expectedCounts: { 'tailwind-text': 2 } }],
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Stale typography debt entries');
    expect(result.stderr).toContain('expected={tailwind-text=2} actual={tailwind-text=1}');
  });

  it('rejects a syntax-kind swap even when the file total remains unchanged', () => {
    const root = createFixture(
      {
        'src/surface.tsx': 'const style = { fontSize: 11 };',
      },
      [{ path: 'src/surface.tsx', expectedCounts: { 'tailwind-text': 1 } }],
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Stale typography debt entries');
    expect(result.stderr).toContain('expected={tailwind-text=1} actual={inline-font-size=1}');
  });

  it('rejects dynamic inline and CSS font-size values that cannot prove the minimum', () => {
    const root = createFixture(
      {
        'src/surface.tsx': 'const style = { fontSize: readSize() };',
        'src/tailwind.tsx':
          "const compact = 'text-[0.625rem] text-[length:var(--ui-text-size)] text-[var(--ambiguous)] [font-size:inherit]';",
        'src/surface.css':
          '.scale { font-size: var(--ui-text-size); } .calculated { font-size: calc(10px + 1px); } .shortcut { font: 400 11px/1 sans-serif; }',
      },
      [],
    );

    const result = runCheck(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unresolved production font-size');
    expect(result.stderr).toContain('unresolved-inline-font-size');
    expect(result.stderr).toContain('unresolved-tailwind-font-size');
    expect(result.stderr).toContain('unresolved-css-font-size');
    expect(result.stderr).toContain('unresolved-css-font');
  });
});
