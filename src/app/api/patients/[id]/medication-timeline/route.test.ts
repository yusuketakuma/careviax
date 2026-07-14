import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  authRejectionMock,
  patientFindFirstMock,
  listStandardMedicationTimelineMock,
  withOrgContextMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => ({
  authContextMock: vi.fn(() => ({
    orgId: 'org_1',
    userId: 'pharmacist_1',
    role: 'pharmacist',
  })),
  authRejectionMock: vi.fn<() => Response | null>(() => null),
  patientFindFirstMock: vi.fn(),
  listStandardMedicationTimelineMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const rejection = authRejectionMock();
      if (rejection) return rejection;

      try {
        return await handler(req, authContextMock(), routeContext);
      } catch {
        return Response.json(
          { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
          { status: 500 },
        );
      }
    },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/standard-medication-timeline', () => ({
  listStandardMedicationTimeline: listStandardMedicationTimelineMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

import { GET } from './route';

function createRequest(
  url = 'http://localhost/api/patients/patient_requested/medication-timeline',
) {
  return new NextRequest(url);
}

const routeParams = { params: Promise.resolve({ id: 'patient_requested' }) };

describe('GET /api/patients/[id]/medication-timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.mockReturnValue({
      orgId: 'org_1',
      userId: 'pharmacist_1',
      role: 'pharmacist',
    });
    authRejectionMock.mockReturnValue(null);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_authoritative' });
    listStandardMedicationTimelineMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: patientFindFirstMock,
        },
      }),
    );
  });

  it('returns exact medication values and audits the authoritative patient once', async () => {
    const item = {
      id: 'timeline_1',
      category: 'prescription',
      medication_label: 'ワルファリン錠1mg',
      medication_coding: [
        {
          system: 'urn:oid:1.2.392.200119.4.403.1',
          code: '1234567890',
          display: 'ワルファリン錠1mg',
        },
      ],
      status: 'active',
      authored_at: '2026-07-10T00:00:00.000Z',
      effective_at: '2026-07-11T00:00:00.000Z',
      dispensed_at: null,
      asserted_at: null,
      quantity: { value: '14', unit: 'tablet' },
      dosage_text: '1日1回 夕食後 0.5錠',
      sync_status: 'synced',
      updated_at: '2026-07-11T08:00:00.000Z',
    };
    listStandardMedicationTimelineMock.mockResolvedValueOnce([item]);

    const response = await GET(createRequest(), routeParams);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient_id: 'patient_authoritative',
        items: [item],
      },
      meta: {
        count: 1,
        limit: 100,
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_requested',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(listStandardMedicationTimelineMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_authoritative',
      caseId: undefined,
      limit: 100,
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'pharmacist_1',
        role: 'pharmacist',
      }),
      {
        patientId: 'patient_authoritative',
        targetType: 'patient',
        targetId: 'patient_authoritative',
        view: 'patient_medication_timeline',
      },
    );
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain(
      'ワルファリン',
    );
    expect(JSON.stringify(recordPhiReadAuditForRequestMock.mock.calls)).not.toContain('1234567890');
  });

  it('audits an empty successful timeline exactly once', async () => {
    const response = await GET(createRequest(), routeParams);

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: { patient_id: 'patient_authoritative', items: [] },
      meta: { count: 0, limit: 100 },
    });
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('passes one exact case filter and clamps the upper limit without another query', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_requested/medication-timeline?case_id=case_1&limit=999',
      ),
      routeParams,
    );

    expect(response.status).toBe(200);
    expect(listStandardMedicationTimelineMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_authoritative',
      caseId: 'case_1',
      limit: 200,
    });
    expect(patientFindFirstMock).toHaveBeenCalledTimes(1);
    expect(listStandardMedicationTimelineMock).toHaveBeenCalledTimes(1);
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('uses the default limit for malformed limit values', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_requested/medication-timeline?limit=20abc',
      ),
      routeParams,
    );

    expect(response.status).toBe(200);
    expect(listStandardMedicationTimelineMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 100 }),
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['duplicate case filters', '?case_id=case_1&case_id=case_2'],
    ['blank case filter', '?case_id='],
    ['non-canonical case filter', '?case_id=%20case_1%20'],
  ])('rejects %s before reading or auditing', async (_label, query) => {
    const response = await GET(
      createRequest(`http://localhost/api/patients/patient_requested/medication-timeline${query}`),
      routeParams,
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(listStandardMedicationTimelineMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before reading or auditing', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns an authorization rejection without reading or auditing', async () => {
    authRejectionMock.mockReturnValueOnce(
      Response.json({ code: 'AUTH_FORBIDDEN', message: '権限がありません' }, { status: 403 }),
    );

    const response = await GET(createRequest(), routeParams);

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(listStandardMedicationTimelineMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns 404 without listing or auditing when the assigned patient is absent', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeParams);

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(listStandardMedicationTimelineMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without auditing when the timeline read throws', async () => {
    const rawError = '患者A ワルファリン medication timeline read failed';
    listStandardMedicationTimelineMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest(), routeParams);

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
