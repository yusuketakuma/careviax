import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-client-json-schema.mjs');

function allowlist(entries: unknown[] = []) {
  return {
    version: 1,
    owner: 'API-CONTRACT-001',
    debtId: 'API-CONTRACT-001FZCLIENTRATCHET',
    reason: 'Fixture debt.',
    plannedAction: 'Add runtime schemas.',
    entries,
  };
}

function createFixtureRepo(files: Record<string, string>, entries: unknown[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-client-json-schema-'));
  mkdirSync(path.join(root, 'tools'), { recursive: true });
  writeFileSync(
    path.join(root, 'tools/client-json-schema-allowlist.json'),
    JSON.stringify(allowlist(entries)),
  );
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, [SCRIPT_PATH], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-client-json-schema', () => {
  it('accepts direct readers with an inline schema option', () => {
    const root = createFixtureRepo({
      'src/example.ts': `
        import { readApiJson } from '@/lib/api/client-json';
        export const read = (response, schema) =>
          readApiJson(response, { fallbackMessage: 'failed', schema });
      `,
    });

    expect(runCheck(root)).toContain('1 schema-backed, 0 allowlisted schema-less calls');
  });

  it('allows path-counted debt and detects aliased imports', () => {
    const root = createFixtureRepo(
      {
        'src/example.ts': `
          import { readApiJson as readJson } from '@/lib/api/client-json';
          export const read = (response) => readJson(response, 'failed');
        `,
      },
      [{ path: 'src/example.ts', counts: { stringFallback: 1 } }],
    );

    expect(runCheck(root)).toContain('1 allowlisted schema-less calls across 1 files');
  });

  it('rejects new schema-less readers with source evidence', () => {
    const root = createFixtureRepo({
      'src/example.ts': `
        import { readApiJson } from '@/lib/api/client-json';
        export const read = (response) => readApiJson(response, 'failed');
      `,
    });

    expect(() => runCheck(root)).toThrow(/src\/example\.ts:3 stringFallback/);
  });

  it('rejects count increases inside an already allowlisted path', () => {
    const root = createFixtureRepo(
      {
        'src/example.ts': `
          import { readApiJson } from '@/lib/api/client-json';
          readApiJson(firstResponse, 'failed');
          readApiJson(secondResponse, 'failed');
        `,
      },
      [{ path: 'src/example.ts', counts: { stringFallback: 1 } }],
    );

    expect(() => runCheck(root)).toThrow(/stringFallback: expected 1, found 2/);
  });

  it('rejects object, missing, and dynamic options as distinct debt', () => {
    const root = createFixtureRepo({
      'src/example.ts': `
        import { readApiJson } from '@/lib/api/client-json';
        readApiJson(response, { fallbackMessage: 'failed' });
        readApiJson(response);
        readApiJson(response, options);
      `,
    });

    expect(() => runCheck(root)).toThrow(
      /missingOptions=1, objectWithoutSchema=1, dynamicOptions=1/,
    );
  });

  it('rejects stale allowlist counts after a reader gains a schema', () => {
    const root = createFixtureRepo(
      {
        'src/example.ts': `
          import { readApiJson } from '@/lib/api/client-json';
          readApiJson(response, { fallbackMessage: 'failed', schema });
        `,
      },
      [{ path: 'src/example.ts', counts: { stringFallback: 1 } }],
    );

    expect(() => runCheck(root)).toThrow(/expected stringFallback=1, found no schema-less calls/);
  });

  it('does not count test and spec fixtures as production debt', () => {
    const root = createFixtureRepo({
      'src/example.test.ts': `
        import { readApiJson } from '@/lib/api/client-json';
        readApiJson(response, 'test-only');
      `,
      'src/example.spec.tsx': `
        import { readApiJson } from '@/lib/api/client-json';
        readApiJson(response);
      `,
    });

    expect(runCheck(root)).toContain('0 allowlisted schema-less calls');
  });
});
