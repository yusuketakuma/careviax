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

  it('resolves consent attachment context from file asset id without selecting PHI fields', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'share_consent_1',
      share_case_id: 'share_case_1',
      consent_record_id: 'consent_record_1',
      valid_until: new Date('2026-12-31T00:00:00.000Z'),
      revoked_at: null,
    });

    const context = await resolveFileDownloadAuditContext(
      { patientShareConsent: { findFirst } },
      { orgId: 'org_1', fileId: 'file_1' },
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: { org_id: 'org_1', file_asset_id: 'file_1' },
      select: {
        id: true,
        share_case_id: true,
        consent_record_id: true,
        valid_until: true,
        revoked_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    expect(context).toEqual({
      patientShareConsentId: 'share_consent_1',
      shareCaseId: 'share_case_1',
      hasConsentRecord: true,
      hasValidUntil: true,
      consentRevoked: false,
    });
  });
});
