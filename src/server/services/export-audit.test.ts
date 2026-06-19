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
