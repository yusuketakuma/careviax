import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  classifyExternalAccessCaseBoundaryBlocker,
  type LegacyGrantRow,
  type PgClientLike,
  parseExternalAccessCaseBoundaryArgs,
  runExternalAccessCaseBoundaryAudit,
} from './external-access-case-boundary-audit';

type QueryCall = { sql: string; values?: unknown[] };

function makeClient(rows: LegacyGrantRow[]): PgClientLike & { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes('FROM "ExternalAccessGrant"')) {
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      return {
        rows: [],
        rowCount: sql.includes('UPDATE "ExternalAccessGrant"') ? 1 : null,
      };
    },
  };
}

function legacyGrant(overrides: Partial<LegacyGrantRow> = {}): LegacyGrantRow {
  return {
    id: 'grant_1',
    org_id: 'org_1',
    patient_id: 'patient_1',
    active_case_ids: ['case_1'],
    active_case_count: '1',
    has_supported_case_scope: true,
    has_self_report_history: false,
    ...overrides,
  };
}

describe('external-access-case-boundary-audit', () => {
  it('defaults to dry-run and requires max rows for apply mode', () => {
    expect(parseExternalAccessCaseBoundaryArgs([])).toEqual({
      mode: 'dry-run',
      maxRows: null,
    });
    expect(parseExternalAccessCaseBoundaryArgs(['--dry-run'])).toEqual({
      mode: 'dry-run',
      maxRows: null,
    });
    expect(parseExternalAccessCaseBoundaryArgs(['--apply', '--max-rows', '5'])).toEqual({
      mode: 'apply',
      maxRows: 5,
    });
    expect(() => parseExternalAccessCaseBoundaryArgs(['--apply'])).toThrow(/--max-rows/);
    expect(() => parseExternalAccessCaseBoundaryArgs(['--apply', '--dry-run'])).toThrow(
      /either --apply or --dry-run/,
    );
    expect(() => parseExternalAccessCaseBoundaryArgs(['--apply', '--max-rows', '0'])).toThrow(
      /positive integer/,
    );
  });

  it('classifies grants that cannot be safely case-bound automatically', () => {
    expect(
      classifyExternalAccessCaseBoundaryBlocker(
        legacyGrant({ active_case_ids: [], active_case_count: '0' }),
      ),
    ).toMatchObject({ reason: 'no_active_case' });
    expect(
      classifyExternalAccessCaseBoundaryBlocker(
        legacyGrant({ active_case_ids: ['case_1', 'case_2'], active_case_count: '2' }),
      ),
    ).toMatchObject({ reason: 'multiple_active_cases' });
    expect(
      classifyExternalAccessCaseBoundaryBlocker(
        legacyGrant({
          active_case_ids: ['case_1'],
          active_case_count: '1',
          has_supported_case_scope: false,
          has_self_report_history: true,
        }),
      ),
    ).toMatchObject({ reason: 'unsupported_self_report_history_only' });
    expect(classifyExternalAccessCaseBoundaryBlocker(legacyGrant())).toBeNull();
  });

  it('reports dry-run work without issuing updates', async () => {
    const client = makeClient([legacyGrant()]);

    await expect(
      runExternalAccessCaseBoundaryAudit(client, { mode: 'dry-run', maxRows: null }),
    ).resolves.toMatchObject({
      ok: false,
      mode: 'dry-run',
      legacy_case_backed_grants: 1,
      backfillable_grants: 1,
      updated_grants: [],
      blockers: [],
    });

    expect(client.calls.some((call) => call.sql.includes('UPDATE "ExternalAccessGrant"'))).toBe(
      false,
    );
  });

  it('aborts apply when blockers remain', async () => {
    const client = makeClient([legacyGrant({ active_case_ids: [], active_case_count: '0' })]);

    await expect(
      runExternalAccessCaseBoundaryAudit(client, { mode: 'apply', maxRows: 10 }),
    ).resolves.toMatchObject({
      ok: false,
      mode: 'apply',
      updated_grants: [],
      blockers: [expect.objectContaining({ reason: 'no_active_case' })],
    });

    expect(client.calls.some((call) => call.sql.includes('UPDATE "ExternalAccessGrant"'))).toBe(
      false,
    );
  });

  it('aborts apply when the explicit max row bound is too low', async () => {
    const client = makeClient([legacyGrant({ id: 'grant_1' }), legacyGrant({ id: 'grant_2' })]);

    await expect(
      runExternalAccessCaseBoundaryAudit(client, { mode: 'apply', maxRows: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      mode: 'apply',
      legacy_case_backed_grants: 2,
      backfillable_grants: 2,
      updated_grants: [],
    });

    expect(client.calls.some((call) => call.sql.includes('UPDATE "ExternalAccessGrant"'))).toBe(
      false,
    );
  });

  it('applies bounded single-case backfill in one transaction', async () => {
    const client = makeClient([legacyGrant()]);

    await expect(
      runExternalAccessCaseBoundaryAudit(client, { mode: 'apply', maxRows: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      mode: 'apply',
      updated_grants: ['grant_1'],
      blockers: [],
    });

    expect(client.calls.map((call) => call.sql.trim().split(/\s+/)[0])).toEqual([
      'SELECT',
      'BEGIN',
      'UPDATE',
      'COMMIT',
    ]);
    const updateCall = client.calls.find((call) =>
      call.sql.includes('UPDATE "ExternalAccessGrant"'),
    );
    expect(updateCall?.values).toEqual(['grant_1', JSON.stringify(['case_1'])]);
  });
});
