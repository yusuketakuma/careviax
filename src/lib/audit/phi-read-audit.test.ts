import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { withOrgContextMock } = vi.hoisted(() => ({ withOrgContextMock: vi.fn() }));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import {
  PHI_READ_AUDIT_ACTION,
  recordPhiReadAudit,
  recordPhiReadAuditForRequest,
} from './phi-read-audit';
import { logger } from '@/lib/utils/logger';

describe('recordPhiReadAudit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a phi_read audit row with actor, org, patient, request metadata, and view', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      {
        patientId: 'patient_1',
        view: 'patient_detail',
        purpose: 'care',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient',
        target_id: 'patient_1',
        changes: { view: 'patient_detail', purpose: 'care' },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      },
    });
  });

  it('honors explicit targetType/targetId and non-PHI metadata', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_2' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      { orgId: 'org_1', userId: 'user_1', actorPharmacyId: 'pharmacy_9' },
      {
        patientId: 'patient_1',
        view: 'patient_timeline',
        targetType: 'patient_timeline',
        targetId: 'timeline_1',
        metadata: { event_count: 12 },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_pharmacy_id: 'pharmacy_9',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient_timeline',
        target_id: 'timeline_1',
        changes: { view: 'patient_timeline', metadata: { event_count: 12 } },
      }),
    });
  });

  it('never records PHI body fields (only view/purpose/metadata in changes)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_3' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      { orgId: 'org_1', userId: 'user_1' },
      { patientId: 'patient_1', view: 'patient_header_summary' },
    );

    const changes = create.mock.calls[0]?.[0]?.data?.changes as Record<string, unknown>;
    expect(Object.keys(changes)).toEqual(['view']);
  });

  it('does not throw and warns when the audit write fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(
      recordPhiReadAudit(
        { auditLog: { create } },
        { orgId: 'org_1', userId: 'user_1' },
        { patientId: 'patient_1', view: 'patient_detail' },
      ),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx] = warnSpy.mock.calls[0] ?? [];
    expect(ctx).toMatchObject({ event: 'phi_read_audit_write_failed' });
  });

  it('does not throw when the audit client lacks a create method', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      recordPhiReadAudit(
        { auditLog: {} as never },
        { orgId: 'org_1', userId: 'user_1' },
        { patientId: 'patient_1', view: 'patient_detail' },
      ),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('recordPhiReadAuditForRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    withOrgContextMock.mockReset();
  });

  it('writes the audit inside an org-scoped transaction with request metadata forwarded', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });
    let capturedRequestContext: unknown;
    withOrgContextMock.mockImplementation(async (_orgId, work, options) => {
      capturedRequestContext = options?.requestContext;
      return work({ auditLog: { create } });
    });

    recordPhiReadAuditForRequest(
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      { patientId: 'patient_1', view: 'patient_detail', purpose: 'care' },
    );

    // fire-and-forget: flush the microtask queue
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
    expect(capturedRequestContext).toMatchObject({ role: 'pharmacist', actorSiteId: 'site_1' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient',
        target_id: 'patient_1',
        changes: { view: 'patient_detail', purpose: 'care' },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      }),
    });
  });

  it('does not throw and warns when opening the org-scoped transaction fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    withOrgContextMock.mockRejectedValue(new Error('tx open failed'));

    expect(() =>
      recordPhiReadAuditForRequest(
        { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
        { patientId: 'patient_1', view: 'patient_detail' },
      ),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [ctx] = warnSpy.mock.calls[0] ?? [];
    expect(ctx).toMatchObject({ event: 'phi_read_audit_context_failed' });
  });
});
