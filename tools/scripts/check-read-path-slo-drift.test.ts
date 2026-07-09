import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-read-path-slo.mjs');

type RouteSources = Record<string, string>;

interface FixtureOptions {
  slo: unknown;
  routes?: RouteSources;
  payloadBudgetsSource?: string;
}

function routeToRouteFile(route: string) {
  const withParams = route.replace(/:([A-Za-z_$][\w$]*)/g, '[$1]');
  const withoutApiPrefix = withParams.replace(/^\/api(?=\/|$)/, '');
  return path.posix.join('src/app/api', `.${withoutApiPrefix}`, 'route.ts');
}

function createFixtureRepo({ slo, routes = {}, payloadBudgetsSource }: FixtureOptions) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-read-slo-drift-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(path.join(root, 'src/lib/utils'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-read-path-slo.mjs'));
  writeFileSync(path.join(root, 'tools/read-path-slo.json'), JSON.stringify(slo, null, 2));
  writeFileSync(
    path.join(root, 'src/lib/utils/route-payload-budgets.ts'),
    payloadBudgetsSource ?? payloadBudgetsFixture(slo),
  );
  for (const [route, source] of Object.entries(routes)) {
    const relative = routeToRouteFile(route);
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, source);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-read-path-slo.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Derive a payload-budget registry from the SLO entries so the registry phase
// (which runs before drift) passes and we can exercise the drift phase.
function payloadBudgetsFixture(slo: unknown) {
  const entries = (slo as { entries: Array<Record<string, unknown>> }).entries ?? [];
  const blocks = entries
    .map(
      (entry) => `      {
        method: '${entry.method}',
        route: '${entry.route}',
        family: '${entry.family}',
        budget_bytes: ${entry.payload_budget_bytes},
      },`,
    )
    .join('\n');
  return `    export const CRITICAL_ROUTE_PAYLOAD_BUDGETS = [\n${blocks}\n    ];\n`;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    family: 'patients-board',
    method: 'GET',
    route: '/api/patients/board',
    p95_target_ms: 250,
    p99_target_ms: 800,
    payload_budget_bytes: 40960,
    max_rows: 80,
    max_include_depth: 1,
    max_query_count: 8,
    count_basis: 'database_total',
    expected_indexes: ['patients scoped by org_id and name_kana'],
    owner: 'PERF-DB-READ-SLO-001',
    notes: 'Fixture patients board read SLO.',
    ...overrides,
  };
}

const boundedBoardSource = `
  export async function GET() {
    const patients = await prisma.patient.findMany({
      where: { org_id: orgId },
      orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
      take: 80,
      select: { id: true },
    });
    return Response.json(patients);
  }
`;

const unboundedBoardSource = `
  export async function GET() {
    const patients = await prisma.patient.findMany({
      where: { org_id: orgId },
      orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return Response.json(patients);
  }
`;

describe('check-read-path-slo drift', () => {
  it('passes when every inline list query is bounded within its declared max_rows', () => {
    const root = createFixtureRepo({
      slo: { entries: [entry()] },
      routes: { '/api/patients/board': boundedBoardSource },
    });

    const output = runCheck(root);
    expect(output).toContain('Read path SLO drift check passed');
    expect(output).toContain('0 new drift');
  });

  it('fails on a new unbounded list query with no take/cursor/id-in bound', () => {
    const root = createFixtureRepo({
      slo: { entries: [entry()] },
      routes: { '/api/patients/board': unboundedBoardSource },
    });

    expect(() => runCheck(root)).toThrow(/slo_take_missing/);
  });

  it('keeps the gate green when the unbounded query is a registered known_take_drift', () => {
    const root = createFixtureRepo({
      slo: {
        entries: [entry()],
        known_take_drift: [
          {
            route: '/api/patients/board',
            method: 'GET',
            model: 'patient',
            rule: 'slo_take_missing',
            expectedCount: 1,
            owner: 'PERF-DB-SLO-TAKE-LINT-001',
            reason: 'Bounded by org-scoped RLS + app pagination, not a query take.',
          },
        ],
      },
      routes: { '/api/patients/board': unboundedBoardSource },
    });

    const output = runCheck(root);
    expect(output).toContain('Read path SLO drift check passed');
    expect(output).toContain('1 known take-drift');
  });

  it('fails on a numeric take that exceeds the declared max_rows', () => {
    const overTakeSource = `
      export async function GET() {
        const patients = await prisma.patient.findMany({
          where: { org_id: orgId },
          orderBy: [{ id: 'asc' }],
          take: 500,
          select: { id: true },
        });
        return Response.json(patients);
      }
    `;
    const root = createFixtureRepo({
      slo: { entries: [entry()] },
      routes: { '/api/patients/board': overTakeSource },
    });

    expect(() => runCheck(root)).toThrow(/slo_take_exceeds_max_rows/);
  });

  it('resolves a same-file constant take when comparing against max_rows', () => {
    const constTakeSource = `
      const BOARD_TAKE = 500;
      export async function GET() {
        const patients = await prisma.patient.findMany({
          where: { org_id: orgId },
          orderBy: [{ id: 'asc' }],
          take: BOARD_TAKE,
          select: { id: true },
        });
        return Response.json(patients);
      }
    `;
    const root = createFixtureRepo({
      slo: { entries: [entry()] },
      routes: { '/api/patients/board': constTakeSource },
    });

    expect(() => runCheck(root)).toThrow(/slo_take_exceeds_max_rows/);
  });

  it('accepts a list query bounded by an id-in where clause without a take', () => {
    const idInSource = `
      export async function GET() {
        const patients = await prisma.patient.findMany({
          where: { org_id: orgId, id: { in: ids } },
          select: { id: true },
        });
        return Response.json(patients);
      }
    `;
    const root = createFixtureRepo({
      slo: { entries: [entry()] },
      routes: { '/api/patients/board': idInSource },
    });

    expect(runCheck(root)).toContain('Read path SLO drift check passed');
  });

  it('ignores routes whose query is delegated to a service (no inline handler match)', () => {
    // No route file is written for the entry, so the drift phase has nothing to
    // analyze and must not fail.
    const root = createFixtureRepo({ slo: { entries: [entry()] } });

    expect(runCheck(root)).toContain('Read path SLO drift check passed');
  });

  it('fails when a known_take_drift entry is stale (occurrence count changed)', () => {
    const root = createFixtureRepo({
      slo: {
        entries: [entry()],
        known_take_drift: [
          {
            route: '/api/patients/board',
            method: 'GET',
            model: 'patient',
            rule: 'slo_take_missing',
            expectedCount: 2,
            owner: 'PERF-DB-SLO-TAKE-LINT-001',
            reason: 'Stale: only one occurrence remains in source.',
          },
        ],
      },
      routes: { '/api/patients/board': unboundedBoardSource },
    });

    expect(() => runCheck(root)).toThrow(/Stale known_take_drift/);
  });

  it('rejects a known_take_drift entry missing required fields', () => {
    const root = createFixtureRepo({
      slo: {
        entries: [entry()],
        known_take_drift: [
          {
            route: '/api/patients/board',
            method: 'GET',
            model: 'patient',
            rule: 'slo_take_missing',
            // expectedCount, owner, reason intentionally omitted
          },
        ],
      },
      routes: { '/api/patients/board': unboundedBoardSource },
    });

    expect(() => runCheck(root)).toThrow(/known_take_drift\[0\]\.expectedCount is required/);
  });
});
