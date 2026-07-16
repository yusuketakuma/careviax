import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import {
  ClinicalFhirResourceType,
  ClinicalFhirValidationStatus,
  ClinicalLocalResourceType,
  ClinicalQueueStatus,
} from '@prisma/client';
import { drainYreseClinicalSyncQueue } from './standard-clinical-sync-queue';

const databaseUrl = process.env.CLINICAL_SYNC_QUEUE_DATABASE_URL;
const isSafeLocalDatabase =
  !databaseUrl ||
  /^postgresql:\/\/[^@/]+@(?:localhost|127\.0\.0\.1|\[::1\]):5433\/ph_os_e2e(?:\?|$)/u.test(
    databaseUrl,
  );

if (!isSafeLocalDatabase) {
  throw new Error('CLINICAL_SYNC_QUEUE_DATABASE_URL must point to local ph_os_e2e on port 5433');
}

const describeDatabase = databaseUrl ? describe : describe.skip;
const now = new Date('2026-07-09T00:00:00.000Z');
const schema = `clinical_sync_tx_${randomUUID().replaceAll('-', '_')}`;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const qualifiedQueue = `${quoteIdentifier(schema)}."queue_item"`;

type QueueRow = {
  id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  cache_id: string;
};

function queueRecord(row: QueueRow) {
  return {
    id: row.id,
    org_id: 'org_1',
    status: row.status as ClinicalQueueStatus,
    operation: 'yrese.dispensing.confirmed.process',
    aggregate_type: ClinicalLocalResourceType.none,
    aggregate_id: null,
    fhir_resource_cache_id: row.cache_id,
    external_reference_id: `external_${row.id}`,
    yrese_event_id: `event_${row.id}`,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
  };
}

function cacheRecord(id: string) {
  return {
    id,
    org_id: 'org_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    resource_type: ClinicalFhirResourceType.medication_request,
    resource_id: `resource_${id}`,
    version_id: 'v1',
    external_reference_id: `external_${id}`,
    normalized_summary: { status: 'active' },
    content_hash: `sha256:${'a'.repeat(64)}`,
    validation_status: ClinicalFhirValidationStatus.valid,
  };
}

function transactionAdapter(client: PoolClient) {
  return {
    clinicalSyncQueueItem: {
      findMany: async () => {
        const rows = await client.query<QueueRow>(
          `SELECT id, status, attempt_count, max_attempts, cache_id
             FROM ${qualifiedQueue}
            WHERE status IN ('pending', 'failed') AND next_attempt_at <= $1
            ORDER BY id`,
          [now],
        );
        return rows.rows.map(queueRecord);
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const status = String(args.data.status);
        const id = String(args.where.id);
        const expectedStatus = String(args.where.status);
        const expectedAttempt = Number(args.where.attempt_count);
        const nextAttempt =
          typeof args.data.attempt_count === 'number' ? args.data.attempt_count : expectedAttempt;
        const result = await client.query(
          `UPDATE ${qualifiedQueue}
              SET status = $1::text,
                  attempt_count = $2::integer,
                  locked_by = $3::text,
                  completed_at = CASE
                    WHEN $1::text IN ('succeeded', 'dead_letter') THEN $4::timestamptz
                    ELSE NULL
                  END
            WHERE id = $5::text AND status = $6::text AND attempt_count = $7::integer`,
          [
            status,
            nextAttempt,
            args.data.locked_by ?? null,
            now,
            id,
            expectedStatus,
            expectedAttempt,
          ],
        );
        return { count: result.rowCount ?? 0 };
      },
      update: async () => ({}),
    },
    clinicalFhirResourceCache: {
      findFirst: async (args: { where: { id: string } }) => {
        if (args.where.id === 'cache_poison') {
          await client.query('SELECT 1 / 0');
        }
        return cacheRecord(args.where.id);
      },
    },
    medicationTimelineItem: {
      upsert: async () => ({ id: 'timeline_success' }),
    },
    clinicalProvenanceRecord: {
      createMany: async () => ({ count: 1 }),
    },
  };
}

describeDatabase('clinical sync queue PostgreSQL transaction isolation', () => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await pool.query(
      `CREATE TABLE ${qualifiedQueue} (
         id text PRIMARY KEY,
         status text NOT NULL,
         attempt_count integer NOT NULL CHECK (attempt_count <= max_attempts),
         max_attempts integer NOT NULL,
         cache_id text NOT NULL,
         next_attempt_at timestamptz NOT NULL,
         locked_by text,
         completed_at timestamptz
       )`,
    );
    await pool.query(
      `INSERT INTO ${qualifiedQueue}
         (id, status, attempt_count, max_attempts, cache_id, next_attempt_at)
       VALUES
         ('queue_poison', 'pending', 0, 3, 'cache_poison', $1),
         ('queue_success', 'pending', 0, 3, 'cache_success', $1)`,
      [now],
    );
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.end();
  });

  it('rolls back an aborted item transaction, persists failure separately, and commits the next item', async () => {
    const result = await drainYreseClinicalSyncQueue(
      { orgId: 'org_1', now, lockedBy: 'worker_1' },
      {
        runInOrgContext: async (_orgId, work) => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const value = await work(transactionAdapter(client) as never);
            await client.query('COMMIT');
            return value;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        },
      },
    );

    expect(result).toEqual({
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      conflictCount: 0,
      failedCount: 1,
      skippedCount: 0,
      errors: ['Clinical sync queue item failed'],
    });
    const rows = await pool.query<{ id: string; status: string; attempt_count: number }>(
      `SELECT id, status, attempt_count FROM ${qualifiedQueue} ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: 'queue_poison', status: 'failed', attempt_count: 1 },
      { id: 'queue_success', status: 'succeeded', attempt_count: 0 },
    ]);
  });
});
