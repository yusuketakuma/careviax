import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditLogCreateMock } = vi.hoisted(() => ({
  auditLogCreateMock: vi.fn(),
}));

import { recordCareReportPrintAudit, recordDataExportAudit } from './export-audit';

describe('recordDataExportAudit', () => {
  const db = {
    auditLog: { create: auditLogCreateMock },
  } as Parameters<typeof recordDataExportAudit>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an audit log entry with full args', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      actorSiteId: 'site-1',
      patientId: 'patient-1',
      targetType: 'patients',
      targetId: 'patient-1',
      format: 'csv',
      recordCount: 42,
      filters: { status: 'active' },
      metadata: { source: 'admin' },
      ipAddress: '127.0.0.1',
      userAgent: 'TestBrowser/1.0',
    });

    expect(auditLogCreateMock).toHaveBeenCalledOnce();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org-1',
        actor_id: 'user-1',
        actor_pharmacy_id: 'org-1',
        actor_site_id: 'site-1',
        patient_id: 'patient-1',
        action: 'export',
        target_type: 'patients',
        target_id: 'patient-1',
        changes: {
          format: 'csv',
          record_count: 42,
          filters: { status: 'active' },
          metadata: { source: 'admin' },
        },
        ip_address: '127.0.0.1',
        user_agent: 'TestBrowser/1.0',
      },
    });
  });

  it('uses defaults for optional fields', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'audit_logs',
      format: 'json',
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org-1',
        actor_id: 'user-1',
        actor_pharmacy_id: 'org-1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'export',
        target_type: 'audit_logs',
        target_id: 'bulk',
        changes: {
          format: 'json',
          record_count: null,
          filters: {},
          metadata: {},
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
  });

  it('records care report print requests with action-specific audit intent', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordCareReportPrintAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      actorSiteId: 'site-1',
      patientId: 'patient-1',
      reportId: 'report-1',
      intent: 'print_requested',
      reportUpdatedAt: new Date('2026-06-18T01:02:03.000Z'),
      ipAddress: '127.0.0.1',
      userAgent: 'TestBrowser/1.0',
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org-1',
        actor_id: 'user-1',
        actor_pharmacy_id: 'org-1',
        actor_site_id: 'site-1',
        patient_id: 'patient-1',
        action: 'care_report_print_requested',
        target_type: 'care_report',
        target_id: 'report-1',
        changes: {
          format: 'print',
          metadata: {
            surface: 'care_report_print_requested',
            print_audit_intent: 'print_requested',
            report_updated_at: '2026-06-18T01:02:03.000Z',
          },
        },
        ip_address: '127.0.0.1',
        user_agent: 'TestBrowser/1.0',
      },
    });
  });

  it('records care report print previews without counting them as print requests', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordCareReportPrintAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      reportId: 'report-1',
      intent: 'preview_rendered',
      reportUpdatedAt: new Date('2026-06-18T01:02:03.000Z'),
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org-1',
        actor_id: 'user-1',
        actor_pharmacy_id: 'org-1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'care_report_print_previewed',
        target_type: 'care_report',
        target_id: 'report-1',
        changes: {
          format: 'print',
          metadata: {
            surface: 'care_report_print_preview',
            print_audit_intent: 'preview_rendered',
            report_updated_at: '2026-06-18T01:02:03.000Z',
          },
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
  });

  it('records claims XML exports without collapsing them into CSV', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'billing_candidate',
      format: 'claims-xml',
      recordCount: 3,
      metadata: { export_format: 'claims-xml' },
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'export',
        target_type: 'billing_candidate',
        changes: expect.objectContaining({
          format: 'claims-xml',
          record_count: 3,
          metadata: { export_format: 'claims-xml' },
        }),
      }),
    });
  });

  it('minimizes hostile export filters and metadata before persistence', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'medication_history',
      targetId: 'job-1',
      format: 'zip',
      recordCount: 2,
      filters: {
        patient_ids: ['patient_1', 'patient_2'],
        status: 'active',
      },
      metadata: {
        job_id: 'job-1',
        file_id: 'file-1',
        patient_ids: ['patient_1', 'patient_2'],
        patient_count: 2,
        requested_count: 2,
        success_count: 1,
        failed_count: 1,
        failure_codes: { render_failed: 1 },
        patient_selection_hash: 'hash-1',
        storageKey: 'bulk-exports/org_1/job-1/raw.zip',
        objectKey: 'bulk-exports/org_1/job-1/raw.zip',
        provider_raw_error: 'patient=患者A token=secret',
        url: 'https://signed.example/raw',
      },
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target_type: 'medication_history',
        changes: {
          format: 'zip',
          record_count: 2,
          filters: {},
          metadata: {
            job_id: 'job-1',
            file_id: 'file-1',
            patient_count: 2,
            requested_count: 2,
            success_count: 1,
            failed_count: 1,
            failure_codes: { render_failed: 1 },
            patient_selection_hash: 'hash-1',
          },
        },
      }),
    });
    const persisted = JSON.stringify(auditLogCreateMock.mock.calls);
    expect(persisted).not.toContain('patient_1');
    expect(persisted).not.toContain('patient_2');
    expect(persisted).not.toContain('storageKey');
    expect(persisted).not.toContain('objectKey');
    expect(persisted).not.toContain('患者A');
    expect(persisted).not.toContain('secret');
    expect(persisted).not.toContain('signed.example');
  });

  it('records file downloads without reusing PDF or ZIP export formats', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'file_asset',
      targetId: 'file-1',
      format: 'file',
      recordCount: 1,
      metadata: {
        file_purpose: 'report',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      },
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'export',
        target_type: 'file_asset',
        target_id: 'file-1',
        changes: expect.objectContaining({
          format: 'file',
          record_count: 1,
          metadata: {
            file_purpose: 'report',
            mime_type: 'application/pdf',
            size_bytes: 1024,
          },
        }),
      }),
    });
  });

  it('drops unsafe file download metadata while keeping the file profile summary', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'file_asset',
      targetId: 'file-1',
      format: 'file',
      recordCount: 1,
      metadata: {
        file_purpose: 'report',
        mime_type: 'application/pdf',
        size_bytes: 1024,
        storageKey: 'reports/org_1/report_1/file_1-report.pdf',
        token: 'secret',
      },
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          metadata: {
            file_purpose: 'report',
            mime_type: 'application/pdf',
            size_bytes: 1024,
          },
        }),
      }),
    });
    const persisted = JSON.stringify(auditLogCreateMock.mock.calls);
    expect(persisted).not.toContain('reports/org_1/report_1');
    expect(persisted).not.toContain('secret');
  });

  it('supports an explicit action for download-specific audit search', async () => {
    auditLogCreateMock.mockResolvedValue({});

    await recordDataExportAudit(db, {
      orgId: 'org-1',
      actorId: 'user-1',
      targetType: 'file_asset',
      targetId: 'file-1',
      format: 'file',
      action: 'file_download',
    });

    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'file_download',
        target_type: 'file_asset',
      }),
    });
  });

  it('propagates db errors', async () => {
    auditLogCreateMock.mockRejectedValue(new Error('DB down'));

    await expect(
      recordDataExportAudit(db, {
        orgId: 'org-1',
        actorId: 'user-1',
        targetType: 'visits',
        format: 'pdf',
      }),
    ).rejects.toThrow('DB down');
  });
});
