import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-client-phi-log.mjs');

function createFixtureRepo(files: Record<string, string>, allowlist: unknown = { entries: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-client-phi-log-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-client-phi-log.mjs'));
  writeFileSync(path.join(root, 'tools/client-phi-log-allowlist.json'), JSON.stringify(allowlist));
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-client-phi-log.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-client-phi-log', () => {
  it('passes when console gets only coded messages / helper calls', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `
        clientLog.warn('feature.load_failed', error);
        console.warn('[offline] sync failed', safeSyncErrorMessage(error));
        console.error('coded reason only');
      `,
    });
    expect(runCheck(root)).toContain('Client PHI-log check passed');
  });

  it('rejects a bare error object passed to console.warn', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.warn('[x] failed', error);`,
    });
    expect(() => runCheck(root)).toThrow(/console\.warn\('\[x\] failed', error\)/);
  });

  it('rejects a bare error object passed as the only console argument', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.warn(error);`,
    });
    expect(() => runCheck(root)).toThrow(/console\.warn\(error\)/);
  });

  it('rejects a bare error object in a multiline console call', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `
        console.error(
          '[x]',
          error
        );
      `,
    });
    expect(() => runCheck(root)).toThrow(/console\.error\( '\[x\]', error \)/);
  });

  it('rejects raw error.message passed to console', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.error('[x]', error.message);`,
    });
    expect(() => runCheck(root)).toThrow(/error\.message/);
  });

  it('rejects String(error) passed to console', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.error('[x]', String(error));`,
    });
    expect(() => runCheck(root)).toThrow(/String\(error\)/);
  });

  it('rejects error interpolation in a template literal passed to console', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': 'console.error(`[x] ${error}`);',
    });
    expect(() => runCheck(root)).toThrow(/\$\{error\}/);
  });

  it('rejects a type-asserted bare error object passed to console', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.error('[x]', error as Error);`,
    });
    expect(() => runCheck(root)).toThrow(/error as Error/);
  });

  it('rejects a bare err passed to console.error', () => {
    const root = createFixtureRepo({
      'src/features/a.ts': `console.error('[x]', err);`,
    });
    expect(() => runCheck(root)).toThrow(/not listed in allowlist/);
  });

  it('rejects a bare error followed by another argument', () => {
    const root = createFixtureRepo({
      'src/features/a.tsx': `console.error('[x]', error, info.componentStack);`,
    });
    expect(() => runCheck(root)).toThrow(/componentStack/);
  });

  it('rejects a raw .stack passed to console', () => {
    const root = createFixtureRepo({
      'src/features/a.ts': `console.error('[x]', someError.stack);`,
    });
    expect(() => runCheck(root)).toThrow(/\.stack/);
  });

  it('does not flag error identifiers nested inside a helper call', () => {
    const root = createFixtureRepo({
      'src/features/a.ts': `console.warn('[x]', messageFromError(error, 'fallback'));`,
    });
    expect(runCheck(root)).toContain('Client PHI-log check passed');
  });

  it('does not flag coded strings containing error words', () => {
    const root = createFixtureRepo({
      'src/features/a.ts': `console.warn('error: retry failed');`,
    });
    expect(runCheck(root)).toContain('Client PHI-log check passed');
  });

  it('ignores test files', () => {
    const root = createFixtureRepo({
      'src/features/a.test.ts': `console.error('[x]', error);`,
    });
    expect(runCheck(root)).toContain('Client PHI-log check passed');
  });

  it('allows a known occurrence through the allowlist and fails a stale entry', () => {
    const root = createFixtureRepo(
      {
        'src/server/services/backup-monitor.ts': `console.error(message, err);`,
      },
      {
        entries: [
          {
            path: 'src/server/services/backup-monitor.ts',
            needle: 'console.error(message, err)',
            reason: 'server-side CloudWatch log, out of client scope',
            expectedCount: 1,
          },
          {
            path: 'src/server/services/gone.ts',
            needle: 'console.error(message, err)',
            reason: 'removed occurrence',
            expectedCount: 1,
          },
        ],
      },
    );
    expect(() => runCheck(root)).toThrow(/Stale allowlist entries/);
  });

  it('passes when the allowlist matches the sole occurrence exactly', () => {
    const root = createFixtureRepo(
      {
        'src/server/services/backup-monitor.ts': `console.error(message, err);`,
      },
      {
        entries: [
          {
            path: 'src/server/services/backup-monitor.ts',
            needle: 'console.error(message, err)',
            reason: 'server-side CloudWatch log, out of client scope',
            expectedCount: 1,
          },
        ],
      },
    );
    expect(runCheck(root)).toContain('Client PHI-log check passed');
  });
});
