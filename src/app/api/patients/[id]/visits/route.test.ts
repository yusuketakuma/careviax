import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  withAuthContextOptions,
  withOrgContextMock,
  getPatientVisitsDataMock,
  recordPhiReadAuditForRequestMock,
  transactionClient,
} = vi.hoisted(() => ({
  authContextMock: vi.fn(),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  withOrgContextMock: vi.fn(),
  getPatientVisitsDataMock: vi.fn(),
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
  getPatientVisitsData: getPatientVisitsDataMock,
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
  requestId: 'req_patient_visits_1',
  correlationId: 'corr_patient_visits_1',
};

const visitsData = {
  monthly_visit_count: 1,
  visit_schedules: [
    {
      id: 'schedule_1',
      schedule_status: 'completed',
      visit_record: { id: 'record_1', outcome_status: 'completed' },
    },
  ],
  visit_records: [
    {
      id: 'record_1',
      outcome_status: 'cancelled',
      cancellation_reason: '体調不良のため中止',
      postpone_reason: null,
      revisit_reason: null,
    },
  ],
  home_care_feature_summary: { states: [], highlights: [] },
};

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/visits');
}

function routeContext(id = 'patient_1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/patients/[id]/visits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue(authContext);
    authRejectionMock.mockReturnValue(null);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    getPatientVisitsDataMock.mockResolvedValue(visitsData);
  });

  it('keeps the patient visits read behind canViewDashboard', () => {
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canViewDashboard',
      message: '患者情報の閲覧権限がありません',
    });
  });

  it('reads only through the request-scoped org transaction and audits successful PHI access', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: visitsData });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(getPatientVisitsDataMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(authContext, {
      patientId: 'patient_1',
      view: 'patient_visits',
      purpose: 'care',
    });
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      '体調不良のため中止',
    );
  });

  it('audits a successful empty visits response exactly once', async () => {
    getPatientVisitsDataMock.mockResolvedValueOnce({
      monthly_visit_count: 0,
      visit_schedules: [],
      visit_records: [],
      home_care_feature_summary: { states: [], highlights: [] },
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
    expect(getPatientVisitsDataMock).not.toHaveBeenCalled();
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
    expect(getPatientVisitsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 without auditing when the patient is out of scope', async () => {
    getPatientVisitsDataMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(getPatientVisitsDataMock).toHaveBeenCalledOnce();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when the scoped query fails', async () => {
    const rawError = 'raw patient visit cancellation reason from provider';
    getPatientVisitsDataMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when org context setup fails', async () => {
    const rawError = 'raw RLS context failure with patient visit details';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(getPatientVisitsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
