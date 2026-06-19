import { Prisma } from '@prisma/client';
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
  'orgId' | 'userId' | 'actorPharmacyId' | 'actorSiteId' | 'ipAddress' | 'userAgent'
>;

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
      changes: input.changes,
      ip_address: ctx.ipAddress,
      user_agent: ctx.userAgent,
    },
  });
}
