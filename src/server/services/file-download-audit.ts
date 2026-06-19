import type { recordDataExportAudit } from '@/server/services/export-audit';
import { recordDataExportAudit as writeDataExportAudit } from '@/server/services/export-audit';

type AuditClient = Parameters<typeof recordDataExportAudit>[0];
type FileDownloadContextClient = {
  patientShareConsent: {
    findFirst: (args: {
      where: {
        org_id: string;
        file_asset_id: string;
      };
      select: {
        id: true;
        share_case_id: true;
        consent_record_id: true;
        valid_until: true;
        revoked_at: true;
      };
      orderBy: { created_at: 'desc' };
    }) => Promise<{
      id: string;
      share_case_id: string;
      consent_record_id: string | null;
      valid_until: Date | null;
      revoked_at: Date | null;
    } | null>;
  };
};

export type FileDownloadAuditResponseMode = 'json' | 'redirect';
export type FileDownloadConsentAttachmentContext = {
  patientShareConsentId: string;
  shareCaseId: string;
  hasConsentRecord: boolean;
  hasValidUntil: boolean;
  consentRevoked: boolean;
};

export async function resolveFileDownloadAuditContext(
  db: FileDownloadContextClient,
  args: {
    orgId: string;
    fileId: string;
  },
): Promise<FileDownloadConsentAttachmentContext | undefined> {
  const consent = await db.patientShareConsent.findFirst({
    where: {
      org_id: args.orgId,
      file_asset_id: args.fileId,
    },
    select: {
      id: true,
      share_case_id: true,
      consent_record_id: true,
      valid_until: true,
      revoked_at: true,
    },
    orderBy: { created_at: 'desc' },
  });

  if (!consent) return undefined;
  return {
    patientShareConsentId: consent.id,
    shareCaseId: consent.share_case_id,
    hasConsentRecord: Boolean(consent.consent_record_id),
    hasValidUntil: Boolean(consent.valid_until),
    consentRevoked: Boolean(consent.revoked_at),
  };
}

export async function recordFileDownloadAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    fileId: string;
    purpose: string;
    mimeType: string;
    sizeBytes: number;
    expiresIn: number;
    surface: 'files_download' | 'files_presigned_download';
    responseMode: FileDownloadAuditResponseMode;
    consentAttachmentContext?: FileDownloadConsentAttachmentContext;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  await writeDataExportAudit(db, {
    orgId: args.orgId,
    actorId: args.actorId,
    targetType: 'file_asset',
    targetId: args.fileId,
    format: 'file',
    recordCount: 1,
    action: 'file_download',
    metadata: {
      file_purpose: args.purpose,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes,
      expires_in_seconds: args.expiresIn,
      surface: args.surface,
      response_mode: args.responseMode,
      ...(args.consentAttachmentContext
        ? {
            context_type: 'consent_attachment',
            patient_share_consent_id: args.consentAttachmentContext.patientShareConsentId,
            share_case_id: args.consentAttachmentContext.shareCaseId,
            has_consent_record: args.consentAttachmentContext.hasConsentRecord,
            has_valid_until: args.consentAttachmentContext.hasValidUntil,
            consent_revoked: args.consentAttachmentContext.consentRevoked,
          }
        : {}),
    },
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  });
}
