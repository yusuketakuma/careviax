import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-query-shape.mjs');

function createFixtureRepo(
  files: Record<string, string>,
  watchlist: unknown = {
    entries: [
      {
        path: 'src/server/services/example.ts',
        owner: 'PERF-DB-001',
        reason: 'Fixture critical read path.',
      },
    ],
  },
  allowlist: unknown = { entries: [] },
) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-query-shape-'));
  for (const dir of ['tools/scripts', 'src/server/services']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-query-shape.mjs'));
  writeFileSync(path.join(root, 'tools/query-shape-watchlist.json'), JSON.stringify(watchlist));
  writeFileSync(path.join(root, 'tools/query-shape-allowlist.json'), JSON.stringify(allowlist));
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-query-shape.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-query-shape', () => {
  it('allows bounded selected findMany calls with an id tie-breaker', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.patient.findMany({
          where: { org_id: orgId },
          select: { id: true, name: true },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          take: 20,
        });
      `,
    });

    expect(runCheck(root)).toContain('Query shape check passed');
  });

  it('rejects broad include on watched read paths', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.patient.findMany({
          where: { org_id: orgId },
          include: { cases: true },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: 20,
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/broad_include/);
  });

  it('rejects unbounded findMany calls', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.patient.findMany({
          where: { org_id: orgId },
          select: { id: true },
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/unbounded_find_many/);
  });

  it('allows id-in bounded fan-in reads without take', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.medicationStockSnapshot.findMany({
          where: { stock_item_id: { in: stockItemIds } },
          select: { stock_item_id: true, current_quantity: true },
        });
      `,
    });

    expect(runCheck(root)).toContain('Query shape check passed');
  });

  it('rejects bounded findMany calls without stable orderBy', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.careReport.findMany({
          where: { org_id: orgId },
          select: { id: true },
          orderBy: [{ created_at: 'desc' }],
          take: 20,
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_stable_order_by/);
  });

  it('rejects unstable transaction-client findMany calls', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await tx.deliveryRecord.findMany({
          where: { org_id: orgId, status: 'response_waiting' },
          select: { id: true, sent_at: true },
          orderBy: { sent_at: 'asc' },
          take: 5,
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_stable_order_by/);
  });

  it('rejects date-range-only findMany calls as unbounded', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.communicationEvent.findMany({
          where: {
            org_id: orgId,
            occurred_at: { gte: startAt, lt: endAt },
          },
          select: { id: true },
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/unbounded_find_many/);
  });

  it('does not treat nested relation take as a top-level findMany bound', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.visitSchedule.findMany({
          where: {
            org_id: orgId,
            vehicle_resource_id: vehicleId,
            scheduled_date: scheduledDate,
          },
          select: {
            case_: {
              select: {
                patient: {
                  select: {
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: { address: true },
                    },
                  },
                },
              },
            },
          },
          orderBy: [{ route_order: 'asc' }, { id: 'asc' }],
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/unbounded_find_many/);
  });

  it('rejects aggregate calls without where clauses', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.careReport.count({});
      `,
    });

    expect(() => runCheck(root)).toThrow(/aggregate_fanout/);
  });

  it('rejects repeated same-delegate aggregate fan-out', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await db.deliveryRecord.count({ where: { org_id: orgId, status: 'failed' } });
        await db.deliveryRecord.groupBy({ by: ['status'], where: { org_id: orgId }, _count: true });
      `,
    });

    expect(() => runCheck(root)).toThrow(/multiple deliveryRecord\.count\/groupBy/);
  });

  it('allows variable query args because the caller owns the constructed shape', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        const args = {
          where: { org_id: orgId },
          orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
          take: 20,
        };
        await db.patient.findMany(args);
      `,
    });

    expect(runCheck(root)).toContain('Query shape check passed');
  });

  it('supports allowlisted existing debt and fails stale entries', () => {
    const allowlist = {
      entries: [
        {
          path: 'src/server/services/example.ts',
          rule: 'unbounded_find_many',
          expectedCount: 1,
          owner: 'PERF-DB-001',
          debtId: 'QUERY-SHAPE-DEBT-001',
          reason: 'Existing read path is not yet bounded.',
          plannedAction: 'Add stable take/orderBy and remove this allowlist entry.',
        },
      ],
    };
    const root = createFixtureRepo(
      {
        'src/server/services/example.ts': `
          await db.patient.findMany({
            where: { org_id: orgId },
            select: { id: true },
          });
        `,
      },
      undefined,
      allowlist,
    );

    expect(runCheck(root)).toContain('0 new violations');

    const staleRoot = createFixtureRepo(
      {
        'src/server/services/example.ts': `
          await db.patient.findMany({
            where: { org_id: orgId },
            select: { id: true },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: 20,
          });
        `,
      },
      undefined,
      allowlist,
    );

    expect(() => runCheck(staleRoot)).toThrow(/expected 1, found 0/);
  });
});
