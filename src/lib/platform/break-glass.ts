import 'server-only';
import {
  BreakGlassScope,
  BreakGlassStatus,
  MemberRole,
  PlatformOperatorRole,
  Prisma,
  type BreakGlassSession,
} from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  runWithRequestAuthContext,
  type RequestAuthContext,
} from '@/lib/auth/request-context';
import {
  BREAK_GLASS_ACTIVATE_ACTION,
  BREAK_GLASS_READ_ACTION,
  BREAK_GLASS_REVOKE_ACTION,
  BREAK_GLASS_WRITE_ACTION,
  recordBreakGlassAudit,
  type BreakGlassAuditInput,
} from '@/lib/audit/break-glass-audit';
import { platformRoleAtLeast, type PlatformOperatorContext } from './operator';

/** Default break-glass session lifetime: 30 minutes (time-boxed access). */
export const BREAK_GLASS_DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Hard cap on a requested session lifetime. */
export const BREAK_GLASS_MAX_TTL_MS = 60 * 60 * 1000;

export type BreakGlassAccessErrorCode =
  | 'no_session'
  | 'expired'
  | 'revoked'
  | 'scope_denied'
  | 'operator_mismatch'
  | 'org_mismatch';

/** Thrown when a break-glass session cannot authorize the requested access. */
export class BreakGlassAccessError extends Error {
  readonly code: BreakGlassAccessErrorCode;
  constructor(code: BreakGlassAccessErrorCode, message: string) {
    super(message);
    this.name = 'BreakGlassAccessError';
    this.code = code;
  }
}

/**
 * Builds the synthetic RLS request context for a break-glass access. The org is
 * pinned to the authorized `targetOrgId` so RLS scopes visibility to exactly one
 * tenant (no BYPASSRLS). `role` is admin only as RLS/audit session metadata — the
 * break-glass nature is captured explicitly by the audit action, and the actor
 * is the operator's own user id.
 */
function buildBreakGlassRequestContext(
  operator: PlatformOperatorContext,
  targetOrgId: string,
): RequestAuthContext {
  return {
    userId: operator.userId,
    orgId: targetOrgId,
    role: MemberRole.admin,
    actorPharmacyId: targetOrgId,
    ipAddress: operator.ipAddress,
    userAgent: operator.userAgent,
  };
}

function assertSessionUsable(
  operator: PlatformOperatorContext,
  session: BreakGlassSession,
  targetOrgId: string,
  requireWrite: boolean,
  now: Date,
): void {
  if (session.operator_id !== operator.operatorId) {
    throw new BreakGlassAccessError('operator_mismatch', 'このブレークグラスセッションは別の運営者のものです');
  }
  if (session.target_org_id !== targetOrgId) {
    throw new BreakGlassAccessError('org_mismatch', 'セッションの対象テナントが一致しません');
  }
  if (session.status === BreakGlassStatus.revoked) {
    throw new BreakGlassAccessError('revoked', 'このブレークグラスセッションは取り消されています');
  }
  if (session.status !== BreakGlassStatus.active || session.expires_at.getTime() <= now.getTime()) {
    throw new BreakGlassAccessError('expired', 'このブレークグラスセッションは失効しています');
  }
  if (requireWrite && session.scope !== BreakGlassScope.read_write) {
    throw new BreakGlassAccessError('scope_denied', 'このセッションは読み取り専用です');
  }
}

/**
 * Runs `fn` against the break-glass target tenant with RLS scoped to that org,
 * then writes a break-glass AuditLog row in the SAME transaction. If the audit
 * write fails the transaction rolls back, so no un-audited access is possible.
 */
export async function withBreakGlassOrgContext<T>(
  operator: PlatformOperatorContext,
  session: BreakGlassSession,
  access: {
    requireWrite?: boolean;
    targetType: string;
    targetId: string;
    patientId?: string;
    metadata?: Record<string, unknown>;
  },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const requireWrite = access.requireWrite ?? false;
  assertSessionUsable(operator, session, session.target_org_id, requireWrite, new Date());

  const requestContext = buildBreakGlassRequestContext(operator, session.target_org_id);
  return withOrgContext(
    session.target_org_id,
    async (tx) => {
      const result = await fn(tx);
      const audit: BreakGlassAuditInput = {
        sessionId: session.id,
        operatorUserId: operator.userId,
        targetOrgId: session.target_org_id,
        action: requireWrite ? BREAK_GLASS_WRITE_ACTION : BREAK_GLASS_READ_ACTION,
        targetType: access.targetType,
        targetId: access.targetId,
        reason: session.reason,
        scope: session.scope,
        patientId: access.patientId,
        metadata: access.metadata,
        ipAddress: operator.ipAddress,
        userAgent: operator.userAgent,
      };
      await recordBreakGlassAudit(tx, audit);
      return result;
    },
    { requestContext },
  );
}

/**
 * Writes a single break-glass audit row in the target-org RLS context, in its
 * own short transaction. Fail-closed: throws if the audit write fails. Use this
 * to audit an access BEFORE reusing an existing org-scoped read service (see
 * {@link readViaBreakGlass}); use {@link withBreakGlassOrgContext} when the read
 * and its audit should share one transaction.
 */
export async function auditBreakGlassAccess(
  operator: PlatformOperatorContext,
  session: BreakGlassSession,
  access: {
    action: string;
    targetType: string;
    targetId: string;
    patientId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const requestContext = buildBreakGlassRequestContext(operator, session.target_org_id);
  await withOrgContext(
    session.target_org_id,
    (tx) =>
      recordBreakGlassAudit(tx, {
        sessionId: session.id,
        operatorUserId: operator.userId,
        targetOrgId: session.target_org_id,
        action: access.action,
        targetType: access.targetType,
        targetId: access.targetId,
        reason: session.reason,
        scope: session.scope,
        patientId: access.patientId,
        metadata: access.metadata,
        ipAddress: operator.ipAddress,
        userAgent: operator.userAgent,
      }),
    { requestContext },
  );
}

/**
 * Authorizes + audits a cross-tenant READ, then runs `reader` under the
 * break-glass request context so any nested `withOrgContext(targetOrgId, …)`
 * (e.g. inside an existing data-explorer service) matches the pinned org and
 * scopes to exactly that tenant via RLS. Audit is written first (fail-closed):
 * the reader never runs if the access cannot be recorded.
 */
export async function readViaBreakGlass<T>(
  operator: PlatformOperatorContext,
  session: BreakGlassSession,
  access: { targetType: string; targetId: string; patientId?: string; metadata?: Record<string, unknown> },
  reader: () => Promise<T>,
): Promise<T> {
  assertSessionUsable(operator, session, session.target_org_id, false, new Date());
  await auditBreakGlassAccess(operator, session, { action: BREAK_GLASS_READ_ACTION, ...access });
  return runWithRequestAuthContext(
    buildBreakGlassRequestContext(operator, session.target_org_id),
    reader,
  );
}

/** API-safe view of a break-glass session (no internal-only fields to strip today,
 * but centralizes the shape and ISO-serializes dates for responses). */
export function serializeBreakGlassSession(session: BreakGlassSession) {
  return {
    id: session.id,
    target_org_id: session.target_org_id,
    reason: session.reason,
    reference_ticket: session.reference_ticket,
    scope: session.scope,
    status: session.status,
    granted_at: session.granted_at.toISOString(),
    expires_at: session.expires_at.toISOString(),
    revoked_at: session.revoked_at ? session.revoked_at.toISOString() : null,
  };
}

/** Returns the newest active, non-expired session for (operator, targetOrg), or null. */
export async function getActiveBreakGlassSession(
  operatorId: string,
  targetOrgId: string,
): Promise<BreakGlassSession | null> {
  return prisma.breakGlassSession.findFirst({
    where: {
      operator_id: operatorId,
      target_org_id: targetOrgId,
      status: BreakGlassStatus.active,
      expires_at: { gt: new Date() },
    },
    orderBy: { granted_at: 'desc' },
  });
}

/** Lists the operator's currently-active (non-expired) sessions. */
export async function listActiveBreakGlassSessions(
  operatorId: string,
): Promise<BreakGlassSession[]> {
  return prisma.breakGlassSession.findMany({
    where: {
      operator_id: operatorId,
      status: BreakGlassStatus.active,
      expires_at: { gt: new Date() },
    },
    orderBy: { granted_at: 'desc' },
  });
}

export type CreateBreakGlassSessionInput = {
  operator: PlatformOperatorContext;
  targetOrgId: string;
  reason: string;
  referenceTicket?: string;
  scope?: BreakGlassScope;
  /** When the operator completed step-up MFA re-authentication. */
  mfaVerifiedAt: Date;
  ttlMs?: number;
};

/**
 * Creates a time-boxed break-glass session after the caller has verified the
 * operator's step-up MFA. Validates that the target tenant exists, records an
 * activate audit row, and returns the session. Only platform_admin+ may open a
 * read_write session.
 */
export async function createBreakGlassSession(
  input: CreateBreakGlassSessionInput,
): Promise<BreakGlassSession> {
  const { operator, targetOrgId, reason, referenceTicket, mfaVerifiedAt } = input;
  const scope = input.scope ?? BreakGlassScope.read_only;

  if (scope === BreakGlassScope.read_write && !platformRoleAtLeast(operator.role, PlatformOperatorRole.platform_admin)) {
    throw new BreakGlassAccessError('scope_denied', '書き込みブレークグラスには platform_admin 以上が必要です');
  }

  const org = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true },
  });
  if (!org) {
    throw new BreakGlassAccessError('org_mismatch', '対象テナントが見つかりません');
  }

  const ttlMs = Math.min(input.ttlMs ?? BREAK_GLASS_DEFAULT_TTL_MS, BREAK_GLASS_MAX_TTL_MS);
  const expiresAt = new Date(Date.now() + ttlMs);

  const session = await prisma.breakGlassSession.create({
    data: {
      operator_id: operator.operatorId,
      target_org_id: targetOrgId,
      reason,
      reference_ticket: referenceTicket,
      scope,
      mfa_verified_at: mfaVerifiedAt,
      expires_at: expiresAt,
      status: BreakGlassStatus.active,
      ip_address: operator.ipAddress,
      user_agent: operator.userAgent,
    },
  });

  await auditBreakGlassAccess(operator, session, {
    action: BREAK_GLASS_ACTIVATE_ACTION,
    targetType: 'break_glass_session',
    targetId: session.id,
    metadata: {
      reference_ticket: referenceTicket ?? null,
      expires_at: expiresAt.toISOString(),
    },
  });

  return session;
}

/**
 * Revokes a break-glass session. An operator may revoke their own session; a
 * platform_owner may revoke any operator's session (emergency separation of
 * duties). Returns the updated session, or null when not found / not permitted.
 */
export async function revokeBreakGlassSession(
  operator: PlatformOperatorContext,
  sessionId: string,
): Promise<BreakGlassSession | null> {
  const existing = await prisma.breakGlassSession.findUnique({ where: { id: sessionId } });
  if (!existing) return null;

  const isOwnSession = existing.operator_id === operator.operatorId;
  const canRevokeOthers = platformRoleAtLeast(operator.role, PlatformOperatorRole.platform_owner);
  if (!isOwnSession && !canRevokeOthers) return null;

  if (existing.status !== BreakGlassStatus.active) return existing;

  const updated = await prisma.breakGlassSession.update({
    where: { id: sessionId },
    data: {
      status: BreakGlassStatus.revoked,
      revoked_at: new Date(),
      revoked_by: operator.userId,
    },
  });

  await auditBreakGlassAccess(operator, updated, {
    action: BREAK_GLASS_REVOKE_ACTION,
    targetType: 'break_glass_session',
    targetId: updated.id,
    metadata: {
      revoked_by: operator.userId,
      was_own_session: isOwnSession,
    },
  });

  return updated;
}
