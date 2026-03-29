import { prisma } from '@/lib/db/client';

export type SecurityEventType =
  | 'auth_failure'
  | 'csrf_rejected'
  | 'rate_limit_exceeded'
  | 'rls_context_missing'
  | 'unauthorized_access'
  | 'session_expired';

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

/**
 * Records a security event to AuditLog.
 * Fire-and-forget — never blocks the request path.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  prisma.auditLog
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
      console.error('[security-event] Failed to log:', event.event_type, event.path, err);
    });
}
