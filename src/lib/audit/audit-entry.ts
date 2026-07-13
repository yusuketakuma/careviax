import { Prisma } from '@prisma/client';
import { isValidRequestTraceId } from '@/lib/api/request-correlation';
import type { AuthContext } from '@/lib/auth/context';

type AuditLogWriter = {
  auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
};

type CreateAuditLogEntryInput = {
  action: string;
  targetType: string;
  targetId: string;
  patientId?: string;
  changes?: Prisma.InputJsonValue;
};

type AuditActorContext = Pick<
  AuthContext,
  | 'orgId'
  | 'userId'
  | 'actorPharmacyId'
  | 'actorSiteId'
  | 'ipAddress'
  | 'userAgent'
  | 'requestId'
  | 'correlationId'
>;

function isMergeableInputJsonObject(value: Prisma.InputJsonValue): value is Prisma.InputJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  return !('toJSON' in value && typeof value.toJSON === 'function');
}

function withRequestTrace(
  changes: Prisma.InputJsonValue | undefined,
  ctx: AuditActorContext,
): Prisma.InputJsonValue | undefined {
  const requestTrace: Prisma.InputJsonObject = {
    ...(isValidRequestTraceId(ctx.requestId) ? { request_id: ctx.requestId } : {}),
    ...(isValidRequestTraceId(ctx.correlationId) ? { correlation_id: ctx.correlationId } : {}),
  };

  if (changes === undefined) {
    return Object.keys(requestTrace).length === 0 ? undefined : { request_trace: requestTrace };
  }
  if (!isMergeableInputJsonObject(changes)) return changes;

  if (Object.keys(requestTrace).length === 0) {
    return Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'request_trace'));
  }

  return { ...changes, request_trace: requestTrace };
}

export function createAuditLogEntry(
  tx: AuditLogWriter,
  ctx: AuditActorContext,
  input: CreateAuditLogEntryInput,
) {
  return tx.auditLog.create({
    data: {
      org_id: ctx.orgId,
      actor_id: ctx.userId,
      actor_pharmacy_id: ctx.actorPharmacyId ?? ctx.orgId,
      actor_site_id: ctx.actorSiteId,
      patient_id: input.patientId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      changes: withRequestTrace(input.changes, ctx),
      ip_address: ctx.ipAddress,
      user_agent: ctx.userAgent,
    },
  });
}
