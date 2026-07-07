import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-route-auth-wrapper.mjs');

function createFixtureRepo(files: Record<string, string>, allowlistEntries: unknown[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-route-auth-wrapper-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(path.join(root, 'tools'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-route-auth-wrapper.mjs'));
  writeFileSync(
    path.join(root, 'tools/route-auth-wrapper-allowlist.json'),
    JSON.stringify({ entries: allowlistEntries }, null, 2),
  );
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-route-auth-wrapper.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function allowEntry(overrides: Record<string, unknown> = {}) {
  return {
    path: 'src/app/api/patients/route.ts',
    expectedCount: 1,
    permissions: ['canVisit'],
    sensitiveNoStore: true,
    routePerformance: false,
    owner: 'platform-routing',
    debtId: 'CORE-ROUTE-001',
    reason: 'Existing direct auth route.',
    plannedAction: 'Migrate to withAuthContext.',
    ...overrides,
  };
}

describe('check-route-auth-wrapper', () => {
  it('accepts allowlisted direct requireAuthContext route metadata', () => {
    const root = createFixtureRepo(
      {
        'src/app/api/patients/route.ts': `
          import { requireAuthContext } from '@/lib/auth/context';
          import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
          export async function GET(req) {
            const auth = await requireAuthContext(req, { permission: 'canVisit' });
            return withSensitiveNoStore(auth.response ?? Response.json({ ok: true }));
          }
        `,
      },
      [allowEntry()],
    );

    expect(runCheck(root)).toContain('Route auth wrapper check passed');
  });

  it('rejects new direct requireAuthContext routes that are not allowlisted', () => {
    const root = createFixtureRepo(
      {
        'src/app/api/patients/route.ts': `
          export async function GET(req) {
            return requireAuthContext(req, { permission: 'canVisit' });
          }
        `,
      },
      [],
    );

    expect(() => runCheck(root)).toThrow(/New direct requireAuthContext routes/);
  });

  it('rejects stale allowlist entries after migration to withAuthContext', () => {
    const root = createFixtureRepo(
      {
        'src/app/api/patients/route.ts': `
          import { withAuthContext } from '@/lib/auth/context';
          export const GET = withAuthContext(async () => Response.json({ ok: true }));
        `,
      },
      [allowEntry()],
    );

    expect(() => runCheck(root)).toThrow(/no direct requireAuthContext usage remains/);
  });

  it('rejects permission, no-store, or performance metadata drift', () => {
    const root = createFixtureRepo(
      {
        'src/app/api/patients/route.ts': `
          import { requireAuthContext } from '@/lib/auth/context';
          export async function GET(req) {
            const auth = await requireAuthContext(req, { permission: 'canAdmin' });
            return auth.response ?? Response.json({ ok: true });
          }
        `,
      },
      [allowEntry()],
    );

    expect(() => runCheck(root)).toThrow(/metadata drift/);
  });
});
