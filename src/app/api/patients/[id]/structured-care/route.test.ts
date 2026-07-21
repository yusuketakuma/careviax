import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  withOrgContextMock,
  listPatientStructuredCareMock,
  recordPhiReadAuditForRequestMock,
  transactionClient,
} = vi.hoisted(() => {
  const patientFindFirstMock = vi.fn();
  return {
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock,
    withOrgContextMock: vi.fn(),
    listPatientStructuredCareMock: vi.fn(),
    recordPhiReadAuditForRequestMock: vi.fn(),
    transactionClient: { patient: { findFirst: patientFindFirstMock } },
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: typeof authContext,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        return noStore(await handler(req, authResult.ctx, routeContext));
      } catch {
        return noStore(
          Response.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          ),
        );
      }
    },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-structured-care-list', () => ({
  listPatientStructuredCare: listPatientStructuredCareMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

import { GET } from './route';

const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist' as const,
  actorSiteId: 'site_1',
  ipAddress: '203.0.113.10',
  userAgent: 'vitest',
  requestId: 'req_patient_structured_care_1',
  correlationId: 'corr_patient_structured_care_1',
};

function createRequest(url = 'http://localhost/api/patients/patient_1/structured-care') {
  return new NextRequest(url);
}

describe('/api/patients/[id]/structured-care GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: authContext,
    });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    listPatientStructuredCareMock.mockResolvedValue({
      procedures: [],
      narcotics: [],
    });
  });

  it('returns exact structured care values and audits the authoritative patient once', async () => {
    const procedure = {
      id: 'procedure_1',
      kind: 'home_oxygen',
      is_active: true,
      start_date: '2026-07-01T00:00:00.000Z',
      end_date: null,
      source: 'visit_record',
      confirmed_by: 'user_1',
      confirmed_by_name: '薬剤師 佐藤',
      confirmed_at: '2026-07-01T09:00:00.000Z',
    };
    const narcotic = {
      id: 'narcotic_1',
      kind: 'rescue',
      is_active: true,
      start_date: '2026-07-02T00:00:00.000Z',
      end_date: null,
      source: 'patient_detail_edit',
      confirmed_by: 'user_2',
      confirmed_by_name: '薬剤師 鈴木',
      confirmed_at: '2026-07-02T10:00:00.000Z',
    };
    patientFindFirstMock.mockResolvedValueOnce({ id: 'patient_authoritative' });
    listPatientStructuredCareMock.mockResolvedValue({
      procedures: [procedure],
      narcotics: [narcotic],
    });

    const response = await GET(
      createRequest('http://localhost/api/patients/patient_requested/structured-care'),
      {
        params: Promise.resolve({ id: 'patient_requested' }),
      },
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: '患者情報の閲覧権限がありません',
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_requested',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(listPatientStructuredCareMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_authoritative',
      includeEnded: false,
    });
    await expect(response.json()).resolves.toEqual({
      data: {
        procedures: [procedure],
        narcotics: [narcotic],
      },
    });
    expect(patientFindFirstMock).toHaveBeenCalledTimes(1);
    expect(listPatientStructuredCareMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      {
        patientId: 'patient_authoritative',
        view: 'patient_structured_care',
        purpose: 'care',
      },
    );
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      '薬剤師 佐藤',
    );
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      '薬剤師 鈴木',
    );
    expect(listPatientStructuredCareMock.mock.invocationCallOrder[0]).toBeLessThan(
      recordPhiReadAuditForRequestMock.mock.invocationCallOrder[0]!,
    );
  });

  it('audits an empty successful structured care read exactly once', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        procedures: [],
        narcotics: [],
      },
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('passes includeEnded when requested', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/patient_1/structured-care?include_ended=true'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(listPatientStructuredCareMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeEnded: true }),
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects blank patient ids before patient or structured care reads', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/%20%20/structured-care'),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns an authorization rejection without reading or auditing', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when the patient scope query fails', async () => {
    const rawError = '患者A patient assignment query failure';
    patientFindFirstMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns no-store 404 when the patient is inaccessible', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when structured care reads fail', async () => {
    const rawError = '患者A HOT モルヒネ structured care read failure';
    listPatientStructuredCareMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('モルヒネ');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when org context setup fails', async () => {
    const rawError = 'raw RLS context failure with structured care data';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(listPatientStructuredCareMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
