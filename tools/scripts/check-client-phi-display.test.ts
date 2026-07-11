import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-client-phi-display.mjs');

function createFixtureRepo(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-client-phi-display-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-client-phi-display.mjs'));
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-client-phi-display.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-client-phi-display', () => {
  it('passes reviewed fixed recovery copy', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `
        export function Example({ error }: { error: Error }) {
          return <ErrorState detail={messageFromError(error, '再試行してください')} />;
        }
      `,
    });

    expect(runCheck(root)).toContain('Client PHI-display check passed');
  });

  it('rejects Error.message passed to a visible error prop', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `
        export function Example({ error }: { error: Error }) {
          return <ErrorState errorMessage={error.message} />;
        }
      `,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-prop/);
  });

  it('rejects a named query error passed to a visible error prop', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `
        export function Example({ drugMasterError }) {
          return <DataTable errorMessage={drugMasterError.message} />;
        }
      `,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-prop/);
  });

  it('rejects optional Error.message passed to a toast', () => {
    const root = createFixtureRepo({
      'src/app/example.tsx': `toast.error(error?.message ?? '失敗しました');`,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-toast/);
  });

  it('rejects raw detail outside a reviewed messageFromError call', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `
        toast.error(messageFromError(error, '失敗しました') + ': ' + error.message);
      `,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-toast/);
  });

  it('rejects Error.message used as the messageFromError fallback', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `toast.error(messageFromError(error, error.message));`,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-toast/);
  });

  it('rejects Error.message rendered directly in JSX', () => {
    const root = createFixtureRepo({
      'src/components/example.tsx': `export const Example = ({ err }) => <p>{err.message}</p>;`,
    });

    expect(() => runCheck(root)).toThrow(/visible-error-jsx/);
  });

  it('ignores test files', () => {
    const root = createFixtureRepo({
      'src/components/example.test.tsx': `toast.error(error.message);`,
    });

    expect(runCheck(root)).toContain('Client PHI-display check passed');
  });
});
