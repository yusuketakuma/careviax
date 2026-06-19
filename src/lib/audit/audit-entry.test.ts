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
        changes: { name: '中央薬局' },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      },
    });
  });
});
