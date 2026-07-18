import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools/scripts/migration-verify-template.ts');
const MUTATION_DISABLED_MESSAGE =
  'Mutation and rollback are disabled for this historical template; use --dry-run for read-only pre-checks.';

function run(args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '' },
  });
}

describe('migration-verify-template mutation boundary', () => {
  it('rejects implicit backfill before opening a database connection', () => {
    const result = run(['--phase', 'p03-lab-values']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(MUTATION_DISABLED_MESSAGE);
    expect(result.stderr).not.toContain('DATABASE_URL is required');
  });

  it('rejects rollback even when dry-run is also present', () => {
    const result = run(['--phase', 'p03-lab-values', '--dry-run', '--rollback']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(MUTATION_DISABLED_MESSAGE);
    expect(result.stderr).not.toContain('DATABASE_URL is required');
  });
});
