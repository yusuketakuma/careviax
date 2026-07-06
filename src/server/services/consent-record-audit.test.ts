import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLogEntryMock } = vi.hoisted(() => ({
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import {
  recordConsentRecordCreatedAudit,
  recordConsentRecordUpdatedAudit,
  recordConsentRecordViewedAudit,
  recordConsentRecordsViewedAudit,
} from './consent-record-audit';

const db = { auditLog: { create: vi.fn() } };
const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

describe('consent record audit helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('records minimized consent record list views without raw document URLs', async () => {
    await recordConsentRecordsViewedAudit(db, ctx, {
      patientId: 'patient_1',
      caseId: null,
      consentType: 'external_sharing',
      isActive: true,
      limit: 20,
      hasCursor: false,
      hasMore: false,
      totalCount: 2,
      records: [
        {
          id: 'consent_legacy',
          document_url: 'https://files.example.test/legacy-consent.pdf',
        },
        {
          id: 'consent_file',
          document_url: '/api/files/file_1/download',
        },
      ],
    });

    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      db,
      ctx,
      expect.objectContaining({
        action: 'consent_records_viewed',
        targetType: 'patient',
        targetId: 'patient_1',
        changes: expect.objectContaining({
          target_screen: 'patient_consent_records',
          viewer_role: 'pharmacist',
          actor_org_id: 'org_1',
          patient_id: 'patient_1',
          viewed_count: 2,
          consent_record_ids: ['consent_legacy', 'consent_file'],
          document_counts: {
            present: 2,
            audited: 1,
            redacted: 1,
          },
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('legacy-consent.pdf');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('/api/files/file_1');
  });

  it('records minimized detail, create, and update events without document URL values or exact dates', async () => {
    const before = {
      id: 'consent_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      consent_type: 'external_sharing',
      method: 'paper_scan',
      is_active: true,
      expiry_date: '2026-12-31',
      document_url: 'https://files.example.test/legacy-consent.pdf',
      template_id: 'template_1',
      template_version: 2,
    };
    const after = {
      ...before,
      expiry_date: null,
      document_url: '/api/files/file_1/download',
    };

    await recordConsentRecordViewedAudit(db, ctx, before);
    await recordConsentRecordCreatedAudit(db, ctx, after);
    await recordConsentRecordUpdatedAudit(db, ctx, {
      before,
      after,
      changedFields: ['expiry_date', 'document_url'],
    });

    expect(createAuditLogEntryMock).toHaveBeenNthCalledWith(
      1,
      db,
      ctx,
      expect.objectContaining({
        action: 'consent_record_viewed',
        targetType: 'consent_record',
        targetId: 'consent_1',
        changes: expect.objectContaining({
          document_url_redacted: true,
          document_source: 'legacy_redacted',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenNthCalledWith(
      2,
      db,
      ctx,
      expect.objectContaining({
        action: 'consent_record_created',
        changes: expect.objectContaining({
          has_expiry_date: false,
          document_url_audited: true,
          document_source: 'audited_url',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenNthCalledWith(
      3,
      db,
      ctx,
      expect.objectContaining({
        action: 'consent_record_updated',
        changes: expect.objectContaining({
          changed_fields: ['expiry_date', 'document_url'],
          expiry_date_changed: true,
          document_url_changed: true,
          before: expect.objectContaining({
            has_expiry_date: true,
            document_url_redacted: true,
          }),
          after: expect.objectContaining({
            has_expiry_date: false,
            document_url_audited: true,
          }),
        }),
      }),
    );

    const calls = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(calls).not.toContain('legacy-consent.pdf');
    expect(calls).not.toContain('/api/files/file_1');
    expect(calls).not.toContain('2026-12-31');
  });
});
