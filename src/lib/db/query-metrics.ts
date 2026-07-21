import { AsyncLocalStorage } from 'node:async_hooks';

import type { Pool, PoolClient } from 'pg';

export type DatabaseQueryMetrics = {
  queryCount: number | null;
  overlappingQueryCount: number | null;
  maxPoolBusy: number | null;
  maxPoolWaiting: number | null;
};

type MutableDatabaseQueryMetrics = {
  queryCount: number;
  overlappingQueryCount: number;
  observedQuery: boolean;
  maxPoolBusy: number | null;
  maxPoolWaiting: number | null;
};

type DatabaseQueryMetricsState = {
  storage: AsyncLocalStorage<MutableDatabaseQueryMetrics>;
  instrumentedClients: WeakSet<PoolClient>;
  instrumentedPools: WeakSet<Pool>;
  activeQueryCounts?: WeakMap<PoolClient, number>;
};

type DatabaseQueryMetricsGlobal = typeof globalThis & {
  __careviaxDatabaseQueryMetrics?: DatabaseQueryMetricsState;
};

// Next.js can evaluate route bundles independently while reusing the same
// process-global Prisma client. Keep the request scope and instrumentation
// registry beside that client so every bundle observes the same pg queries.
const metricsGlobal = globalThis as DatabaseQueryMetricsGlobal;
const metricsState = (metricsGlobal.__careviaxDatabaseQueryMetrics ??= {
  storage: new AsyncLocalStorage<MutableDatabaseQueryMetrics>(),
  instrumentedClients: new WeakSet<PoolClient>(),
  instrumentedPools: new WeakSet<Pool>(),
  activeQueryCounts: new WeakMap<PoolClient, number>(),
});
const queryMetricsStorage = metricsState.storage;
const instrumentedClients = metricsState.instrumentedClients;
const instrumentedPools = metricsState.instrumentedPools;
const activeQueryCounts = (metricsState.activeQueryCounts ??= new WeakMap<PoolClient, number>());

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
    const activeQueryCount = activeQueryCounts.get(client) ?? 0;
    if (metrics) {
      metrics.observedQuery = true;
      metrics.queryCount += 1;
      if (activeQueryCount > 0) {
        metrics.overlappingQueryCount += 1;
      }
      samplePool(pool, metrics);
    }

    const result = originalQuery(...args);
    if (metrics && result && typeof (result as Promise<unknown>).then === 'function') {
      activeQueryCounts.set(client, activeQueryCount + 1);
      const finishQuery = () => {
        const remaining = Math.max(0, (activeQueryCounts.get(client) ?? 1) - 1);
        if (remaining === 0) activeQueryCounts.delete(client);
        else activeQueryCounts.set(client, remaining);
        samplePool(pool, metrics);
      };
      void (result as Promise<unknown>).then(finishQuery, finishQuery);
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
        overlappingQueryCount: existing.observedQuery ? existing.overlappingQueryCount : null,
        maxPoolBusy: existing.maxPoolBusy,
        maxPoolWaiting: existing.maxPoolWaiting,
      },
    };
  }

  const metrics: MutableDatabaseQueryMetrics = {
    queryCount: 0,
    overlappingQueryCount: 0,
    observedQuery: false,
    maxPoolBusy: null,
    maxPoolWaiting: null,
  };
  const value = await queryMetricsStorage.run(metrics, work);
  return {
    value,
    metrics: {
      queryCount: metrics.observedQuery ? metrics.queryCount : null,
      overlappingQueryCount: metrics.observedQuery ? metrics.overlappingQueryCount : null,
      maxPoolBusy: metrics.maxPoolBusy,
      maxPoolWaiting: metrics.maxPoolWaiting,
    },
  };
}
