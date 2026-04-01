import { signAwsJsonRequest, type AwsCredentials } from '@/lib/aws/sigv4';
/**
 * Rate limiting module.
 *
 * Default: in-memory fixed window per process.
 * Optional: DynamoDB-backed distributed counter for multi-instance deployments.
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
  count: number;
  resetAt: number;
}

type RateLimitStore = {
  increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
  resetForTests?(): void;
};

type DynamoRateLimitConfig = {
  tableName: string;
  region: string;
  credentials: AwsCredentials;
};

const store = new Map<string, RateLimitEntry>();
let cachedRateLimitStore: RateLimitStore | null = null;

// Periodic cleanup — runs inside the process; safe to skip in test environments.
// Fix 7: Use NodeJS.Timeout directly; .unref() is always present on Node.js intervals.
let cleanupTimer: NodeJS.Timeout | null = null;

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
  cleanupTimer.unref();
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

class MemoryRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    return checkLimit(key, maxRequests, windowMs);
  }

  resetForTests() {
    store.clear();
  }
}

function resolveDynamoRateLimitConfig(): DynamoRateLimitConfig | null {
  if (process.env.RATE_LIMIT_STORE !== 'dynamodb') {
    return null;
  }

  const tableName = process.env.RATE_LIMIT_DDB_TABLE_NAME;
  const region = process.env.RATE_LIMIT_DDB_REGION ?? process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!tableName || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    tableName,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  };
}

class DynamoRateLimitStore implements RateLimitStore {
  constructor(
    private readonly config: DynamoRateLimitConfig,
    private readonly fallback: MemoryRateLimitStore
  ) {}

  async increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    const bucketStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = bucketStart + windowMs;
    const expiresAt = Math.ceil(resetAt / 1000) + 86_400;
    const scopedKey = `${bucketStart}:${key}`;
    const requestBody = JSON.stringify({
      TableName: this.config.tableName,
      Key: {
        pk: { S: scopedKey },
      },
      UpdateExpression:
        'ADD hit_count :inc SET reset_at = if_not_exists(reset_at, :reset_at), expires_at = :expires_at, updated_at = :updated_at, created_at = if_not_exists(created_at, :created_at)',
      ExpressionAttributeValues: {
        ':inc': { N: '1' },
        ':reset_at': { N: String(resetAt) },
        ':expires_at': { N: String(expiresAt) },
        ':updated_at': { S: new Date(now).toISOString() },
        ':created_at': { S: new Date(now).toISOString() },
      },
      ReturnValues: 'UPDATED_NEW',
    });

    try {
      const signedRequest = await signAwsJsonRequest({
        service: 'dynamodb',
        region: this.config.region,
        body: requestBody,
        target: 'DynamoDB_20120810.UpdateItem',
        credentials: this.config.credentials,
      });
      const response = await fetch(`https://${signedRequest.host}/`, {
        method: 'POST',
        headers: signedRequest.headers,
        body: requestBody,
      });

      if (!response.ok) {
        throw new Error(`DynamoDB rate limit request failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        Attributes?: {
          hit_count?: { N?: string };
          reset_at?: { N?: string };
        };
      };
      const count = Number(payload.Attributes?.hit_count?.N ?? '1');
      const resolvedResetAt = Number(payload.Attributes?.reset_at?.N ?? String(resetAt));

      return {
        allowed: count <= maxRequests,
        remaining: Math.max(0, maxRequests - count),
        resetAt: resolvedResetAt,
      };
    } catch (error) {
      console.error('[rate-limit] Falling back to in-memory store', error);
      return this.fallback.increment(key, windowMs, maxRequests);
    }
  }

  resetForTests() {
    this.fallback.resetForTests();
  }
}

function getRateLimitStore(): RateLimitStore {
  if (cachedRateLimitStore) {
    return cachedRateLimitStore;
  }

  const memoryStore = new MemoryRateLimitStore();
  const dynamoConfig = resolveDynamoRateLimitConfig();
  cachedRateLimitStore = dynamoConfig
    ? new DynamoRateLimitStore(dynamoConfig, memoryStore)
    : memoryStore;
  return cachedRateLimitStore;
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
export async function checkRateLimit(
  identifier: string,
  pathname: string,
  method: string,
): Promise<RateLimitResult> {
  const read = isReadMethod(method);
  const maxRequests = read ? RATE_LIMIT_READ_MAX : RATE_LIMIT_WRITE_MAX;
  const methodBucket = read ? 'read' : 'write';
  const key = `${methodBucket}:${identifier}:${pathname}`;

  return getRateLimitStore().increment(key, RATE_LIMIT_WINDOW_MS, maxRequests);
}

/**
 * Low-level factory for custom-scoped limiters (e.g., SSE connection counting).
 * Returns a function that accepts a string key and returns the limit result.
 */
export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  return async (identifier: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> => {
    const result = await getRateLimitStore().increment(
      identifier,
      opts.windowMs,
      opts.maxRequests
    );
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
  cachedRateLimitStore = null;
}
