import type { Prisma } from '@prisma/client';
import { normalizeJsonInput } from '@/lib/db/json';

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
    format: 'csv' | 'json' | 'zip' | 'pdf' | 'print' | 'claims-xml';
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
      changes:
        normalizeJsonInput({
          format: args.format,
          record_count: args.recordCount ?? null,
          filters: args.filters ?? {},
          metadata: args.metadata ?? {},
        }) ?? {},
      ip_address: args.ipAddress,
      user_agent: args.userAgent,
    },
  });
}

export async function recordCareReportPrintAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    reportId: string;
    intent: 'preview_rendered' | 'print_requested';
    reportUpdatedAt: Date;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  await db.auditLog.create({
    data: {
      org_id: args.orgId,
      actor_id: args.actorId,
      action:
        args.intent === 'preview_rendered'
          ? 'care_report_print_previewed'
          : 'care_report_print_requested',
      target_type: 'care_report',
      target_id: args.reportId,
      changes:
        normalizeJsonInput({
          format: 'print',
          metadata: {
            surface:
              args.intent === 'preview_rendered'
                ? 'care_report_print_preview'
                : 'care_report_print_requested',
            print_audit_intent: args.intent,
            report_updated_at: args.reportUpdatedAt.toISOString(),
          },
        }) ?? {},
      ip_address: args.ipAddress,
      user_agent: args.userAgent,
    },
  });
}
