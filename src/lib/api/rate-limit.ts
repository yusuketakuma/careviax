import { signAwsJsonRequest, type AwsCredentials } from '@/lib/aws/sigv4';
import { readJsonObject } from '@/lib/db/json';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { readJsonResponseBody } from './response-body';
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

type RateLimitStore = {
  increment(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
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

function parseDynamoRateLimitResponse(payload: unknown): { count: number; resetAt: number } | null {
  const object = readJsonObject(payload);
  const attributes = readJsonObject(object?.Attributes);
  if (!attributes) return null;

  const count = parseDynamoPositiveIntegerAttribute(attributes.hit_count);
  const resetAt = parseDynamoPositiveIntegerAttribute(attributes.reset_at);
  if (count === null || resetAt === null) return null;

  return { count, resetAt };
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
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
      const signedRequest = await signAwsJsonRequest({
        service: 'dynamodb',
        region: this.config.region,
        body: requestBody,
        target: 'DynamoDB_20120810.UpdateItem',
        credentials: await resolveAwsCredentials(),
      });
      const abort = createDynamoAbortController();
      let response: Response;
      try {
        response = await fetch(`https://${signedRequest.host}/`, {
          method: 'POST',
          headers: signedRequest.headers,
          body: requestBody,
          signal: abort.signal,
        });
      } finally {
        abort.clear();
      }

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
        console.error('[rate-limit] DynamoDB store unavailable; denying request', error);
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          reason: 'store_unavailable',
        };
      }

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
// Route canonicalization
// ---------------------------------------------------------------------------

const UNKNOWN_API_RATE_LIMIT_PATH = '/api/__unknown__';

export const API_ROUTE_TEMPLATES = [
  '/api/admin/capacity',
  '/api/admin/data-explorer/:id',
  '/api/admin/data-explorer/:id/:id',
  '/api/admin/data-explorer/models',
  '/api/admin/escalation-rules',
  '/api/admin/escalation-rules/:id',
  '/api/admin/external-professionals',
  '/api/admin/external-professionals/:id',
  '/api/admin/external-professionals/:id/communications',
  '/api/admin/external-professionals/:id/patients',
  '/api/admin/facilities',
  '/api/admin/facilities/:id',
  '/api/admin/facilities/:id/contacts',
  '/api/admin/facilities/:id/patients',
  '/api/admin/facilities/:id/units',
  '/api/admin/facilities/:id/units/:id',
  '/api/admin/facilities/:id/visit-batches',
  '/api/admin/facility-standards',
  '/api/admin/flush-metrics',
  '/api/admin/inventory-forecast',
  '/api/admin/master-hub',
  '/api/admin/metrics',
  '/api/admin/operations-insights',
  '/api/admin/organizations',
  '/api/admin/performance-metrics',
  '/api/admin/pharmacist-credentials',
  '/api/admin/pharmacist-credentials/:id',
  '/api/admin/pilot-launch-dossier',
  '/api/admin/pilot-org-audit',
  '/api/admin/pilot-readiness',
  '/api/admin/reject-reason-stats',
  '/api/admin/staff-metrics',
  '/api/admin/uat-feedback',
  '/api/admin/uat-feedback/:id',
  '/api/admin/uat-feedback/summary',
  '/api/admin/webhooks',
  '/api/audit-logs',
  '/api/audit-logs/export',
  '/api/auth/:path*',
  '/api/auth/mfa/recovery',
  '/api/auth/password/reset/confirm',
  '/api/auth/password/reset/request',
  '/api/billing-candidates',
  '/api/billing-candidates/:id',
  '/api/billing-candidates/close',
  '/api/billing-candidates/export',
  '/api/billing-evidence/analytics',
  '/api/billing-evidence/check',
  '/api/billing-evidence/stats',
  '/api/billing-rules',
  '/api/billing-rules/:id',
  '/api/business-holidays',
  '/api/business-holidays/:id',
  '/api/care-reports',
  '/api/care-reports/:id',
  '/api/care-reports/:id/pdf',
  '/api/care-reports/:id/send',
  '/api/care-reports/analytics',
  '/api/care-reports/generate-from-visit',
  '/api/care-reports/reminders',
  '/api/care-reports/today-workspace',
  '/api/cases',
  '/api/cases/:id',
  '/api/cases/:id/transition',
  '/api/cds/check',
  '/api/collaboration/room-token',
  '/api/comments',
  '/api/comments/:id',
  '/api/communication-events',
  '/api/communication-requests',
  '/api/communication-requests/:id',
  '/api/communication-requests/:id/responses',
  '/api/communication-requests/export',
  '/api/community-activities',
  '/api/community-activities/:id',
  '/api/conference-notes',
  '/api/conference-notes/:id',
  '/api/conference-notes/:id/generate-report',
  '/api/conference-notes/:id/pdf',
  '/api/conference-notes/:id/tasks',
  '/api/conference-notes/participant-suggestions',
  '/api/consent-records',
  '/api/consent-records/:id',
  '/api/consent-records/:id/revoke',
  '/api/contact-profiles',
  '/api/dashboard/dispensing-stats',
  '/api/dashboard/medication-deadlines',
  '/api/dashboard/monthly-stats',
  '/api/dashboard/overdue',
  '/api/dashboard/cockpit',
  '/api/dashboard/clerk-support',
  '/api/dashboard/workflow',
  '/api/dispense-audits',
  '/api/dispense-queue',
  '/api/dispense-results',
  '/api/dispense-results/:id',
  '/api/dispense-tasks',
  '/api/dispense-tasks/:id',
  '/api/dispense-tasks/:id/verify-barcode',
  '/api/dispense-tasks/:id/workbench',
  '/api/document-delivery-rules',
  '/api/document-delivery-rules/:id',
  '/api/drug-alert-rules',
  '/api/drug-alert-rules/:id',
  '/api/drug-master-import-logs',
  '/api/drug-master-imports/hot',
  '/api/drug-master-imports/manual-clinical',
  '/api/drug-master-imports/mhlw-generic',
  '/api/drug-master-imports/mhlw-price',
  '/api/drug-master-imports/pmda',
  '/api/drug-master-imports/ssk',
  '/api/drug-master-imports/status',
  '/api/drug-masters',
  '/api/drug-masters/:id',
  '/api/drug-masters/:id/generic-recommendations',
  '/api/drug-masters/:id/ingredient-group',
  '/api/drug-masters/:id/package-insert',
  '/api/drug-masters/batch',
  '/api/external-access',
  '/api/external-access/:id',
  '/api/external-access/:id/self-report',
  '/api/external-professionals',
  '/api/external-professionals/:id',
  '/api/external-professionals/:id/communications',
  '/api/external-professionals/:id/patients',
  '/api/external-professionals/suggestions',
  '/api/facilities',
  '/api/facilities/:id',
  '/api/facilities/:id/contacts',
  '/api/facilities/:id/patients',
  '/api/facility-visit-batches',
  '/api/facility-visit-batches/:id',
  '/api/facility-visit-batches/visit-days',
  '/api/files/:id/download',
  '/api/files/:id/presigned-download',
  '/api/files/complete',
  '/api/files/presigned-upload',
  '/api/first-visit-documents',
  '/api/handoff-board',
  '/api/handoff-board/items',
  '/api/handoff-board/items/:id/read',
  '/api/handoff-board/items/:id/resolve',
  '/api/health',
  '/api/incident-reports',
  '/api/incident-reports/:id',
  '/api/inquiry-records',
  '/api/inquiry-records/:id',
  '/api/interventions',
  '/api/interventions/:id',
  '/api/jobs',
  '/api/jobs/:id',
  '/api/jobs/flush-metrics',
  '/api/management-plans',
  '/api/management-plans/:id',
  '/api/management-plans/:id/pdf',
  '/api/me/activity-summary',
  '/api/me/logout-all',
  '/api/me/mfa/disable',
  '/api/me/mfa/setup',
  '/api/me/mfa/verify',
  '/api/me/org',
  '/api/me/password',
  '/api/me/preferences',
  '/api/me/profile',
  '/api/me/site',
  '/api/me/sites',
  '/api/medication-cycles',
  '/api/medication-cycles/:id/history',
  '/api/medication-cycles/:id/transition',
  '/api/medication-issues',
  '/api/medication-issues/:id',
  '/api/medication-profiles',
  '/api/medication-sets/workspace',
  '/api/meta/route-catalog',
  '/api/notification-rules',
  '/api/notification-rules/:id',
  '/api/notifications',
  '/api/notifications/stream',
  '/api/packaging-methods',
  '/api/packaging-methods/:id',
  '/api/patient-self-reports',
  '/api/patient-self-reports/:id',
  '/api/patients',
  '/api/patients/:id',
  '/api/patients/:id/archive',
  '/api/patients/:id/care-team',
  '/api/patients/:id/communications',
  '/api/patients/:id/conditions',
  '/api/patients/:id/contacts',
  '/api/patients/:id/documents',
  '/api/patients/:id/field-revisions',
  '/api/patients/:id/insurance',
  '/api/patients/:id/insurance/:id',
  '/api/patients/:id/labs',
  '/api/patients/:id/labs/:id',
  '/api/patients/:id/mcs',
  '/api/patients/:id/mcs-sync',
  '/api/patients/:id/medication-calendar/pdf',
  '/api/patients/:id/medications/pdf',
  '/api/patients/:id/overview',
  '/api/patients/:id/packaging',
  '/api/patients/:id/prescriptions',
  '/api/patients/:id/prescriptions/e-prescription',
  '/api/patients/:id/prescriptions/export',
  '/api/patients/:id/qualification-check',
  '/api/patients/:id/readiness',
  '/api/patients/:id/restore',
  '/api/patients/:id/structured-care',
  '/api/patients/:id/timeline',
  '/api/patients/:id/visit-brief',
  '/api/patients/:id/visit-constraints',
  '/api/patients/:id/visit-records/pdf',
  '/api/patients/:id/visits',
  '/api/patients/:id/workflow-preview',
  '/api/patients/board',
  '/api/patients/check-duplicate',
  '/api/patients/export',
  '/api/patients/medications/bulk-export',
  '/api/pca-pump-rentals',
  '/api/pca-pump-rentals/:id',
  '/api/pca-pumps',
  '/api/pca-pumps/:id',
  '/api/pharmacist-shift-templates',
  '/api/pharmacist-shift-templates/:id',
  '/api/pharmacist-shift-templates/apply',
  '/api/pharmacist-shifts',
  '/api/pharmacist-shifts/available',
  '/api/pharmacist-shifts/bulk',
  '/api/pharmacists',
  '/api/pharmacists/:id',
  '/api/pharmacists/import',
  '/api/pharmacy-drug-stock-requests',
  '/api/pharmacy-drug-stock-requests/:id',
  '/api/pharmacy-drug-stock-templates',
  '/api/pharmacy-drug-stock-templates/:id',
  '/api/pharmacy-drug-stock-templates/:id/apply',
  '/api/pharmacy-drug-stocks',
  '/api/pharmacy-drug-stocks/bulk',
  '/api/pharmacy-drug-stocks/copy',
  '/api/pharmacy-drug-stocks/export',
  '/api/pharmacy-drug-stocks/history',
  '/api/pharmacy-drug-stocks/impact',
  '/api/pharmacy-drug-stocks/review',
  '/api/pharmacy-drug-stocks/safety-follow-up',
  '/api/pharmacy-drug-stocks/template',
  '/api/pharmacy-drug-stocks/usage-mismatch',
  '/api/pharmacy-sites',
  '/api/pharmacy-sites/:id',
  '/api/pharmacy-sites/:id/insurance-configs',
  '/api/pharmacy-sites/:id/insurance-configs/:id',
  '/api/phos/:path*',
  '/api/prescriber-institutions',
  '/api/prescriber-institutions/:id',
  '/api/prescriber-institutions/suggestion',
  '/api/prescription-intakes',
  '/api/prescription-intakes/:id',
  '/api/prescription-intakes/facility-batch',
  '/api/prescription-intakes/triage',
  '/api/presence',
  '/api/push-subscription',
  '/api/qr-scan-drafts',
  '/api/qr-scan-drafts/:id',
  '/api/qr-scan-drafts/:id/confirm',
  '/api/residual-medications',
  '/api/saved-views',
  '/api/saved-views/:id',
  '/api/service-areas',
  '/api/service-areas/:id',
  '/api/set-audits',
  '/api/set-batches',
  '/api/set-batches/:id',
  '/api/set-plans',
  '/api/set-plans/:id',
  '/api/set-plans/:id/generate-batches',
  '/api/settings',
  '/api/settings/operational-policy',
  '/api/tasks',
  '/api/tasks/:id',
  '/api/templates',
  '/api/templates/:id',
  '/api/tracing-reports',
  '/api/tracing-reports/:id',
  '/api/tracing-reports/:id/pdf',
  '/api/visit-brief-feedback',
  '/api/visit-preparations/:id',
  '/api/visit-preparations/:id/brief',
  '/api/visit-preparations/brief-batch',
  '/api/visit-records',
  '/api/visit-records/:id',
  '/api/visit-records/:id/handoff',
  '/api/visit-records/:id/handoff/extract',
  '/api/visit-records/:id/pdf',
  '/api/visit-records/:id/reflected-fields',
  '/api/visit-routes',
  '/api/visit-routes/reorder',
  '/api/visit-vehicle-resources',
  '/api/visit-vehicle-resources/:id',
  '/api/visit-schedule-proposals',
  '/api/visit-schedule-proposals/:id',
  '/api/visit-schedule-proposals/billing-preview',
  '/api/visit-schedule-proposals/billing-preview-batch',
  '/api/visit-schedule-proposals/reorder',
  '/api/visit-schedules',
  '/api/visit-schedules/:id',
  '/api/visit-schedules/:id/reopen',
  '/api/visit-schedules/:id/reschedule',
  '/api/visit-schedules/:id/reschedule/approve',
  '/api/visit-schedules/generate',
  '/api/visit-schedules/reorder',
  '/api/visit-schedules/day-board',
  '/api/visit-schedules/today',
  '/api/visits/today-preparation',
  '/api/workflow-exceptions/:id',
] as const;

type CompiledRouteTemplate = {
  template: string;
  segments: string[];
  staticSegmentCount: number;
  catchAllIndex: number;
};

function isRouteParameterSegment(segment: string) {
  return segment.startsWith(':');
}

function isCatchAllRouteSegment(segment: string) {
  return segment.endsWith('*');
}

function getStaticRouteSegmentCount(segments: string[]) {
  return segments.filter((segment) => !isRouteParameterSegment(segment)).length;
}

const compiledApiRouteTemplates: CompiledRouteTemplate[] = API_ROUTE_TEMPLATES.map((template) => {
  const segments = template.split('/').filter(Boolean);
  return {
    template,
    segments,
    staticSegmentCount: getStaticRouteSegmentCount(segments),
    catchAllIndex: segments.findIndex(isCatchAllRouteSegment),
  };
}).sort((left, right) => {
  if (right.staticSegmentCount !== left.staticSegmentCount) {
    return right.staticSegmentCount - left.staticSegmentCount;
  }
  return right.segments.length - left.segments.length;
});

function normalizePathname(pathname: string) {
  const [pathWithoutQuery] = pathname.split('?');
  const collapsed = (pathWithoutQuery || '/').replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

function routeTemplateMatches(template: CompiledRouteTemplate, pathSegments: string[]) {
  if (template.catchAllIndex === -1 && pathSegments.length !== template.segments.length) {
    return false;
  }
  if (template.catchAllIndex !== -1 && pathSegments.length <= template.catchAllIndex) {
    return false;
  }

  return template.segments.every((segment, index) => {
    if (isCatchAllRouteSegment(segment)) return true;
    if (isRouteParameterSegment(segment)) return Boolean(pathSegments[index]);
    return segment === pathSegments[index];
  });
}

export function canonicalizeRateLimitPath(pathname: string) {
  const normalized = normalizePathname(pathname);
  if (normalized !== '/api' && !normalized.startsWith('/api/')) {
    return normalized;
  }

  const pathSegments = normalized.split('/').filter(Boolean);
  const matched = compiledApiRouteTemplates.find((template) =>
    routeTemplateMatches(template, pathSegments),
  );
  return matched?.template ?? UNKNOWN_API_RATE_LIMIT_PATH;
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
