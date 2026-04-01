import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditLogCreateMock } = vi.hoisted(() => ({
  auditLogCreateMock: vi.fn(),
}));

import { recordDataExportAudit } from './export-audit';

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

  it('propagates db errors', async () => {
    auditLogCreateMock.mockRejectedValue(new Error('DB down'));

    await expect(
      recordDataExportAudit(db, {
        orgId: 'org-1',
        actorId: 'user-1',
        targetType: 'visits',
        format: 'pdf',
      })
    ).rejects.toThrow('DB down');
  });
});
