import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  withAuthContextOptions,
  withOrgContextMock,
  getPatientHeaderSummaryMock,
  recordPhiReadAuditForRequestMock,
  transactionClient,
} = vi.hoisted(() => ({
  authContextMock: vi.fn(),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  withOrgContextMock: vi.fn(),
  getPatientHeaderSummaryMock: vi.fn(),
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
  getPatientHeaderSummary: getPatientHeaderSummaryMock,
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
  requestId: 'req_patient_header_summary_1',
  correlationId: 'corr_patient_header_summary_1',
};

const headerSummary = {
  patient_id: 'patient_1',
  name: '患者 太郎',
  name_kana: 'カンジャ タロウ',
  birth_date: '1940-01-01T00:00:00.000Z',
  gender: 'male',
  gender_label: '男性',
  care_level: 'care_3',
  care_level_label: '要介護 3',
  home_status_label: null,
  residence_label: '施設 / 201号室',
  primary_diagnosis: '2型糖尿病',
  intervention_start_date: '2026-01-01T00:00:00.000Z',
  primary_pharmacist_name: '薬剤師 花子',
  backup_pharmacist_name: null,
  primary_staff_name: null,
  backup_staff_name: null,
  first_visit_date: '2026-01-05T09:00:00.000Z',
  last_prescribed_date: '2026-06-01T00:00:00.000Z',
  next_prescription_expected_date: null,
  safety: {
    allergy: 'セフェム系(2019)',
    renal: 'eGFR 38(6/1)',
    handling_tags: ['cold_storage'],
    swallowing: '錠剤OK',
    cautions: ['ふらつき'],
    safety_tags: ['cold_storage', 'renal', 'swallowing', 'allergy'],
    visible_safety_tags: ['cold_storage', 'allergy'],
    hidden_safety_tag_count: 2,
  },
};

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/header-summary');
}

function routeContext(id = 'patient_1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/patients/[id]/header-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue(authContext);
    authRejectionMock.mockReturnValue(null);
    withOrgContextMock.mockImplementation(
      async (_orgId: string, work: (tx: typeof transactionClient) => Promise<unknown>) =>
        work(transactionClient),
    );
    getPatientHeaderSummaryMock.mockResolvedValue(headerSummary);
  });

  it('keeps the patient header summary read behind canVisit', () => {
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canVisit',
      message: '患者情報の閲覧権限がありません',
    });
  });

  it('reads only through the request-scoped org transaction and audits successful PHI access', async () => {
    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: headerSummary });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: authContext,
    });
    expect(getPatientHeaderSummaryMock).toHaveBeenCalledWith(transactionClient, {
      orgId: 'org_1',
      patientId: 'patient_1',
      role: 'pharmacist',
      userId: 'user_1',
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(authContext, {
      patientId: 'patient_1',
      view: 'patient_header_summary',
      purpose: 'care',
    });
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain('患者 太郎');
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain('セフェム系');
  });

  it('audits a successful summary without safety signals exactly once', async () => {
    getPatientHeaderSummaryMock.mockResolvedValueOnce({
      ...headerSummary,
      safety: {
        allergy: null,
        renal: null,
        handling_tags: [],
        swallowing: null,
        cautions: [],
        safety_tags: [],
        visible_safety_tags: [],
        hidden_safety_tag_count: 0,
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
    expect(getPatientHeaderSummaryMock).not.toHaveBeenCalled();
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
    expect(getPatientHeaderSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a unified 404 without auditing when the patient is out of scope', async () => {
    getPatientHeaderSummaryMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(getPatientHeaderSummaryMock).toHaveBeenCalledOnce();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when the scoped query fails', async () => {
    const rawError = 'raw patient allergy and medication safety data';
    getPatientHeaderSummaryMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 and no audit when org context setup fails', async () => {
    const rawError = 'raw RLS context failure with patient header summary data';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(getPatientHeaderSummaryMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
