import type { Prisma } from '@prisma/client';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { sanitizeExportAuditSection } from '@/lib/audit/export-audit-sanitizer';
import { normalizeJsonInput } from '@/lib/db/json';

type AuditClient = {
  auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
};

export function buildDataExportAuditChanges(args: {
  targetType: string;
  format: 'csv' | 'json' | 'zip' | 'pdf' | 'print' | 'claims-xml' | 'file';
  recordCount?: number;
  filters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  return (
    normalizeJsonInput({
      format: args.format,
      record_count: args.recordCount ?? null,
      filters: sanitizeExportAuditSection({
        targetType: args.targetType,
        values: args.filters,
        section: 'filters',
      }),
      metadata: sanitizeExportAuditSection({
        targetType: args.targetType,
        values: args.metadata,
        section: 'metadata',
      }),
    }) ?? {}
  );
}

export async function recordDataExportAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    actorPharmacyId?: string;
    actorSiteId?: string;
    patientId?: string;
    targetType: string;
    targetId?: string;
    format: 'csv' | 'json' | 'zip' | 'pdf' | 'print' | 'claims-xml' | 'file';
    recordCount?: number;
    filters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    correlationId?: string;
    action?: string;
  },
) {
  await createAuditLogEntry(
    db,
    {
      orgId: args.orgId,
      userId: args.actorId,
      actorPharmacyId: args.actorPharmacyId,
      actorSiteId: args.actorSiteId,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
      requestId: args.requestId,
      correlationId: args.correlationId,
    },
    {
      action: args.action ?? 'export',
      targetType: args.targetType,
      targetId: args.targetId ?? 'bulk',
      patientId: args.patientId,
      changes: buildDataExportAuditChanges(args),
    },
  );
}

export async function recordCareReportPrintAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    actorPharmacyId?: string;
    actorSiteId?: string;
    patientId?: string;
    reportId: string;
    intent: 'preview_rendered' | 'print_requested';
    reportUpdatedAt: Date;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    correlationId?: string;
  },
) {
  await createAuditLogEntry(
    db,
    {
      orgId: args.orgId,
      userId: args.actorId,
      actorPharmacyId: args.actorPharmacyId,
      actorSiteId: args.actorSiteId,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
      requestId: args.requestId,
      correlationId: args.correlationId,
    },
    {
      patientId: args.patientId,
      action:
        args.intent === 'preview_rendered'
          ? 'care_report_print_previewed'
          : 'care_report_print_requested',
      targetType: 'care_report',
      targetId: args.reportId,
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
    },
  );
}
