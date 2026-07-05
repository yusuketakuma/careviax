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
        actor_pharmacy_id?: string;
        actor_site_id?: string;
        patient_id?: string;
        changes?: Prisma.InputJsonValue;
        ip_address?: string;
        user_agent?: string;
      };
    }) => Promise<unknown>;
  };
};

const blockedAuditKeyPattern =
  /(patient_?ids?|patientIds?|storage_?key|object_?key|token|secret|url|href|raw|error|stack|address|phone|insurance|note|memo|text|body|content)/i;
const blockedAuditValuePattern =
  /(token=|secret|https?:\/\/|signed\.|storageKey|objectKey|provider raw error|\d{2,4}-\d{2,4}-\d{3,4}|保険者番号)/i;
const safePatientAggregateKeys = new Set([
  'patient_count',
  'patient_selection_hash',
  'requested_count',
  'success_count',
  'failed_count',
  'exported_patient_count',
  'exported_patient_id_hashes',
  'exported_patient_id_hashes_truncated',
]);

const allowedFilterKeysByTarget = new Map<string, Set<string>>([
  [
    'audit_log',
    new Set([
      'actor',
      'actorPharmacy',
      'actorSite',
      'patient',
      'targetType',
      'action',
      'from',
      'to',
    ]),
  ],
  ['patient_list', new Set(['case_status', 'truncated'])],
  ['patients', new Set(['status'])],
  ['prescription_history', new Set(['intake_count', 'truncated'])],
  [
    'billing_candidate',
    new Set(['month', 'status', 'review_state', 'resolution_state', 'truncated']),
  ],
  [
    'communication_request',
    new Set([
      'status',
      'request_type',
      'profile',
      'redaction_profile',
      'care_report_rows_excluded',
      'truncated',
      'from',
      'to',
    ]),
  ],
  ['pharmacy_drug_stock', new Set(['purpose'])],
]);

const allowedMetadataKeysByTarget = new Map<string, Set<string>>([
  [
    'medication_history',
    new Set([
      'job_id',
      'file_id',
      'status',
      'patient_count',
      'requested_count',
      'success_count',
      'failed_count',
      'failure_codes',
      'patient_selection_hash',
    ]),
  ],
  ['file_asset', new Set(['file_purpose', 'mime_type', 'size_bytes'])],
  ['billing_candidate', new Set(['export_format'])],
  ['patients', new Set(['source'])],
  ['patient_list', new Set(['source'])],
  [
    'communication_request',
    new Set([
      'export_snapshot_id',
      'exported_request_id_hashes',
      'exported_request_count',
      'exported_request_id_hashes_truncated',
      'exported_patient_id_hashes',
      'exported_patient_count',
      'exported_patient_id_hashes_truncated',
    ]),
  ],
  ['pharmacy_drug_stock', new Set(['source'])],
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBlockedAuditKey(key: string) {
  return !safePatientAggregateKeys.has(key) && blockedAuditKeyPattern.test(key);
}

function sanitizeAuditScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    if (blockedAuditValuePattern.test(value)) return undefined;
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return undefined;
}

function sanitizeAuditValue(value: unknown): unknown {
  const scalar = sanitizeAuditScalar(value);
  if (scalar !== undefined) return scalar;

  if (Array.isArray(value)) {
    const sanitizedValues = value
      .map((item) => sanitizeAuditScalar(item))
      .filter((item) => item !== undefined);
    return sanitizedValues.length === value.length ? sanitizedValues : undefined;
  }

  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isBlockedAuditKey(key)) continue;
      const sanitizedValue = sanitizeAuditValue(item);
      if (sanitizedValue !== undefined) {
        sanitized[key] = sanitizedValue;
      }
    }

    return sanitized;
  }

  return undefined;
}

function sanitizeAuditRecord(
  targetType: string,
  values: Record<string, unknown> | undefined,
  allowedKeysByTarget: Map<string, Set<string>>,
) {
  if (!values) return {};
  const allowedKeys = allowedKeysByTarget.get(targetType);
  if (!allowedKeys) return {};
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (isBlockedAuditKey(key)) continue;
    if (allowedKeys && !allowedKeys.has(key)) continue;
    const sanitizedValue = sanitizeAuditValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}

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
      filters: sanitizeAuditRecord(args.targetType, args.filters, allowedFilterKeysByTarget),
      metadata: sanitizeAuditRecord(args.targetType, args.metadata, allowedMetadataKeysByTarget),
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
    action?: string;
  },
) {
  await db.auditLog.create({
    data: {
      org_id: args.orgId,
      actor_id: args.actorId,
      actor_pharmacy_id: args.actorPharmacyId ?? args.orgId,
      actor_site_id: args.actorSiteId,
      patient_id: args.patientId,
      action: args.action ?? 'export',
      target_type: args.targetType,
      target_id: args.targetId ?? 'bulk',
      changes: buildDataExportAuditChanges(args),
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
    actorPharmacyId?: string;
    actorSiteId?: string;
    patientId?: string;
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
      actor_pharmacy_id: args.actorPharmacyId ?? args.orgId,
      actor_site_id: args.actorSiteId,
      patient_id: args.patientId,
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
