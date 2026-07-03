import 'server-only';
import { Prisma } from '@prisma/client';

/**
 * Audit actions for the platform break-glass console. Every cross-tenant access
 * and every session lifecycle event is recorded to AuditLog. The access itself
 * is LOGGED — it does not bypass the audit trail.
 */
export const BREAK_GLASS_ACTIVATE_ACTION = 'break_glass_activate';
export const BREAK_GLASS_REVOKE_ACTION = 'break_glass_revoke';
export const BREAK_GLASS_READ_ACTION = 'break_glass_read';
export const BREAK_GLASS_WRITE_ACTION = 'break_glass_write';

type AuditLogWriter = {
  auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
};

export type BreakGlassAuditInput = {
  sessionId: string;
  /** The operator's User.id — recorded as the acting actor. */
  operatorUserId: string;
  /** Tenant being accessed; the audit row is scoped to this org. */
  targetOrgId: string;
  action: string;
  targetType: string;
  targetId: string;
  /** Operator-entered justification (not PHI). */
  reason: string;
  scope: string;
  patientId?: string;
  /**
   * Non-PHI descriptor of what was accessed (table/view names, row counts).
   * Never put record body/PHI values here.
   */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Writes one break-glass AuditLog row. MUST be called inside a transaction whose
 * RLS context is set to `targetOrgId` (AuditLog is FORCE-RLS scoped to
 * app.current_org_id), i.e. from within {@link withBreakGlassOrgContext}.
 *
 * This is deliberately NOT best-effort: it throws on failure so the enclosing
 * transaction rolls back and un-audited access is impossible (fail-closed audit).
 */
export async function recordBreakGlassAudit(
  tx: AuditLogWriter,
  input: BreakGlassAuditInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      org_id: input.targetOrgId,
      actor_id: input.operatorUserId,
      actor_pharmacy_id: input.targetOrgId,
      patient_id: input.patientId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      changes: {
        break_glass_session_id: input.sessionId,
        reason: input.reason,
        scope: input.scope,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      } as Prisma.InputJsonValue,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    },
  });
}
