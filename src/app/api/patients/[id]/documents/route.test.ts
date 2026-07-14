import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  withAuthContextOptions,
  withOrgContextMock,
  getPatientDocumentsDataMock,
  recordPhiReadAuditForRequestMock,
  transactionClient,
} = vi.hoisted(() => ({
  authContextMock: vi.fn(),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  withOrgContextMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
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
  getPatientDocumentsData: getPatientDocumentsDataMock,
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
  requestId: 'req_patient_documents_1',
  correlationId: 'corr_patient_documents_1',
};

const documentsData = {
  patient: {
    id: 'patient_1',
    name: '患者A',
    name_kana: 'カンジャエー',
  },
  print_readiness: [],
  document_statuses: [],
  first_visit_documents: [
    {
      id: 'document_1',
      document_url: 'https://documents.example.test/document_1.pdf',
      emergency_contacts: [{ name: '家族A', phone: '090-0000-0000' }],
      history: [],
    },
  ],
};

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/documents');
}

function routeContext(id = 'patient_1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/patients/[id]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue(authContext);
    authRejectionMock.mockReturnValue(null);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    getPatientDocumentsDataMock.mockResolvedValue(documentsData);
  });

  it('keeps the patient documents read behind canVisit', () => {
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canVisit',
      message: '患者情報の閲覧権限がありません',
    });
  });

  it('reads only through the request-scoped org transaction and audits successful PHI access', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: documentsData });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(getPatientDocumentsDataMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(authContext, {
      patientId: 'patient_1',
      view: 'patient_documents',
      purpose: 'care',
    });
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      '090-0000-0000',
    );
  });

  it('audits a successful empty documents response exactly once', async () => {
    getPatientDocumentsDataMock.mockResolvedValueOnce({
      patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
      print_readiness: [],
      document_statuses: [],
      first_visit_documents: [],
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
    expect(getPatientDocumentsDataMock).not.toHaveBeenCalled();
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
    expect(getPatientDocumentsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 without auditing when the patient is out of scope', async () => {
    getPatientDocumentsDataMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(getPatientDocumentsDataMock).toHaveBeenCalledOnce();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when the scoped query fails', async () => {
    const rawError = 'raw patient document and insurance record from provider';
    getPatientDocumentsDataMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when org context setup fails', async () => {
    const rawError = 'raw RLS context failure with patient document details';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(getPatientDocumentsDataMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
