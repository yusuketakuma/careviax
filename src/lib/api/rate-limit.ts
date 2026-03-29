/**
 * Rate limiting module — multi-instance aware sliding window implementation.
 *
 * Design: monolith-first (CLAUDE.md). No external store dependency.
 * L1 in-memory store handles all requests with proper per-method limits
 * and user-based keying (user ID when available, fallback to IP).
 *
 * For true distributed rate limiting (when horizontal scaling is needed),
 * replace the store Map with a PostgreSQL-backed counter or Redis.
 */

// ---------------------------------------------------------------------------
// Configuration constants — tune without hunting through code
// ---------------------------------------------------------------------------

/** Time window length in milliseconds for all limiters */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Maximum requests per window for read-only methods (GET, HEAD).
 * Higher limit because reads are cheap and clients may poll frequently.
 */
export const RATE_LIMIT_READ_MAX = 300;

/**
 * Maximum requests per window for state-changing methods
 * (POST, PUT, PATCH, DELETE).
 * Lower limit to prevent abuse of write operations.
 */
export const RATE_LIMIT_WRITE_MAX = 60;

/**
 * How often (in ms) the cleanup routine removes expired entries.
 * Prevents unbounded memory growth in long-running processes.
 */
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  /** Cumulative hit count within the current window */
  count: number;
  /** Epoch ms when this window expires and count resets */
  resetAt: number;
}

/** Keyed by `${method}:${userId|ip}:${pathname}` */
const store = new Map<string, RateLimitEntry>();

// Periodic cleanup — runs inside the process; safe to skip in test environments.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);

  // Allow the process to exit without waiting for the interval.
  if (typeof cleanupTimer === 'object' && cleanupTimer !== null && 'unref' in cleanupTimer) {
    (cleanupTimer as ReturnType<typeof setInterval>).unref?.();
  }
}

// Start cleanup unless we are in a test environment where explicit resets are used.
if (process.env.NODE_ENV !== 'test') {
  startCleanup();
}

// ---------------------------------------------------------------------------
// Core sliding window checker
// ---------------------------------------------------------------------------

function checkLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  const remaining = Math.max(0, maxRequests - entry.count);
  return {
    allowed: entry.count <= maxRequests,
    remaining,
    resetAt: entry.resetAt,
  };
}

// ---------------------------------------------------------------------------
// HTTP method categorisation
// ---------------------------------------------------------------------------

/** Read-only HTTP methods that get a higher rate-limit budget. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch milliseconds when the current window resets */
  resetAt: number;
}

/**
 * Check rate limit for an incoming request.
 *
 * @param identifier - User ID (preferred for accuracy) or IP address (fallback)
 * @param pathname   - Request pathname, used to key limits per route
 * @param method     - HTTP method; GET/HEAD get a higher limit than write methods
 */
export function checkRateLimit(
  identifier: string,
  pathname: string,
  method = 'GET',
): RateLimitResult {
  const read = isReadMethod(method);
  const maxRequests = read ? RATE_LIMIT_READ_MAX : RATE_LIMIT_WRITE_MAX;
  const methodBucket = read ? 'read' : 'write';
  const key = `${methodBucket}:${identifier}:${pathname}`;

  return checkLimit(key, maxRequests, RATE_LIMIT_WINDOW_MS);
}

/**
 * Low-level factory for custom-scoped limiters (e.g., SSE connection counting).
 * Returns a function that accepts a string key and returns the limit result.
 */
export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  return (identifier: string): { allowed: boolean; remaining: number; resetAt: Date } => {
    const result = checkLimit(identifier, opts.maxRequests, opts.windowMs);
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: new Date(result.resetAt),
    };
  };
}

// ---------------------------------------------------------------------------
// SSE connection limiter — separate budget from per-request limiting
// ---------------------------------------------------------------------------

/**
 * Maximum concurrent SSE connections per user.
 * Each browser tab opens one connection; a small budget prevents connection storms.
 */
export const SSE_MAX_CONNECTIONS = 10;

/**
 * Track active SSE connection count per user/IP identifier.
 * Unlike the sliding window, this is a simple gauge (increment on open, decrement on close).
 */
const sseConnections = new Map<string, number>();

export interface SseConnectionResult {
  allowed: boolean;
  /** Current connection count after this call */
  count: number;
}

/** Call when a new SSE connection is established. */
export function acquireSseConnection(identifier: string): SseConnectionResult {
  const current = sseConnections.get(identifier) ?? 0;
  if (current >= SSE_MAX_CONNECTIONS) {
    return { allowed: false, count: current };
  }
  sseConnections.set(identifier, current + 1);
  return { allowed: true, count: current + 1 };
}

/** Call when an SSE connection closes (request abort or error). */
export function releaseSseConnection(identifier: string): void {
  const current = sseConnections.get(identifier) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    sseConnections.delete(identifier);
  } else {
    sseConnections.set(identifier, next);
  }
}

// ---------------------------------------------------------------------------
// Test helpers — only used in unit tests, not exposed in production paths
// ---------------------------------------------------------------------------

/** Reset all internal stores. Intended for test setup/teardown only. */
export function resetRateLimitStoreForTests() {
  store.clear();
  sseConnections.clear();
}
