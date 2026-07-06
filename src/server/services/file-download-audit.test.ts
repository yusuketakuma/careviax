import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordDataExportAuditMock } = vi.hoisted(() => ({
  recordDataExportAuditMock: vi.fn(),
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { recordFileDownloadAudit, resolveFileDownloadAuditContext } from './file-download-audit';

describe('recordFileDownloadAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('records PHI-minimized file download metadata without urls, filenames, or storage keys', async () => {
    const db = { auditLog: { create: vi.fn() } };

    await recordFileDownloadAudit(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      fileId: 'file_1',
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 900,
      surface: 'files_presigned_download',
      responseMode: 'json',
      ipAddress: '203.0.113.10',
      userAgent: 'TestBrowser/1.0',
    });

    expect(recordDataExportAuditMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'file_asset',
      targetId: 'file_1',
      format: 'file',
      recordCount: 1,
      action: 'file_download',
      metadata: {
        file_purpose: 'report',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        expires_in_seconds: 900,
        surface: 'files_presigned_download',
        response_mode: 'json',
      },
      ipAddress: '203.0.113.10',
      userAgent: 'TestBrowser/1.0',
    });
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('downloadUrl');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('storageKey');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('fileName');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('山田');
  });

  it('records same-origin stream downloads without reusable URL metadata', async () => {
    const db = { auditLog: { create: vi.fn() } };

    await recordFileDownloadAudit(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      fileId: 'file_1',
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 0,
      surface: 'files_download',
      responseMode: 'stream',
      ipAddress: '203.0.113.10',
      userAgent: 'TestBrowser/1.0',
    });

    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({
          expires_in_seconds: 0,
          surface: 'files_download',
          response_mode: 'stream',
        }),
      }),
    );
    const auditPayload = JSON.stringify(recordDataExportAuditMock.mock.calls);
    expect(auditPayload).not.toContain('downloadUrl');
    expect(auditPayload).not.toContain('X-Amz-Signature');
    expect(auditPayload).not.toContain('storageKey');
    expect(auditPayload).not.toContain('fileName');
  });

  it('adds consent attachment context as identifiers and flags only', async () => {
    const db = { auditLog: { create: vi.fn() } };

    await recordFileDownloadAudit(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      fileId: 'file_1',
      purpose: 'report',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 900,
      surface: 'files_download',
      responseMode: 'redirect',
      consentAttachmentContext: {
        patientShareConsentId: 'share_consent_1',
        shareCaseId: 'share_case_1',
        hasConsentRecord: true,
        hasValidUntil: true,
        consentRevoked: false,
      },
    });

    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({
          context_type: 'consent_attachment',
          patient_share_consent_id: 'share_consent_1',
          share_case_id: 'share_case_1',
          has_consent_record: true,
          has_valid_until: true,
          consent_revoked: false,
        }),
      }),
    );
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('同意者');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('山田');
  });

  it('adds consent record document context without urls or names', async () => {
    const db = { auditLog: { create: vi.fn() } };

    await recordFileDownloadAudit(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      actorSiteId: 'site_1',
      patientId: 'patient_1',
      fileId: 'file_1',
      purpose: 'consent-document',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      expiresIn: 900,
      surface: 'files_presigned_download',
      responseMode: 'json',
      consentRecordDocumentContext: {
        consentRecordId: 'consent_1',
        hasExpiryDate: true,
        consentRevoked: false,
      },
    });

    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actorSiteId: 'site_1',
        patientId: 'patient_1',
        metadata: expect.objectContaining({
          context_type: 'consent_record_document',
          consent_record_id: 'consent_1',
          has_expiry_date: true,
          consent_revoked: false,
        }),
      }),
    );
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('downloadUrl');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('山田');
  });

  it('adds contract document context without filenames, storage keys, or hashes', async () => {
    const db = { auditLog: { create: vi.fn() } };

    await recordFileDownloadAudit(db, {
      orgId: 'org_1',
      actorId: 'user_1',
      fileId: 'contract_file_1',
      purpose: 'contract-document',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      expiresIn: 900,
      surface: 'files_presigned_download',
      responseMode: 'json',
      contractDocumentContext: {
        contractDocumentId: 'contract_document_1',
        contractId: 'contract_1',
        versionId: 'version_1',
        documentType: 'basic_contract',
      },
    });

    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        metadata: expect.objectContaining({
          context_type: 'contract_document',
          contract_document_id: 'contract_document_1',
          contract_id: 'contract_1',
          version_id: 'version_1',
          document_type: 'basic_contract',
        }),
      }),
    );
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('storageKey');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('contract.pdf');
    expect(JSON.stringify(recordDataExportAuditMock.mock.calls)).not.toContain('hash_');
  });

  it('resolves consent attachment context from file asset id without selecting PHI fields', async () => {
    const patientShareConsentFindFirst = vi.fn().mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      consent_record_id: 'consent_record_1',
      valid_until: new Date('2026-12-31T00:00:00.000Z'),
      revoked_at: null,
      share_case: { base_patient_id: 'patient_1' },
    });
    const consentRecordFindFirst = vi.fn();
    const contractDocumentFindFirst = vi.fn();

    const context = await resolveFileDownloadAuditContext(
      {
        patientShareConsent: { findFirst: patientShareConsentFindFirst },
        consentRecord: { findFirst: consentRecordFindFirst },
        contractDocument: { findFirst: contractDocumentFindFirst },
      },
      { orgId: 'org_1', fileId: 'file_1' },
    );

    expect(patientShareConsentFindFirst).toHaveBeenCalledWith({
      where: { org_id: 'org_1', file_asset_id: 'file_1' },
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
    expect(context).toEqual({
      patientId: 'patient_1',
      consentAttachmentContext: {
        patientShareConsentId: 'share_consent_1',
        shareCaseId: 'share_case_1',
        hasConsentRecord: true,
        hasValidUntil: true,
        consentRevoked: false,
      },
    });
    expect(consentRecordFindFirst).not.toHaveBeenCalled();
    expect(contractDocumentFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to ConsentRecord document_file_id context for consent documents', async () => {
    const patientShareConsentFindFirst = vi.fn().mockResolvedValue(null);
    const consentRecordFindFirst = vi.fn().mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      expiry_date: new Date('2026-12-31T00:00:00.000Z'),
      revoked_date: null,
    });

    const context = await resolveFileDownloadAuditContext(
      {
        patientShareConsent: { findFirst: patientShareConsentFindFirst },
        consentRecord: { findFirst: consentRecordFindFirst },
        contractDocument: { findFirst: vi.fn() },
      },
      { orgId: 'org_1', fileId: 'file_1' },
    );

    expect(consentRecordFindFirst).toHaveBeenCalledWith({
      where: { org_id: 'org_1', document_file_id: 'file_1' },
      select: {
        id: true,
        patient_id: true,
        expiry_date: true,
        revoked_date: true,
      },
      orderBy: { updated_at: 'desc' },
    });
    expect(context).toEqual({
      patientId: 'patient_1',
      consentRecordDocumentContext: {
        consentRecordId: 'consent_1',
        hasExpiryDate: true,
        consentRevoked: false,
      },
    });
  });

  it('falls back to canonical audited ConsentRecord document_url only', async () => {
    const patientShareConsentFindFirst = vi.fn().mockResolvedValue(null);
    const consentRecordFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'consent_legacy_url',
        patient_id: 'patient_1',
        expiry_date: null,
        revoked_date: new Date('2026-01-01T00:00:00.000Z'),
      });

    const context = await resolveFileDownloadAuditContext(
      {
        patientShareConsent: { findFirst: patientShareConsentFindFirst },
        consentRecord: { findFirst: consentRecordFindFirst },
        contractDocument: { findFirst: vi.fn() },
      },
      { orgId: 'org_1', fileId: 'file_1' },
    );

    expect(consentRecordFindFirst).toHaveBeenNthCalledWith(1, {
      where: { org_id: 'org_1', document_file_id: 'file_1' },
      select: {
        id: true,
        patient_id: true,
        expiry_date: true,
        revoked_date: true,
      },
      orderBy: { updated_at: 'desc' },
    });
    expect(consentRecordFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        document_url: '/api/files/file_1/download',
      },
      select: {
        id: true,
        patient_id: true,
        expiry_date: true,
        revoked_date: true,
      },
      orderBy: { updated_at: 'desc' },
    });
    expect(JSON.stringify(consentRecordFindFirst.mock.calls)).not.toContain('https://');
    expect(context).toEqual({
      patientId: 'patient_1',
      consentRecordDocumentContext: {
        consentRecordId: 'consent_legacy_url',
        hasExpiryDate: false,
        consentRevoked: true,
      },
    });
  });

  it('falls back to ContractDocument context for contract document files', async () => {
    const patientShareConsentFindFirst = vi.fn().mockResolvedValue(null);
    const consentRecordFindFirst = vi.fn().mockResolvedValue(null);
    const contractDocumentFindFirst = vi.fn().mockResolvedValue({
      id: 'contract_document_1',
      contract_id: 'contract_1',
      version_id: 'version_1',
      document_type: 'signed_contract',
    });

    const context = await resolveFileDownloadAuditContext(
      {
        patientShareConsent: { findFirst: patientShareConsentFindFirst },
        consentRecord: { findFirst: consentRecordFindFirst },
        contractDocument: { findFirst: contractDocumentFindFirst },
      },
      { orgId: 'org_1', fileId: 'contract_file_1' },
    );

    expect(contractDocumentFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        file_id: 'contract_file_1',
      },
      select: {
        id: true,
        contract_id: true,
        version_id: true,
        document_type: true,
      },
      orderBy: { created_at: 'desc' },
    });
    expect(context).toEqual({
      contractDocumentContext: {
        contractDocumentId: 'contract_document_1',
        contractId: 'contract_1',
        versionId: 'version_1',
        documentType: 'signed_contract',
      },
    });
  });
});
