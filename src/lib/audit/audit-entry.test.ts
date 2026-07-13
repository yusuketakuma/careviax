import { describe, expect, it, vi } from 'vitest';
import { createAuditLogEntry } from './audit-entry';

describe('createAuditLogEntry', () => {
  it('writes org, actor, request metadata, and caller-provided audit details', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
        requestId: 'request_1',
        correlationId: 'workflow_1',
      },
      {
        action: 'pharmacy_site_updated',
        targetType: 'PharmacySite',
        targetId: 'site_1',
        patientId: 'patient_1',
        changes: { name: '中央薬局' },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: 'pharmacy_site_updated',
        target_type: 'PharmacySite',
        target_id: 'site_1',
        changes: {
          name: '中央薬局',
          request_trace: {
            request_id: 'request_1',
            correlation_id: 'workflow_1',
          },
        },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      },
    });
  });

  it('creates trace-only changes when the caller has no audit details', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'request_1',
        correlationId: 'workflow_1',
      },
      {
        action: 'job_started',
        targetType: 'IntegrationJob',
        targetId: 'job_1',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          request_trace: {
            request_id: 'request_1',
            correlation_id: 'workflow_1',
          },
        },
      }),
    });
  });

  it('preserves non-object change shapes instead of changing their public audit contract', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'request_1',
        correlationId: 'workflow_1',
      },
      {
        action: 'legacy_snapshot_recorded',
        targetType: 'LegacySnapshot',
        targetId: 'snapshot_1',
        changes: ['unchanged'],
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changes: ['unchanged'] }),
    });
  });

  it('preserves Prisma JSON values that provide their own serialization', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });
    const serializedChanges = {
      toJSON: () => ({ status: 'updated' }),
    };

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'request_1',
        correlationId: 'workflow_1',
      },
      {
        action: 'serialized_snapshot_recorded',
        targetType: 'SerializedSnapshot',
        targetId: 'snapshot_1',
        changes: serializedChanges,
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changes: serializedChanges }),
    });
  });

  it('removes an untrusted reserved trace when no validated trace is available', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'contains spaces',
        correlationId: 'patient@example.test',
      },
      {
        action: 'record_updated',
        targetType: 'Record',
        targetId: 'record_1',
        changes: {
          request_trace: {
            request_id: 'request_caller',
            correlation_id: 'correlation_caller',
          },
          status: 'updated',
        },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changes: { status: 'updated' } }),
    });
  });

  it('preserves domain request ids and overrides the reserved trace namespace', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await createAuditLogEntry(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'request_server',
        correlationId: 'correlation_validated',
      },
      {
        action: 'record_updated',
        targetType: 'Record',
        targetId: 'record_1',
        changes: {
          request_id: 'communication_request_1',
          request_trace: {
            request_id: 'request_caller',
            correlation_id: 'correlation_caller',
          },
          status: 'updated',
        },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          request_id: 'communication_request_1',
          request_trace: {
            request_id: 'request_server',
            correlation_id: 'correlation_validated',
          },
          status: 'updated',
        },
      }),
    });
  });
});
