import type { recordDataExportAudit } from '@/server/services/export-audit';
import { recordDataExportAudit as writeDataExportAudit } from '@/server/services/export-audit';
import { buildAuditedConsentDocumentUrl } from '@/server/services/consent-record-documents';

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
        share_case: { select: { base_patient_id: true } };
      };
      orderBy: { created_at: 'desc' };
    }) => Promise<{
      id: string;
      share_case_id: string;
      consent_record_id: string | null;
      valid_until: Date | null;
      revoked_at: Date | null;
      share_case: { base_patient_id: string };
    } | null>;
  };
  consentRecord: {
    findFirst: (args: {
      where:
        | {
            org_id: string;
            document_file_id: string;
          }
        | {
            org_id: string;
            document_url: string;
          };
      select: {
        id: true;
        patient_id: true;
        expiry_date: true;
        revoked_date: true;
      };
      orderBy: { updated_at: 'desc' };
    }) => Promise<{
      id: string;
      patient_id: string;
      expiry_date: Date | null;
      revoked_date: Date | null;
    } | null>;
  };
  contractDocument: {
    findFirst: (args: {
      where: {
        org_id: string;
        file_id: string;
      };
      select: {
        id: true;
        contract_id: true;
        version_id: true;
        document_type: true;
      };
      orderBy: { created_at: 'desc' };
    }) => Promise<{
      id: string;
      contract_id: string;
      version_id: string | null;
      document_type: string;
    } | null>;
  };
};

export type FileDownloadAuditResponseMode = 'json' | 'redirect' | 'stream';
export type FileDownloadConsentAttachmentContext = {
  patientShareConsentId: string;
  shareCaseId: string;
  hasConsentRecord: boolean;
  hasValidUntil: boolean;
  consentRevoked: boolean;
};
export type FileDownloadConsentRecordDocumentContext = {
  consentRecordId: string;
  hasExpiryDate: boolean;
  consentRevoked: boolean;
};
export type FileDownloadContractDocumentContext = {
  contractDocumentId: string;
  contractId: string;
  versionId: string | null;
  documentType: string;
};
export type ResolvedFileDownloadAuditContext = {
  patientId?: string;
  consentAttachmentContext?: FileDownloadConsentAttachmentContext;
  consentRecordDocumentContext?: FileDownloadConsentRecordDocumentContext;
  contractDocumentContext?: FileDownloadContractDocumentContext;
};

export async function resolveFileDownloadAuditContext(
  db: FileDownloadContextClient,
  args: {
    orgId: string;
    fileId: string;
  },
): Promise<ResolvedFileDownloadAuditContext | undefined> {
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
      share_case: { select: { base_patient_id: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  if (!consent) {
    const consentRecord =
      (await db.consentRecord.findFirst({
        where: {
          org_id: args.orgId,
          document_file_id: args.fileId,
        },
        select: {
          id: true,
          patient_id: true,
          expiry_date: true,
          revoked_date: true,
        },
        orderBy: { updated_at: 'desc' },
      })) ??
      (await db.consentRecord.findFirst({
        where: {
          org_id: args.orgId,
          document_url: buildAuditedConsentDocumentUrl(args.fileId),
        },
        select: {
          id: true,
          patient_id: true,
          expiry_date: true,
          revoked_date: true,
        },
        orderBy: { updated_at: 'desc' },
      }));

    if (!consentRecord) {
      const contractDocument = await db.contractDocument.findFirst({
        where: {
          org_id: args.orgId,
          file_id: args.fileId,
        },
        select: {
          id: true,
          contract_id: true,
          version_id: true,
          document_type: true,
        },
        orderBy: { created_at: 'desc' },
      });

      if (!contractDocument) return undefined;
      return {
        contractDocumentContext: {
          contractDocumentId: contractDocument.id,
          contractId: contractDocument.contract_id,
          versionId: contractDocument.version_id,
          documentType: contractDocument.document_type,
        },
      };
    }

    return {
      patientId: consentRecord.patient_id,
      consentRecordDocumentContext: {
        consentRecordId: consentRecord.id,
        hasExpiryDate: Boolean(consentRecord.expiry_date),
        consentRevoked: Boolean(consentRecord.revoked_date),
      },
    };
  }

  return {
    patientId: consent.share_case.base_patient_id,
    consentAttachmentContext: {
      patientShareConsentId: consent.id,
      shareCaseId: consent.share_case_id,
      hasConsentRecord: Boolean(consent.consent_record_id),
      hasValidUntil: Boolean(consent.valid_until),
      consentRevoked: Boolean(consent.revoked_at),
    },
  };
}

export async function recordFileDownloadAudit(
  db: AuditClient,
  args: {
    orgId: string;
    actorId: string;
    actorPharmacyId?: string;
    actorSiteId?: string;
    patientId?: string;
    fileId: string;
    purpose: string;
    mimeType: string;
    sizeBytes: number;
    expiresIn: number;
    surface: 'files_download' | 'files_presigned_download';
    responseMode: FileDownloadAuditResponseMode;
    consentAttachmentContext?: FileDownloadConsentAttachmentContext;
    consentRecordDocumentContext?: FileDownloadConsentRecordDocumentContext;
    contractDocumentContext?: FileDownloadContractDocumentContext;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  await writeDataExportAudit(db, {
    orgId: args.orgId,
    actorId: args.actorId,
    actorPharmacyId: args.actorPharmacyId,
    actorSiteId: args.actorSiteId,
    patientId: args.patientId,
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
        : args.consentRecordDocumentContext
          ? {
              context_type: 'consent_record_document',
              consent_record_id: args.consentRecordDocumentContext.consentRecordId,
              has_expiry_date: args.consentRecordDocumentContext.hasExpiryDate,
              consent_revoked: args.consentRecordDocumentContext.consentRevoked,
            }
          : args.contractDocumentContext
            ? {
                context_type: 'contract_document',
                contract_document_id: args.contractDocumentContext.contractDocumentId,
                contract_id: args.contractDocumentContext.contractId,
                ...(args.contractDocumentContext.versionId
                  ? { version_id: args.contractDocumentContext.versionId }
                  : {}),
                document_type: args.contractDocumentContext.documentType,
              }
            : {}),
    },
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  });
}
