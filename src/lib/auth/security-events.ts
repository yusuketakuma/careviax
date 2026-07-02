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
  details?: Record<string, unknown>;
}

const SYSTEM_ORG_ID = 'system';
const ANONYMOUS_ACTOR_ID = 'anonymous';

// ---------------------------------------------------------------------------
// Fix 3: Deduplication throttle — prevents DoS via log flooding
// ---------------------------------------------------------------------------

/** Expiry timestamp (epoch ms) keyed by event fingerprint. */
const recentlyLogged = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

/**
 * Records a security event to AuditLog.
 * Fire-and-forget — never blocks the request path.
 * Identical events (same type + IP + path) are deduplicated within a 60s window.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  const key = `${event.event_type}:${event.ip_address ?? ''}:${event.path}`;
  const now = Date.now();

  if ((recentlyLogged.get(key) ?? 0) > now) return;
  recentlyLogged.set(key, now + DEDUP_WINDOW_MS);

  // Lazy cleanup: evict stale entries when the map grows large
  if (recentlyLogged.size > 1000) {
    for (const [k, exp] of recentlyLogged) {
      if (exp <= now) recentlyLogged.delete(k);
    }
  }

  const auditLogClient = (prisma as { auditLog?: typeof prisma.auditLog }).auditLog;
  if (!auditLogClient?.create) {
    return;
  }

  auditLogClient
    .create({
      data: {
        org_id: event.org_id ?? SYSTEM_ORG_ID,
        actor_id: event.user_id ?? ANONYMOUS_ACTOR_ID,
        action: `security:${event.event_type}`,
        target_type: 'security_event',
        target_id: event.path,
        ip_address: event.ip_address,
        changes: {
          method: event.method,
          ...event.details,
        },
      },
    })
    .catch((err: unknown) => {
      // Silently absorb — security logging must not propagate errors
      logger.warn(
        {
          event: 'security_event.audit_log_failed',
          entityType: 'security_event',
          code: event.event_type,
          method: event.method,
        },
        err,
      );
    });
}
