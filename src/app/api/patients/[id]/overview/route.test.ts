import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getPatientOverviewMock, withOrgContextMock, auditCreateMock, authContextMock } = vi.hoisted(
  () => ({
    getPatientOverviewMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    auditCreateMock: vi.fn(),
    authContextMock: vi.fn(() => ({
      orgId: 'org_1',
      role: 'pharmacist',
      userId: 'user_1',
      actorSiteId: 'site_1',
      ipAddress: '203.0.113.10',
      userAgent: 'vitest',
    })),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: Request, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, authContextMock(), routeContext),
}));

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientOverview: getPatientOverviewMock,
}));

import { GET } from './route';

function createRequest(url = 'http://localhost/api/patients/patient_1/overview') {
  return new NextRequest(url);
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GET /api/patients/[id]/overview PHI read audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // withOrgContext runs the callback with a fake org-scoped tx that captures audit writes.
    withOrgContextMock.mockImplementation(async (_orgId, work) =>
      work({ auditLog: { create: auditCreateMock } }),
    );
    auditCreateMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('records a phi_read audit row for the viewed patient and returns 200', async () => {
    getPatientOverviewMock.mockResolvedValue({ id: 'patient_1' });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);

    await flushMicrotasks();

    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.anything(),
    );
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        patient_id: 'patient_1',
        action: 'phi_read',
        target_type: 'patient',
        target_id: 'patient_1',
        changes: { view: 'patient_overview' },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      }),
    });
  });

  it('still returns 200 when the audit write fails (best-effort, non-blocking)', async () => {
    getPatientOverviewMock.mockResolvedValue({ id: 'patient_1' });
    withOrgContextMock.mockRejectedValue(new Error('audit db down'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 'patient_1' });
  });

  it('does not record an audit when the patient is not found', async () => {
    getPatientOverviewMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    await flushMicrotasks();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before recording an audit', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getPatientOverviewMock).not.toHaveBeenCalled();
  });
});
