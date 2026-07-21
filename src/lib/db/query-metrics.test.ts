import { EventEmitter } from 'node:events';

import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { instrumentDatabasePool, measureDatabaseQueries } from './query-metrics';

function createPoolHarness() {
  const emitter = new EventEmitter() as Pool;
  Object.defineProperties(emitter, {
    totalCount: { configurable: true, get: () => 3 },
    idleCount: { configurable: true, get: () => 1 },
    waitingCount: { configurable: true, get: () => 2 },
  });
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }) as unknown as QueryResult);
  const client = { query } as unknown as PoolClient;
  return { pool: emitter, client, query };
}

describe('database query metrics', () => {
  it('counts actual client queries and captures peak pool pressure inside one async scope', async () => {
    const { pool, client } = createPoolHarness();
    instrumentDatabasePool(pool);

    const result = await measureDatabaseQueries(async () => {
      pool.emit('acquire', client);
      await client.query('SELECT 1');
      await client.query('SELECT 2');
      return 'ok';
    });

    expect(result).toEqual({
      value: 'ok',
      metrics: {
        queryCount: 2,
        overlappingQueryCount: 0,
        maxPoolBusy: 2,
        maxPoolWaiting: 2,
      },
    });
  });

  it('returns null measurements when no instrumented database query ran', async () => {
    await expect(measureDatabaseQueries(async () => 'no-db')).resolves.toEqual({
      value: 'no-db',
      metrics: {
        queryCount: null,
        overlappingQueryCount: null,
        maxPoolBusy: null,
        maxPoolWaiting: null,
      },
    });
  });

  it('does not double-wrap clients or count work outside a measurement scope', async () => {
    const { pool, client, query } = createPoolHarness();
    instrumentDatabasePool(pool);
    instrumentDatabasePool(pool);
    pool.emit('connect', client);
    pool.emit('acquire', client);

    await client.query('SELECT outside');
    const result = await measureDatabaseQueries(async () => {
      await client.query('SELECT inside');
      return null;
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(result.metrics.queryCount).toBe(1);
  });

  it('counts overlapping calls on the same pg client without changing execution order', async () => {
    const { pool, client } = createPoolHarness();
    instrumentDatabasePool(pool);
    pool.emit('acquire', client);

    const result = await measureDatabaseQueries(async () => {
      await Promise.all([client.query('SELECT 1'), client.query('SELECT 2')]);
      return null;
    });

    expect(result.metrics).toMatchObject({
      queryCount: 2,
      overlappingQueryCount: 1,
    });
  });
});
