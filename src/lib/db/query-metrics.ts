import { AsyncLocalStorage } from 'node:async_hooks';

import type { Pool, PoolClient } from 'pg';

export type DatabaseQueryMetrics = {
  queryCount: number | null;
  maxPoolBusy: number | null;
  maxPoolWaiting: number | null;
};

type MutableDatabaseQueryMetrics = {
  queryCount: number;
  observedQuery: boolean;
  maxPoolBusy: number | null;
  maxPoolWaiting: number | null;
};

const queryMetricsStorage = new AsyncLocalStorage<MutableDatabaseQueryMetrics>();
const instrumentedClients = new WeakSet<PoolClient>();
const instrumentedPools = new WeakSet<Pool>();

function samplePool(pool: Pool, metrics: MutableDatabaseQueryMetrics): void {
  const busy = Math.max(0, pool.totalCount - pool.idleCount);
  metrics.maxPoolBusy = Math.max(metrics.maxPoolBusy ?? 0, busy);
  metrics.maxPoolWaiting = Math.max(metrics.maxPoolWaiting ?? 0, pool.waitingCount);
}

function instrumentClient(pool: Pool, client: PoolClient): void {
  if (instrumentedClients.has(client)) return;
  instrumentedClients.add(client);

  const originalQuery = client.query.bind(client);
  client.query = ((...args: Parameters<PoolClient['query']>) => {
    const metrics = queryMetricsStorage.getStore();
    if (metrics) {
      metrics.observedQuery = true;
      metrics.queryCount += 1;
      samplePool(pool, metrics);
    }

    const result = originalQuery(...args);
    if (metrics && result && typeof (result as Promise<unknown>).then === 'function') {
      void (result as Promise<unknown>).then(
        () => samplePool(pool, metrics),
        () => samplePool(pool, metrics),
      );
    }
    return result;
  }) as PoolClient['query'];
}

/** Instruments actual pg clients without wrapping Prisma transaction semantics. */
export function instrumentDatabasePool(pool: Pool): void {
  if (instrumentedPools.has(pool)) return;
  instrumentedPools.add(pool);
  pool.on('connect', (client) => instrumentClient(pool, client));
  pool.on('acquire', (client) => instrumentClient(pool, client));
}

export async function measureDatabaseQueries<T>(work: () => Promise<T>): Promise<{
  value: T;
  metrics: DatabaseQueryMetrics;
}> {
  const existing = queryMetricsStorage.getStore();
  if (existing) {
    return {
      value: await work(),
      metrics: {
        queryCount: existing.observedQuery ? existing.queryCount : null,
        maxPoolBusy: existing.maxPoolBusy,
        maxPoolWaiting: existing.maxPoolWaiting,
      },
    };
  }

  const metrics: MutableDatabaseQueryMetrics = {
    queryCount: 0,
    observedQuery: false,
    maxPoolBusy: null,
    maxPoolWaiting: null,
  };
  const value = await queryMetricsStorage.run(metrics, work);
  return {
    value,
    metrics: {
      queryCount: metrics.observedQuery ? metrics.queryCount : null,
      maxPoolBusy: metrics.maxPoolBusy,
      maxPoolWaiting: metrics.maxPoolWaiting,
    },
  };
}
