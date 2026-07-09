import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';

export type SecurityEventType =
  | 'auth_failure'
  | 'csrf_rejected'
  | 'rate_limit_exceeded'
  | 'rls_context_missing'
  | 'unauthorized_access'
  | 'session_expired'
  | 'org_switch';

interface SecurityEvent {
  event_type: SecurityEventType;
  ip_address?: string;
  user_id?: string;
  org_id?: string;
  path: string;
  method: string;
  user_agent?: string;
  details?: Record<string, unknown>;
}

const ANONYMOUS_ACTOR_ID = 'anonymous';
const SAFE_APP_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const SECURITY_EVENT_TX_TIMEOUT_MS = 3000;
const SECURITY_EVENT_TX_MAX_WAIT_MS = 2000;
const SAFE_DETAIL_KEYS = new Set(['reason', 'required', 'role', 'reset_at']);

// ---------------------------------------------------------------------------
// Fix 3: Deduplication throttle — prevents DoS via log flooding
// ---------------------------------------------------------------------------

/** Expiry timestamp (epoch ms) keyed by event fingerprint. */
const recentlyLogged = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

async function setLocalConfig(
  tx: Prisma.TransactionClient,
  key: string,
  value?: string,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT set_config(${key}, ${value ?? ''}, true)`);
}

function resolveSafeOrgId(event: SecurityEvent): string | null {
  const orgId = event.org_id?.trim();
  if (!orgId) {
    logger.error({
      event: 'security_event.audit_log_org_unknown',
      entityType: 'security_event',
      code: event.event_type,
      method: event.method,
      operation: 'audit_log_create',
      status: 'skipped',
    });
    return null;
  }

  if (!SAFE_APP_ID_PATTERN.test(orgId)) {
    logger.error({
      event: 'security_event.audit_log_invalid_org',
      entityType: 'security_event',
      code: event.event_type,
      method: event.method,
      operation: 'audit_log_create',
      status: 'skipped',
    });
    return null;
  }

  return orgId;
}

function sanitizePathForAudit(path: string): string {
  const pathname = path.split(/[?#]/, 1)[0] || '/';
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  const segments = collapsed
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (!/^[A-Za-z0-9_.:@-]+$/.test(segment)) return ':value';
      if (/^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(segment)) return ':id';
      if (/^[a-z]+_[A-Za-z0-9_-]{6,}$/.test(segment)) return ':id';
      if (segment.length >= 16 && /\d/.test(segment)) return ':id';
      return segment;
    });

  return segments.length ? `/${segments.join('/')}` : '/';
}

function readSafeDetailValue(value: unknown): string | number | boolean | undefined {
  if (value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return /^[A-Za-z0-9_.:/@-]{1,160}$/.test(trimmed) ? trimmed : 'redacted';
}

function buildSafeChanges(event: SecurityEvent): Prisma.InputJsonObject {
  const changes: Record<string, Prisma.InputJsonValue> = { method: event.method };
  for (const [key, value] of Object.entries(event.details ?? {})) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    const safeValue = readSafeDetailValue(value);
    if (safeValue !== undefined) {
      changes[key] = safeValue;
    }
  }
  return changes;
}

async function persistSecurityEvent(event: SecurityEvent): Promise<void> {
  const orgId = resolveSafeOrgId(event);
  if (!orgId) return;

  const actorId = event.user_id ?? ANONYMOUS_ACTOR_ID;
  const targetId = sanitizePathForAudit(event.path);
  await prisma.$transaction(
    async (tx) => {
      await setLocalConfig(tx, 'app.current_org_id', orgId);
      await setLocalConfig(tx, 'app.rls_context_applied', 'true');
      await setLocalConfig(tx, 'app.current_actor_id', actorId);
      await setLocalConfig(tx, 'app.current_ip_address', event.ip_address);
      await setLocalConfig(tx, 'app.current_user_agent', event.user_agent);

      await tx.auditLog.create({
        data: {
          org_id: orgId,
          actor_id: actorId,
          action: `security:${event.event_type}`,
          target_type: 'security_event',
          target_id: targetId,
          ip_address: event.ip_address,
          user_agent: event.user_agent,
          changes: buildSafeChanges(event),
        },
      });
    },
    { maxWait: SECURITY_EVENT_TX_MAX_WAIT_MS, timeout: SECURITY_EVENT_TX_TIMEOUT_MS },
  );
}

/**
 * Records a security event to AuditLog.
 * Fire-and-forget — never blocks the request path.
 * Identical events (same org + type + IP + sanitized path) are deduplicated within a 60s window.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  const orgScope = event.org_id?.trim() || 'unknown';
  const key = `${orgScope}:${event.event_type}:${event.ip_address ?? ''}:${sanitizePathForAudit(event.path)}`;
  const now = Date.now();

  if ((recentlyLogged.get(key) ?? 0) > now) return;
  recentlyLogged.set(key, now + DEDUP_WINDOW_MS);

  // Lazy cleanup: evict stale entries when the map grows large
  if (recentlyLogged.size > 1000) {
    for (const [k, exp] of recentlyLogged) {
      if (exp <= now) recentlyLogged.delete(k);
    }
  }

  void persistSecurityEvent(event).catch((err: unknown) => {
    logger.error(
      {
        event: 'security_event.audit_log_persist_failed',
        entityType: 'security_event',
        code: event.event_type,
        method: event.method,
        operation: 'audit_log_create',
      },
      err,
    );
  });
}

export function __resetSecurityEventDedupForTest(): void {
  if (process.env.NODE_ENV !== 'production') {
    recentlyLogged.clear();
  }
}
