import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-read-path-slo.mjs');

function createFixtureRepo(slo: unknown, payloadBudgetsSource = payloadBudgetsFixture()) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-read-slo-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(path.join(root, 'src/lib/utils'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-read-path-slo.mjs'));
  writeFileSync(path.join(root, 'tools/read-path-slo.json'), JSON.stringify(slo, null, 2));
  writeFileSync(path.join(root, 'src/lib/utils/route-payload-budgets.ts'), payloadBudgetsSource);
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-read-path-slo.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function payloadBudgetsFixture() {
  return `
    const KIB = 1024;
    export const CRITICAL_ROUTE_PAYLOAD_BUDGETS = [
      {
        method: 'GET',
        route: '/api/foo',
        family: 'foo',
        budget_bytes: 10 * KIB,
      },
      {
        method: 'GET',
        route: '/api/bar',
        family: 'bar',
        budget_bytes: 2048,
      },
      {
        method: '*',
        route: '/api/tasks',
        family: 'tasks',
        budget_bytes: null,
      },
    ];
  `;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    family: 'foo',
    method: 'GET',
    route: '/api/foo',
    p95_target_ms: 250,
    p99_target_ms: 800,
    payload_budget_bytes: 10 * 1024,
    max_rows: 50,
    max_include_depth: 1,
    max_query_count: 8,
    count_basis: 'database_total',
    expected_indexes: ['foo scoped by org_id and created_at'],
    owner: 'PERF-DB-READ-SLO-001',
    notes: 'Fixture read SLO.',
    ...overrides,
  };
}

describe('check-read-path-slo', () => {
  it('passes when every configured GET payload budget family has a matching SLO entry', () => {
    const root = createFixtureRepo({
      entries: [
        entry(),
        entry({
          family: 'bar',
          route: '/api/bar',
          payload_budget_bytes: 2048,
          expected_indexes: ['bar scoped by org_id'],
        }),
      ],
    });

    expect(runCheck(root)).toContain('Read path SLO check passed');
  });

  it('rejects missing SLO entries for configured GET payload budget families', () => {
    const root = createFixtureRepo({ entries: [entry()] });

    expect(() => runCheck(root)).toThrow(/all configured GET payload budget families/);
  });

  it('rejects payload budget drift between SLO and route payload budget registry', () => {
    const root = createFixtureRepo({
      entries: [
        entry({ payload_budget_bytes: 1234 }),
        entry({
          family: 'bar',
          route: '/api/bar',
          payload_budget_bytes: 2048,
          expected_indexes: ['bar scoped by org_id'],
        }),
      ],
    });

    expect(() => runCheck(root)).toThrow(/payload_budget_bytes does not match/);
  });

  it('rejects unsafe routes with query strings or external path forms', () => {
    const root = createFixtureRepo({
      entries: [
        entry({ route: '/api/foo?debug=1' }),
        entry({
          family: 'bar',
          route: '/api/bar',
          payload_budget_bytes: 2048,
          expected_indexes: ['bar scoped by org_id'],
        }),
      ],
    });

    expect(() => runCheck(root)).toThrow(/app-relative pathname/);
  });

  it('rejects entries without expected index guidance', () => {
    const root = createFixtureRepo({
      entries: [
        entry({ expected_indexes: [] }),
        entry({
          family: 'bar',
          route: '/api/bar',
          payload_budget_bytes: 2048,
          expected_indexes: ['bar scoped by org_id'],
        }),
      ],
    });

    expect(() => runCheck(root)).toThrow(/expected_indexes/);
  });

  it('rejects p99 targets lower than p95 targets', () => {
    const root = createFixtureRepo({
      entries: [
        entry({ p95_target_ms: 800, p99_target_ms: 250 }),
        entry({
          family: 'bar',
          route: '/api/bar',
          payload_budget_bytes: 2048,
          expected_indexes: ['bar scoped by org_id'],
        }),
      ],
    });

    expect(() => runCheck(root)).toThrow(/p99_target_ms/);
  });
});
