import { signAwsJsonRequest, type AwsCredentials } from '@/lib/aws/sigv4';
import { readJsonObject } from '@/lib/db/json';
import { maybeUnrefTimeout } from '@/lib/utils/abort-timeout';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { rateLimited } from './response';
import { readJsonResponseBody } from './response-body';
import { canonicalizeRateLimitPath } from './rate-limit-route-canonicalization';

export {
  API_ROUTE_TEMPLATES,
  canonicalizeRateLimitPath,
} from './rate-limit-route-canonicalization';
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
 * Strict limit for authentication endpoints (login, OTP, password reset).
 * 5 attempts per minute to mitigate brute-force attacks.
 */
export const RATE_LIMIT_AUTH_MAX = 5;

/** Grant-wide OTP mismatches allowed before an external access token is hard locked. */
export const EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES = 10;

/** Durable lockout state outlives the maximum 720-hour external access token lifetime. */
export const EXTERNAL_ACCESS_OTP_LOCKOUT_TTL_SECONDS = 31 * 24 * 60 * 60;

const EXTERNAL_ACCESS_OTP_LOCKOUT_KEY_PREFIX = 'durable:external-access-otp:v1:';
const EXTERNAL_ACCESS_OTP_LOCKOUT_COUNTER_KIND = 'external_access_otp_lockout_v1';
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/**
 * How often (in ms) the cleanup routine removes expired entries.
 * Prevents unbounded memory growth in long-running processes.
 */
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

export const RATE_LIMIT_DDB_TIMEOUT_MS = 1_500;

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type RateLimitFailureReason = 'store_misconfigured' | 'store_unavailable';

type DurableCounterResult =
  | { available: true; count: number }
  | { available: false; count: null; reason: RateLimitFailureReason };

type RateLimitStore = {
  increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
  inspectDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
    lockThreshold: number,
  ): Promise<DurableCounterResult>;
  incrementDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
  ): Promise<DurableCounterResult>;
  resetForTests?(): void;
};

type DynamoRateLimitConfig = {
  tableName: string;
  region: string;
};

const store = new Map<string, RateLimitEntry>();
let cachedRateLimitStore: RateLimitStore | null = null;
let cachedAwsCredentials: { credentials: AwsCredentials; expiresAt: number | null } | null = null;
let lastCleanupAt = 0;

// ---------------------------------------------------------------------------
// Core sliding window checker
// ---------------------------------------------------------------------------

function checkLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (now - lastCleanupAt > RATE_LIMIT_CLEANUP_INTERVAL_MS) {
    for (const [entryKey, entry] of store.entries()) {
      if (now > entry.resetAt) {
        store.delete(entryKey);
      }
    }
    lastCleanupAt = now;
  }

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  const remaining = Math.max(0, maxRequests - entry.count);
  const allowed = entry.count <= maxRequests;
  return {
    allowed,
    remaining,
    resetAt: entry.resetAt,
    reason: allowed ? undefined : 'quota_exceeded',
  };
}

class MemoryRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    return checkLimit(key, maxRequests, windowMs);
  }

  async inspectDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
    lockThreshold: number,
  ): Promise<DurableCounterResult> {
    void lockThreshold;
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 0, resetAt: expiresAtEpochSeconds * 1000 });
      return { available: true, count: 0 };
    }
    return { available: true, count: entry.count };
  }

  async incrementDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
  ): Promise<DurableCounterResult> {
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: expiresAtEpochSeconds * 1000 });
      return { available: true, count: 1 };
    }
    entry.count += 1;
    return { available: true, count: entry.count };
  }

  resetForTests() {
    store.clear();
  }
}

class DenyAllRateLimitStore implements RateLimitStore {
  async increment(_key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    void maxRequests;
    return {
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + windowMs,
      reason: 'store_misconfigured',
    };
  }

  async inspectDurableCounter(): Promise<DurableCounterResult> {
    return { available: false, count: null, reason: 'store_misconfigured' };
  }

  async incrementDurableCounter(): Promise<DurableCounterResult> {
    return { available: false, count: null, reason: 'store_misconfigured' };
  }
}

function resolveDynamoRateLimitConfig(): DynamoRateLimitConfig | null {
  if (process.env.RATE_LIMIT_STORE !== 'dynamodb') {
    return null;
  }

  const tableName = process.env.RATE_LIMIT_DDB_TABLE_NAME;
  const region = process.env.RATE_LIMIT_DDB_REGION ?? process.env.AWS_REGION;

  if (!tableName || !region || !hasRateLimitCredentialSource()) {
    return null;
  }

  return {
    tableName,
    region,
  };
}

function hasRateLimitCredentialSource() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return true;
  }
  return Boolean(resolveContainerCredentialsUrl());
}

function resolveStaticAwsCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

function resolveContainerCredentialsUrl(): string | null {
  const relativeUri =
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ??
    process.env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  if (relativeUri) {
    if (!relativeUri.startsWith('/')) return null;
    return `http://169.254.170.2${relativeUri}`;
  }

  const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!fullUri) return null;

  try {
    const parsed = new URL(fullUri);
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '169.254.170.2']);
    if (parsed.protocol !== 'http:' || !allowedHosts.has(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseRequiredTrimmedString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalTrimmedString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return parseRequiredTrimmedString(value);
}

function parseContainerCredentials(payload: unknown): {
  credentials: AwsCredentials;
  expiresAt: number | null;
} | null {
  const object = readJsonObject(payload);
  if (!object) return null;

  const accessKeyId = parseRequiredTrimmedString(object.AccessKeyId);
  const secretAccessKey = parseRequiredTrimmedString(object.SecretAccessKey);
  const sessionToken = parseOptionalTrimmedString(object.Token);
  const expiration = parseRequiredTrimmedString(object.Expiration);
  if (!accessKeyId || !secretAccessKey || sessionToken === null || !expiration) {
    return null;
  }

  const expiresAt = Date.parse(expiration);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
    expiresAt,
  };
}

function parseDynamoPositiveIntegerAttribute(value: unknown) {
  const object = readJsonObject(value);
  if (!object || typeof object.N !== 'string') return null;
  const parsed = Number(object.N.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDynamoNonNegativeIntegerAttribute(value: unknown) {
  const object = readJsonObject(value);
  if (!object || typeof object.N !== 'string') return null;
  const parsed = Number(object.N.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseDynamoRateLimitResponse(payload: unknown): { count: number; resetAt: number } | null {
  const object = readJsonObject(payload);
  const attributes = readJsonObject(object?.Attributes);
  if (!attributes) return null;

  const count = parseDynamoPositiveIntegerAttribute(attributes.hit_count);
  const resetAt = parseDynamoPositiveIntegerAttribute(attributes.reset_at);
  if (count === null || resetAt === null) return null;

  return { count, resetAt };
}

function parseDynamoDurableCounter(payload: unknown, attributeContainer: 'Attributes' | 'Item') {
  const object = readJsonObject(payload);
  const attributes = readJsonObject(object?.[attributeContainer]);
  if (!attributes) return null;
  return parseDynamoNonNegativeIntegerAttribute(attributes.hit_count);
}

function isDynamoConditionalCheckFailure(payload: unknown) {
  const object = readJsonObject(payload);
  const rawType = object?.__type ?? object?.code;
  return (
    typeof rawType === 'string' && rawType.split('#').at(-1) === 'ConditionalCheckFailedException'
  );
}

function createDynamoAbortController() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveDynamoTimeoutMs());
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function resolveAwsCredentials(): Promise<AwsCredentials> {
  const now = Date.now();
  if (
    cachedAwsCredentials &&
    (cachedAwsCredentials.expiresAt == null || cachedAwsCredentials.expiresAt - now > 60_000)
  ) {
    return cachedAwsCredentials.credentials;
  }

  const credentialsUrl = resolveContainerCredentialsUrl();
  if (credentialsUrl) {
    const headers: Record<string, string> = {};
    const authToken = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    if (authToken) {
      headers.Authorization = authToken;
    }

    const abort = createDynamoAbortController();
    try {
      const response = await fetch(credentialsUrl, {
        method: 'GET',
        headers,
        signal: abort.signal,
      });
      if (!response.ok) {
        throw new Error(`AWS container credentials request failed: ${response.status}`);
      }
      const parsed = parseContainerCredentials(await readJsonResponseBody(response));
      if (!parsed) {
        throw new Error('AWS container credentials response is missing required fields');
      }
      cachedAwsCredentials = parsed;
      return parsed.credentials;
    } finally {
      abort.clear();
    }
  }

  const staticCredentials = resolveStaticAwsCredentials();
  if (staticCredentials) return staticCredentials;

  throw new Error('AWS credentials are not configured for the DynamoDB rate-limit store');
}

function resolveDynamoTimeoutMs() {
  return normalizePositiveTimeoutMs(process.env.RATE_LIMIT_DDB_TIMEOUT_MS, {
    fallbackMs: RATE_LIMIT_DDB_TIMEOUT_MS,
  });
}

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production' ||
    process.env.NEXT_PUBLIC_APP_ENV === 'production'
  );
}

function getSafeRateLimitErrorName(error: unknown) {
  if (error instanceof Error) return 'Error';
  if (error === undefined) return undefined;
  return typeof error;
}

function logRateLimitStoreFailure(
  message: string,
  error: unknown,
  context: {
    event: 'rate_limit_dynamodb_store_unavailable' | 'rate_limit_dynamodb_store_fallback';
    operation: 'deny_request' | 'fallback_to_memory';
  },
) {
  console.error(message, {
    event: context.event,
    operation: context.operation,
    error_name: getSafeRateLimitErrorName(error),
  });
}

async function sendDynamoUpdateItem(config: DynamoRateLimitConfig, requestBody: string) {
  const signedRequest = await signAwsJsonRequest({
    service: 'dynamodb',
    region: config.region,
    body: requestBody,
    target: 'DynamoDB_20120810.UpdateItem',
    credentials: await resolveAwsCredentials(),
  });
  const abort = createDynamoAbortController();
  try {
    return await fetch(`https://${signedRequest.host}/`, {
      method: 'POST',
      headers: signedRequest.headers,
      body: requestBody,
      signal: abort.signal,
    });
  } finally {
    abort.clear();
  }
}

class DynamoRateLimitStore implements RateLimitStore {
  constructor(
    private readonly config: DynamoRateLimitConfig,
    private readonly fallback: MemoryRateLimitStore,
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
      const response = await sendDynamoUpdateItem(this.config, requestBody);

      if (!response.ok) {
        throw new Error(`DynamoDB rate limit request failed: ${response.status}`);
      }

      const parsed = parseDynamoRateLimitResponse(await readJsonResponseBody(response));
      if (!parsed) {
        throw new Error('DynamoDB rate limit response is missing required counters');
      }

      return {
        allowed: parsed.count <= maxRequests,
        remaining: Math.max(0, maxRequests - parsed.count),
        resetAt: parsed.resetAt,
        reason: parsed.count <= maxRequests ? undefined : 'quota_exceeded',
      };
    } catch (error) {
      if (isProductionRuntime()) {
        logRateLimitStoreFailure(
          '[rate-limit] DynamoDB store unavailable; denying request',
          error,
          {
            event: 'rate_limit_dynamodb_store_unavailable',
            operation: 'deny_request',
          },
        );
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          reason: 'store_unavailable',
        };
      }

      logRateLimitStoreFailure('[rate-limit] Falling back to in-memory store', error, {
        event: 'rate_limit_dynamodb_store_fallback',
        operation: 'fallback_to_memory',
      });
      return this.fallback.increment(key, windowMs, maxRequests);
    }
  }

  async inspectDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
    lockThreshold: number,
  ): Promise<DurableCounterResult> {
    return this.updateDurableCounter({
      key,
      expiresAtEpochSeconds,
      lockThreshold,
      operation: 'inspect',
    });
  }

  async incrementDurableCounter(
    key: string,
    expiresAtEpochSeconds: number,
  ): Promise<DurableCounterResult> {
    return this.updateDurableCounter({
      key,
      expiresAtEpochSeconds,
      operation: 'increment',
    });
  }

  private async updateDurableCounter(args: {
    key: string;
    expiresAtEpochSeconds: number;
    operation: 'inspect' | 'increment';
    lockThreshold?: number;
  }): Promise<DurableCounterResult> {
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const inspect = args.operation === 'inspect';
    const requestBody = JSON.stringify({
      TableName: this.config.tableName,
      Key: {
        pk: { S: args.key },
      },
      UpdateExpression: inspect
        ? 'SET hit_count = if_not_exists(hit_count, :zero), expires_at = if_not_exists(expires_at, :expires_at), created_at = if_not_exists(created_at, :created_at), counter_kind = if_not_exists(counter_kind, :counter_kind)'
        : 'ADD hit_count :inc SET expires_at = if_not_exists(expires_at, :expires_at), updated_at = :updated_at, created_at = if_not_exists(created_at, :created_at), counter_kind = if_not_exists(counter_kind, :counter_kind)',
      ...(inspect
        ? {
            ConditionExpression: 'attribute_not_exists(hit_count) OR hit_count < :threshold',
            ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
          }
        : {}),
      ExpressionAttributeValues: {
        ...(inspect ? { ':zero': { N: '0' } } : { ':inc': { N: '1' } }),
        ':expires_at': { N: String(args.expiresAtEpochSeconds) },
        ':created_at': { S: timestamp },
        ':counter_kind': { S: EXTERNAL_ACCESS_OTP_LOCKOUT_COUNTER_KIND },
        ...(inspect ? { ':threshold': { N: String(args.lockThreshold) } } : {}),
        ...(!inspect ? { ':updated_at': { S: timestamp } } : {}),
      },
      ReturnValues: 'ALL_NEW',
    });

    try {
      const response = await sendDynamoUpdateItem(this.config, requestBody);
      const responsePayload = await readJsonResponseBody(response);
      if (!response.ok) {
        if (
          inspect &&
          response.status === 400 &&
          isDynamoConditionalCheckFailure(responsePayload)
        ) {
          const count = parseDynamoDurableCounter(responsePayload, 'Item');
          if (count !== null && count >= (args.lockThreshold ?? Number.MAX_SAFE_INTEGER)) {
            return { available: true, count };
          }
        }
        throw new Error(`DynamoDB durable counter request failed: ${response.status}`);
      }

      const count = parseDynamoDurableCounter(responsePayload, 'Attributes');
      if (count === null) {
        throw new Error('DynamoDB durable counter response is missing a valid counter');
      }
      return { available: true, count };
    } catch (error) {
      if (isProductionRuntime()) {
        logRateLimitStoreFailure(
          '[rate-limit] DynamoDB store unavailable; denying request',
          error,
          {
            event: 'rate_limit_dynamodb_store_unavailable',
            operation: 'deny_request',
          },
        );
        return { available: false, count: null, reason: 'store_unavailable' };
      }

      logRateLimitStoreFailure('[rate-limit] Falling back to in-memory store', error, {
        event: 'rate_limit_dynamodb_store_fallback',
        operation: 'fallback_to_memory',
      });
      return inspect
        ? this.fallback.inspectDurableCounter(
            args.key,
            args.expiresAtEpochSeconds,
            args.lockThreshold ?? EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
          )
        : this.fallback.incrementDurableCounter(args.key, args.expiresAtEpochSeconds);
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

  // Production guard: in-memory store is not safe for multi-instance deployments.
  // RATE_LIMIT_STORE=dynamodb must be configured in production to prevent bypass.
  if (isProductionRuntime() && !dynamoConfig) {
    console.error(
      '[rate-limit] CRITICAL: distributed rate limiting is not fully configured in production. ' +
        'Denying API requests instead of falling back to per-process memory. ' +
        'Set RATE_LIMIT_STORE=dynamodb, RATE_LIMIT_DDB_TABLE_NAME, and an AWS role/credential source.',
    );
    cachedRateLimitStore = new DenyAllRateLimitStore();
    return cachedRateLimitStore;
  }

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
  reason?: 'quota_exceeded' | 'store_misconfigured' | 'store_unavailable';
}

export type ExternalAccessOtpLockoutResult = {
  available: boolean;
  locked: boolean;
  attempts: number | null;
  reason?: RateLimitFailureReason;
};

function buildExternalAccessOtpLockoutKey(identifierDigest: string) {
  return SHA256_HEX_PATTERN.test(identifierDigest)
    ? `${EXTERNAL_ACCESS_OTP_LOCKOUT_KEY_PREFIX}${identifierDigest}`
    : null;
}

function resolveExternalAccessOtpLockoutExpiry() {
  return Math.floor(Date.now() / 1000) + EXTERNAL_ACCESS_OTP_LOCKOUT_TTL_SECONDS;
}

function toExternalAccessOtpLockoutResult(
  result: DurableCounterResult,
): ExternalAccessOtpLockoutResult {
  if (!result.available) {
    return {
      available: false,
      locked: true,
      attempts: null,
      reason: result.reason,
    };
  }
  return {
    available: true,
    locked: result.count >= EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
    attempts: result.count,
  };
}

/** Atomically inspects the grant-wide mismatch counter without increasing it. */
export async function checkExternalAccessOtpLockout(
  identifierDigest: string,
): Promise<ExternalAccessOtpLockoutResult> {
  const key = buildExternalAccessOtpLockoutKey(identifierDigest);
  if (!key) {
    return {
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    };
  }
  const result = await getRateLimitStore().inspectDurableCounter(
    key,
    resolveExternalAccessOtpLockoutExpiry(),
    EXTERNAL_ACCESS_OTP_LOCKOUT_MAX_FAILURES,
  );
  return toExternalAccessOtpLockoutResult(result);
}

/** Atomically records one verified active grant's OTP mismatch and returns the post-count. */
export async function recordExternalAccessOtpFailure(
  identifierDigest: string,
): Promise<ExternalAccessOtpLockoutResult> {
  const key = buildExternalAccessOtpLockoutKey(identifierDigest);
  if (!key) {
    return {
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_misconfigured',
    };
  }
  const result = await getRateLimitStore().incrementDurableCounter(
    key,
    resolveExternalAccessOtpLockoutExpiry(),
  );
  return toExternalAccessOtpLockoutResult(result);
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
  const key = `${methodBucket}:${identifier}:${canonicalizeRateLimitPath(pathname)}`;

  return getRateLimitStore().increment(key, RATE_LIMIT_WINDOW_MS, maxRequests);
}

/**
 * Check rate limit for authentication endpoints (login, OTP, MFA).
 * Uses a strict 5 requests/minute limit to mitigate brute-force attacks.
 *
 * @param identifier - IP address or user ID
 * @param pathname   - Request pathname
 */
export async function checkAuthRateLimit(
  identifier: string,
  pathname: string,
): Promise<RateLimitResult> {
  const key = `auth:${identifier}:${canonicalizeRateLimitPath(pathname)}`;
  return getRateLimitStore().increment(key, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_AUTH_MAX);
}

// ---------------------------------------------------------------------------
// Feature-scoped limiters — deliberately generous, env-tunable per-feature
// budgets for specific high-traffic routes (heavy search GETs, high-churn
// write POSTs). Distinct from the generic checkRateLimit() bucket so these
// routes can be tuned independently without affecting every API route.
// ---------------------------------------------------------------------------

/**
 * Default requests/minute for feature-scoped "search" limiter.
 * Deliberately generous: normal debounced UI usage should never approach it.
 * Override with env RATE_LIMIT_FEATURE_SEARCH_MAX.
 */
export const RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT = 120;

/**
 * Default requests/minute for feature-scoped "mutation" (write) limiter.
 * Override with env RATE_LIMIT_FEATURE_MUTATION_MAX.
 */
export const RATE_LIMIT_FEATURE_MUTATION_MAX_DEFAULT = 60;

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Kill switch for feature-scoped rate limiting. Set
 * RATE_LIMIT_FEATURE_DISABLED=1 (or "true") to disable without a deploy of
 * code changes, e.g. if a limit turns out to be too tight for real usage.
 */
function isFeatureRateLimitDisabled(): boolean {
  const raw = process.env.RATE_LIMIT_FEATURE_DISABLED;
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function resolveFeatureRateLimitMax(kind: 'search' | 'mutation'): number {
  if (kind === 'search') {
    return parsePositiveIntEnv(
      process.env.RATE_LIMIT_FEATURE_SEARCH_MAX,
      RATE_LIMIT_FEATURE_SEARCH_MAX_DEFAULT,
    );
  }
  return parsePositiveIntEnv(
    process.env.RATE_LIMIT_FEATURE_MUTATION_MAX,
    RATE_LIMIT_FEATURE_MUTATION_MAX_DEFAULT,
  );
}

/**
 * Check rate limit for a specific high-traffic feature route (heavy search
 * GET or high-churn write POST). Scoped separately from the generic
 * checkRateLimit()/checkAuthRateLimit() buckets so it can be tuned or
 * disabled per-feature via env without touching every route.
 *
 * @param identifier - Stable per-actor key, e.g. `${orgId}:${userId}`
 * @param pathname   - Request pathname, canonicalized and used to key limits per route
 * @param kind        - 'search' (generous read budget) or 'mutation' (write budget)
 */
export async function checkFeatureRateLimit(
  identifier: string,
  pathname: string,
  kind: 'search' | 'mutation',
): Promise<RateLimitResult> {
  if (isFeatureRateLimitDisabled()) {
    return {
      allowed: true,
      remaining: Number.MAX_SAFE_INTEGER,
      resetAt: Date.now() + RATE_LIMIT_WINDOW_MS,
    };
  }

  const maxRequests = resolveFeatureRateLimitMax(kind);
  const key = `feature:${kind}:${identifier}:${canonicalizeRateLimitPath(pathname)}`;
  return getRateLimitStore().increment(key, RATE_LIMIT_WINDOW_MS, maxRequests);
}

/**
 * Convenience wrapper for route handlers: checks the feature-scoped limiter
 * and, if exceeded, returns a ready-to-use 429 response (Retry-After header,
 * Japanese message). Returns null when the request is allowed through.
 *
 * @param identifier - Stable per-actor key, e.g. `${orgId}:${userId}`
 * @param pathname   - Request pathname
 * @param kind        - 'search' (generous read budget) or 'mutation' (write budget)
 */
export async function enforceFeatureRateLimit(
  identifier: string,
  pathname: string,
  kind: 'search' | 'mutation',
) {
  const result = await checkFeatureRateLimit(identifier, pathname, kind);
  if (result.allowed) return null;
  const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
  return rateLimited(retryAfterSeconds);
}

/**
 * Low-level factory for custom-scoped limiters (e.g., SSE connection counting).
 * Returns a function that accepts a string key and returns the limit result.
 */
export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  return async (
    identifier: string,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> => {
    const result = await getRateLimitStore().increment(identifier, opts.windowMs, opts.maxRequests);
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
  cachedAwsCredentials = null;
  lastCleanupAt = 0;
}
