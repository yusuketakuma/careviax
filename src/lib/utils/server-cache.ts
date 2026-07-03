/**
 * TTL-based in-memory LRU cache for server-side response caching.
 * Designed for short-lived caching of expensive aggregation queries
 * (e.g., dashboard workflow with 25+ DB queries).
 */

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  lastAccessed: number;
};

const DEFAULT_MAX_ENTRIES = 50;

export class ServerCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    entry.lastAccessed = Date.now();
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Evict expired entries first
    this.evictExpired();

    // If still at capacity, evict least recently accessed
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictLru();
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      lastAccessed: Date.now(),
    });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private evictLru(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

// Singleton instance for the application
const globalForCache = globalThis as unknown as { __serverCache?: ServerCache };
export const serverCache = globalForCache.__serverCache ?? new ServerCache();
if (process.env.NODE_ENV !== 'production') {
  globalForCache.__serverCache = serverCache;
}

/**
 * Creates (or reuses, in dev, across HMR reloads) an independent named
 * ServerCache instance with its own Map and capacity — for callers that
 * must NOT share the default `serverCache` singleton's Map/cap (e.g. a
 * higher-churn cache with a different capacity requirement).
 */
const globalForNamedCaches = globalThis as unknown as {
  __namedServerCaches?: Map<string, ServerCache>;
};

export function createServerCache(name: string, maxEntries = DEFAULT_MAX_ENTRIES): ServerCache {
  if (!globalForNamedCaches.__namedServerCaches) {
    globalForNamedCaches.__namedServerCaches = new Map();
  }
  const existing = globalForNamedCaches.__namedServerCaches.get(name);
  if (existing) return existing;

  const cache = new ServerCache(maxEntries);
  if (process.env.NODE_ENV !== 'production') {
    globalForNamedCaches.__namedServerCaches.set(name, cache);
  }
  return cache;
}
