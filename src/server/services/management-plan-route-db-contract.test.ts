import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createSessionToken, LOCAL_USER } from '../../../tools/tests/helpers/local-auth';
import { parseLocalE2eDatabaseTarget } from '../../../tools/scripts/prepare-e2e-db-core';
import { advisoryLockKeyPair } from '../../lib/db/advisory-lock';

const databaseUrl = process.env.MANAGEMENT_PLAN_ROUTE_DATABASE_URL;
const baseUrl = process.env.MANAGEMENT_PLAN_ROUTE_BASE_URL;
const hasCompleteEnvironment = Boolean(databaseUrl && baseUrl);
const isSafeLocalBaseUrl =
  !baseUrl || /^http:\/\/(?:localhost|127\.0\.0\.1):(?:3000|3012)$/.test(baseUrl);

if (databaseUrl) {
  parseLocalE2eDatabaseTarget(databaseUrl, 'MANAGEMENT_PLAN_ROUTE_DATABASE_URL');
}

if (!isSafeLocalBaseUrl) {
  throw new Error(
    'Management plan route DB contract requires local ph_os_e2e on port 5433 and a local app on port 3000 or 3012',
  );
}

const describeDatabase = hasCompleteEnvironment ? describe : describe.skip;
const pool = hasCompleteEnvironment ? new Pool({ connectionString: databaseUrl }) : null;

afterAll(async () => {
  await pool?.end();
});

type ManagementPlanResponse = {
  code?: string;
  data?: {
    id: string;
    version: number;
    status: string;
    title: string;
    updated_at: string;
  };
};

async function requestJson(path: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: path === '/api/management-plans' ? 'POST' : 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: `next-auth.session-token=${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as ManagementPlanResponse };
}

describeDatabase('management plan route live DB concurrency contract', () => {
  it('resolves same-case contention and rejects a replayed update without a losing audit', async () => {
    const client = await pool!.connect();
    let planId: string | null = null;
    const suffix = randomUUID().replaceAll('-', '');
    const syntheticTitle = `Synthetic concurrency contract ${suffix}`;
    try {
      const scope = await client.query<{ org_id: string; case_id: string; latest_version: number }>(
        `SELECT c."org_id", c."id" AS case_id, COALESCE(MAX(mp."version"), 0)::int AS latest_version
         FROM "User" u
         JOIN "CareCase" c ON c."org_id" = u."org_id"
         LEFT JOIN "ManagementPlan" mp ON mp."case_id" = c."id"
         WHERE u."email" = $1
         GROUP BY c."org_id", c."id", c."created_at"
         ORDER BY c."created_at"
         LIMIT 1`,
        [LOCAL_USER.email],
      );
      const target = scope.rows[0];
      expect(target).toBeDefined();

      const token = await createSessionToken();
      const createBody = {
        case_id: target!.case_id,
        title: syntheticTitle,
        summary: 'Synthetic non-clinical test data',
        content: { goals: ['Synthetic goal'] },
        expected_latest_version: target!.latest_version,
      };

      const [lockHi, lockLo] = advisoryLockKeyPair(
        'management-plan-case',
        `${target!.org_id}:${target!.case_id}`,
      );
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::int4, $2::int4)', [lockHi, lockLo]);
      const contentionStartedAt = performance.now();
      const contendedCreate = await requestJson('/api/management-plans', token, createBody);
      const contentionElapsedMs = performance.now() - contentionStartedAt;
      expect(contendedCreate.status).toBe(409);
      expect(contendedCreate.payload.code).toBe('WORKFLOW_CONFLICT');
      expect(contentionElapsedMs).toBeLessThan(2_000);
      await client.query('ROLLBACK');

      const creates = await Promise.all([
        requestJson('/api/management-plans', token, createBody),
        requestJson('/api/management-plans', token, createBody),
      ]);
      const created = creates.find(({ status }) => status === 201)?.payload.data;
      planId = created?.id ?? null;
      expect(creates.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(creates.find(({ status }) => status === 409)?.payload.code).toBe('WORKFLOW_CONFLICT');

      expect(created).toMatchObject({
        version: target!.latest_version + 1,
        status: 'draft',
      });

      const updateTitles = [
        `Synthetic update A ${suffix}`,
        `Synthetic update B ${suffix}`,
      ] as const;
      const updates = await Promise.all(
        updateTitles.map((title) =>
          requestJson(`/api/management-plans/${encodeURIComponent(planId!)}`, token, {
            action: 'update',
            title,
            expected_updated_at: created!.updated_at,
          }),
        ),
      );
      expect(updates.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(updates.find(({ status }) => status === 409)?.payload.code).toBe('WORKFLOW_CONFLICT');
      const updated = updates.find(({ status }) => status === 200)?.payload.data;
      expect(Date.parse(updated!.updated_at)).toBeGreaterThan(Date.parse(created!.updated_at));

      const updateReplay = await requestJson(
        `/api/management-plans/${encodeURIComponent(planId!)}`,
        token,
        {
          action: 'update',
          title: `Synthetic replay ${suffix}`,
          expected_updated_at: created!.updated_at,
        },
      );
      expect(updateReplay.status).toBe(409);
      expect(updateReplay.payload.code).toBe('WORKFLOW_CONFLICT');

      const archives = await Promise.all([
        requestJson(`/api/management-plans/${encodeURIComponent(planId!)}`, token, {
          action: 'archive',
          expected_updated_at: updated!.updated_at,
        }),
        requestJson(`/api/management-plans/${encodeURIComponent(planId!)}`, token, {
          action: 'archive',
          expected_updated_at: updated!.updated_at,
        }),
      ]);
      expect(archives.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(archives.find(({ status }) => status === 409)?.payload.code).toBe('WORKFLOW_CONFLICT');
      const archived = archives.find(({ status }) => status === 200)?.payload.data;
      expect(archived?.status).toBe('archived');
      expect(Date.parse(archived!.updated_at)).toBeGreaterThan(Date.parse(updated!.updated_at));

      const archiveReplay = await requestJson(
        `/api/management-plans/${encodeURIComponent(planId!)}`,
        token,
        {
          action: 'archive',
          expected_updated_at: updated!.updated_at,
        },
      );
      expect(archiveReplay.status).toBe(409);
      expect(archiveReplay.payload.code).toBe('WORKFLOW_CONFLICT');

      const persisted = await client.query<{
        title: string;
        version: number;
        status: string;
      }>(`SELECT "title", "version", "status" FROM "ManagementPlan" WHERE "id" = $1`, [planId]);
      expect(persisted.rows).toHaveLength(1);
      expect(updateTitles).toContain(persisted.rows[0]!.title);
      expect(persisted.rows[0]!.version).toBe(target!.latest_version + 1);
      expect(persisted.rows[0]!.status).toBe('archived');

      const audits = await client.query<{ action: string; count: number }>(
        `SELECT "action", COUNT(*)::int AS count
         FROM "AuditLog"
         WHERE "target_type" = 'management_plan' AND "target_id" = $1
         GROUP BY "action"
         ORDER BY "action"`,
        [planId],
      );
      expect(audits.rows).toEqual([
        { action: 'management_plan.archive', count: 1 },
        { action: 'management_plan.create', count: 1 },
        { action: 'management_plan.update', count: 1 },
      ]);
    } finally {
      try {
        const cleanupIds = new Set<string>(planId ? [planId] : []);
        const fallbackRows = await client.query<{ id: string }>(
          `SELECT "id" FROM "ManagementPlan" WHERE "title" = $1`,
          [syntheticTitle],
        );
        for (const row of fallbackRows.rows) cleanupIds.add(row.id);
        for (const cleanupId of cleanupIds) {
          await client.query(`DELETE FROM "ManagementPlan" WHERE "id" = $1`, [cleanupId]);
          await client.query(
            `DELETE FROM "AuditLog" WHERE "target_type" = 'management_plan' AND "target_id" = $1`,
            [cleanupId],
          );
        }
      } finally {
        client.release();
      }
    }
  }, 30_000);
});
