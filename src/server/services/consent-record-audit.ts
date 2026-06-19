import type { AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { normalizeAuditedConsentDocumentUrl } from '@/server/services/consent-record-documents';

type AuditWriter = Parameters<typeof createAuditLogEntry>[0];
type ConsentRecordAuditContext = Pick<
  AuthContext,
  'orgId' | 'userId' | 'role' | 'ipAddress' | 'userAgent'
>;

type ConsentRecordDocumentSubject = {
  document_url?: string | null;
  document_file_id?: string | null;
};

type ConsentRecordAuditSubject = ConsentRecordDocumentSubject & {
  id: string;
  patient_id: string;
  case_id?: string | null;
  consent_type?: string | null;
  method?: string | null;
  is_active?: boolean | null;
  expiry_date?: Date | string | null;
  template_id?: string | null;
  template_version?: number | null;
};

function documentAuditFlags(record: ConsentRecordDocumentSubject) {
  const hasDocumentFile = Boolean(record.document_file_id);
  const safeDocumentUrl = hasDocumentFile
    ? true
    : Boolean(normalizeAuditedConsentDocumentUrl(record.document_url));
  const hasDocumentUrl = Boolean(record.document_url);
  const hasDocument = hasDocumentFile || hasDocumentUrl;
  return {
    has_document_url: hasDocument,
    document_url_audited: safeDocumentUrl,
    document_url_redacted: Boolean(!hasDocumentFile && hasDocumentUrl && !safeDocumentUrl),
    document_source: !hasDocument
      ? 'none'
      : hasDocumentFile
        ? 'file_asset'
        : safeDocumentUrl
          ? 'audited_url'
          : 'legacy_redacted',
  };
}

export function recordConsentRecordsViewedAudit(
  db: AuditWriter,
  ctx: ConsentRecordAuditContext,
  args: {
    patientId: string;
    caseId?: string | null;
    consentType?: string | null;
    isActive: boolean;
    limit: number;
    hasCursor: boolean;
    hasMore: boolean;
    totalCount: number;
    records: Array<Pick<ConsentRecordAuditSubject, 'id' | 'document_url'>>;
  },
) {
  return createAuditLogEntry(db, ctx, {
    action: 'consent_records_viewed',
    targetType: 'patient',
    targetId: args.patientId,
    changes: {
      target_screen: 'patient_consent_records',
      viewer_role: ctx.role,
      actor_org_id: ctx.orgId,
      actor_site_id: null,
      patient_id: args.patientId,
      case_id: args.caseId ?? null,
      consent_type_filter: args.consentType ?? null,
      is_active_filter: args.isActive,
      limit: args.limit,
      has_cursor: args.hasCursor,
      has_more: args.hasMore,
      total_count: args.totalCount,
      viewed_count: args.records.length,
      consent_record_ids: args.records.map((record) => record.id),
      document_counts: {
        present: args.records.filter((record) => record.document_url).length,
        audited: args.records.filter((record) =>
          Boolean(normalizeAuditedConsentDocumentUrl(record.document_url)),
        ).length,
        redacted: args.records.filter(
          (record) =>
            Boolean(record.document_url) &&
            !normalizeAuditedConsentDocumentUrl(record.document_url),
        ).length,
      },
    },
  });
}

export function recordConsentRecordViewedAudit(
  db: AuditWriter,
  ctx: ConsentRecordAuditContext,
  record: ConsentRecordAuditSubject,
) {
  return createAuditLogEntry(db, ctx, {
    action: 'consent_record_viewed',
    targetType: 'consent_record',
    targetId: record.id,
    changes: {
      target_screen: 'patient_consent_record_detail',
      viewer_role: ctx.role,
      actor_org_id: ctx.orgId,
      actor_site_id: null,
      patient_id: record.patient_id,
      case_id: record.case_id ?? null,
      consent_type: record.consent_type ?? null,
      is_active: record.is_active ?? null,
      ...documentAuditFlags(record),
    },
  });
}

export function recordConsentRecordCreatedAudit(
  db: AuditWriter,
  ctx: ConsentRecordAuditContext,
  record: ConsentRecordAuditSubject,
) {
  return createAuditLogEntry(db, ctx, {
    action: 'consent_record_created',
    targetType: 'consent_record',
    targetId: record.id,
    changes: {
      patient_id: record.patient_id,
      case_id: record.case_id ?? null,
      consent_type: record.consent_type ?? null,
      method: record.method ?? null,
      template_id: record.template_id ?? null,
      template_version: record.template_version ?? null,
      has_expiry_date: Boolean(record.expiry_date),
      ...documentAuditFlags(record),
    },
  });
}

export function recordConsentRecordUpdatedAudit(
  db: AuditWriter,
  ctx: ConsentRecordAuditContext,
  args: {
    before: ConsentRecordAuditSubject;
    after: ConsentRecordAuditSubject;
    changedFields: string[];
  },
) {
  return createAuditLogEntry(db, ctx, {
    action: 'consent_record_updated',
    targetType: 'consent_record',
    targetId: args.after.id,
    changes: {
      patient_id: args.after.patient_id,
      case_id: args.after.case_id ?? null,
      consent_type: args.after.consent_type ?? args.before.consent_type ?? null,
      changed_fields: args.changedFields,
      expiry_date_changed: args.changedFields.includes('expiry_date'),
      document_url_changed: args.changedFields.includes('document_url'),
      has_expiry_date_after: Boolean(args.after.expiry_date),
      has_document_url_after: Boolean(args.after.document_file_id || args.after.document_url),
      document_source: documentAuditFlags(args.after).document_source,
      before: {
        has_expiry_date: Boolean(args.before.expiry_date),
        ...documentAuditFlags(args.before),
      },
      after: {
        has_expiry_date: Boolean(args.after.expiry_date),
        ...documentAuditFlags(args.after),
      },
    },
  });
}
