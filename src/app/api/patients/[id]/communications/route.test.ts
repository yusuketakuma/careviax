import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  withAuthContextOptions,
  withOrgContextMock,
  getPatientCommunicationsDataMock,
  recordPhiReadAuditForRequestMock,
  transactionClient,
} = vi.hoisted(() => ({
  authContextMock: vi.fn(),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  withOrgContextMock: vi.fn(),
  getPatientCommunicationsDataMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
  transactionClient: { patient: { findFirst: vi.fn() } },
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (...args: unknown[]) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (
      req: NextRequest,
      routeContext: { params: Promise<{ id: string }> },
    ): Promise<Response> => {
      const rejection = authRejectionMock();
      if (rejection) return Promise.resolve(rejection);
      return handler(req, authContextMock(), routeContext);
    };
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-detail', () => ({
  getPatientCommunicationsData: getPatientCommunicationsDataMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

import { GET } from './route';

const authContext = {
  orgId: 'org_1',
  role: 'pharmacist' as const,
  userId: 'user_1',
  actorSiteId: 'site_1',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
  requestId: 'req_patient_communications_1',
  correlationId: 'corr_patient_communications_1',
};

const communicationsData = {
  communication_queue: {
    summary: { pending_count: 1 },
    items: [{ id: 'communication_1', summary: 'care coordination summary' }],
  },
  open_tasks: [],
  medication_issues: [],
  billing_summary: {
    evidence: [],
    candidates: [],
    claimable_count: 0,
    blocked_count: 0,
  },
};

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/communications');
}

function routeContext(id = 'patient_1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/patients/[id]/communications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue(authContext);
    authRejectionMock.mockReturnValue(null);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    getPatientCommunicationsDataMock.mockResolvedValue(communicationsData);
  });

  it('keeps the patient communications read behind canVisit', () => {
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canVisit',
      message: '患者情報の閲覧権限がありません',
    });
  });

  it('reads only through the request-scoped org transaction and audits successful PHI access', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: communicationsData });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(getPatientCommunicationsDataMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(authContext, {
      patientId: 'patient_1',
      view: 'patient_communications',
      purpose: 'care',
    });
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      'care coordination summary',
    );
  });

  it('audits a successful empty communications response exactly once', async () => {
    getPatientCommunicationsDataMock.mockResolvedValueOnce({
      communication_queue: { summary: { pending_count: 0 }, items: [] },
      open_tasks: [],
      medication_issues: [],
      billing_summary: {
        evidence: [],
        candidates: [],
        claimable_count: 0,
        blocked_count: 0,
      },
    });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank patient id before any scoped read or audit', async () => {
    const response = await GET(createRequest(), routeContext('   '));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getPatientCommunicationsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('keeps authorization rejections no-store and performs no read or audit', async () => {
    authRejectionMock.mockReturnValueOnce(
      NextResponse.json({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }, { status: 403 }),
    );

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(getPatientCommunicationsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 without auditing when the patient is out of scope', async () => {
    getPatientCommunicationsDataMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(getPatientCommunicationsDataMock).toHaveBeenCalledOnce();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when the scoped query fails', async () => {
    const rawError = 'raw patient communication record from provider';
    getPatientCommunicationsDataMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when org context setup fails', async () => {
    const rawError = 'raw RLS context failure with patient details';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(getPatientCommunicationsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
