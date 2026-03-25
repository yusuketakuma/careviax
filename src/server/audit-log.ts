import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function createAuditLog(params: {
  orgId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  return prisma.auditLog.create({
    data: {
      org_id: params.orgId,
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      changes: params.changes as Prisma.InputJsonValue | undefined,
      ip_address: params.ipAddress,
      user_agent: params.userAgent,
    },
  });
}
