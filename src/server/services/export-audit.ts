import type { Prisma } from '@prisma/client';

type AuditClient = {
  auditLog: {
    create: (args: {
      data: {
        org_id: string;
        actor_id: string;
        action: string;
        target_type: string;
        target_id: string;
        changes?: Prisma.InputJsonValue;
        ip_address?: string;
        user_agent?: string;
      };
    }) => Promise<unknown>;
  };
};

export async function recordDataExportAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    targetType: string;
    targetId?: string;
    format: 'csv' | 'json' | 'zip';
    recordCount?: number;
    filters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  await db.auditLog.create({
    data: {
      org_id: args.orgId,
      actor_id: args.actorId,
      action: 'export',
      target_type: args.targetType,
      target_id: args.targetId ?? 'bulk',
      changes: {
        format: args.format,
        record_count: args.recordCount ?? null,
        filters: (args.filters ?? {}) as Prisma.InputJsonValue,
        metadata: (args.metadata ?? {}) as Prisma.InputJsonValue,
      } satisfies Prisma.InputJsonValue,
      ip_address: args.ipAddress,
      user_agent: args.userAgent,
    },
  });
}
