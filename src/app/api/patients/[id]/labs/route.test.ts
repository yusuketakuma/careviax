import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  patientFindFirstMock,
  patientLabObservationCreateMock,
  patientLabObservationFindManyMock,
  visitRecordFindFirstMock,
  allocateDisplayIdMock,
  recordPhiReadAuditForRequestMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  patientLabObservationCreateMock: vi.fn(),
  patientLabObservationFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
  recordPhiReadAuditForRequestMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: Record<string, unknown>,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const noStore = (response: Response) => {
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
      try {
        return noStore(
          await handler(
            req,
            {
              orgId: 'org_1',
              userId: 'pharmacist_1',
              role: 'pharmacist',
              ipAddress: '127.0.0.1',
              userAgent: 'vitest',
              requestId: 'req_patient_labs_1',
              correlationId: 'corr_patient_labs_1',
            },
            routeContext,
          ),
        );
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
  withOrgContext: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      patientLabObservation: {
        create: patientLabObservationCreateMock,
      },
    }),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

vi.mock('@/lib/audit/phi-read-audit', () => ({
  recordPhiReadAuditForRequest: recordPhiReadAuditForRequestMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientLabObservation: {
      create: patientLabObservationCreateMock,
      findMany: patientLabObservationFindManyMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

import { GET, POST } from './route';

const baseLabBody = {
  analyte_code: 'egfr',
  measured_at: '2026-05-16T00:00:00.000Z',
  value_numeric: 48,
  unit: 'mL/min/1.73m2',
};

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/labs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/labs', {
    method: 'POST',
    body: '{"analyte_code":',
    headers: { 'content-type': 'application/json' },
  });
}

function createGetRequest(url = 'http://localhost/api/patients/patient_1/labs') {
  return new NextRequest(url);
}

describe('/api/patients/[id]/labs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientLabObservationFindManyMock.mockResolvedValue([]);
  });

  it('rejects unsupported analyte_code query values before reading labs', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/patients/patient_1/labs?analyte_code=bad_code'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before reading labs', async () => {
    const response = (await GET(createGetRequest('http://localhost/api/patients/%20%20/labs'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('returns exact internal lab values and audits the authoritative patient once', async () => {
    const lab = {
      id: 'lab_1',
      patient_id: 'patient_authoritative',
      analyte_code: 'egfr',
      value_numeric: 48.25,
      value_text: '48.25',
      unit: 'mL/min/1.73m2',
      abnormal_flag: 'low',
      note: '腎機能を継続確認',
    };
    patientFindFirstMock.mockResolvedValueOnce({ id: 'patient_authoritative' });
    patientLabObservationFindManyMock.mockResolvedValueOnce([lab]);

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_requested' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: [lab] });
    expect(patientLabObservationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_authoritative',
        }),
      }),
    );
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
        view: 'patient_labs',
      },
    );
  });

  it('filters labs by a supported analyte_code query value', async () => {
    const response = (await GET(
      createGetRequest(
        'http://localhost/api/patients/patient_1/labs?analyte_code=egfr&limit=%202%20',
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientLabObservationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          analyte_code: 'egfr',
        }),
        take: 2,
      }),
    );
  });

  it('rejects malformed limit query values before reading the patient', async () => {
    const response = (await GET(
      createGetRequest('http://localhost/api/patients/patient_1/labs?limit=20abc'),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        limit: ['limit は整数で指定してください'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range limit query values before reading the patient', async () => {
    const lowerResponse = (await GET(
      createGetRequest('http://localhost/api/patients/patient_1/labs?limit=-5'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(lowerResponse.status).toBe(400);
    expectSensitiveNoStore(lowerResponse);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();

    const upperResponse = (await GET(
      createGetRequest('http://localhost/api/patients/patient_1/labs?limit=999'),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(upperResponse.status).toBe(400);
    expectSensitiveNoStore(upperResponse);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();
  });

  it('uses the default lab limit when omitted', async () => {
    const response = (await GET(createGetRequest('http://localhost/api/patients/patient_1/labs'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientLabObservationFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 50,
      }),
    );
    expect(recordPhiReadAuditForRequestMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404 without auditing when the assigned patient is not found', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_unknown' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(patientLabObservationFindManyMock).not.toHaveBeenCalled();
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('uses normalized raw patient ids for DB reads instead of URL-encoded ids', async () => {
    const rawPatientId = 'patient/a b?x=1#frag';
    patientFindFirstMock.mockResolvedValueOnce({ id: rawPatientId });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: ` ${rawPatientId} ` }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: rawPatientId,
          org_id: 'org_1',
        }),
      }),
    );
    expect(patientLabObservationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: rawPatientId,
        }),
      }),
    );
    expect(JSON.stringify(patientLabObservationFindManyMock.mock.calls)).not.toContain(
      encodeURIComponent(rawPatientId),
    );
  });

  it('returns a sanitized no-store 500 when lab reads fail', async () => {
    const rawError = '患者A eGFR ワルファリン lab read failure';
    patientLabObservationFindManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

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

describe('/api/patients/[id]/labs POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    visitRecordFindFirstMock.mockResolvedValue({ id: 'visit_1' });
    patientLabObservationCreateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'lab_1',
        ...args.data,
      }),
    );
    allocateDisplayIdMock.mockResolvedValue('plab0000000001');
  });

  it('rejects non-object lab payloads before loading the patient', async () => {
    const response = (await POST(createPostRequest([]), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing lab payloads or creating labs', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON lab payloads before loading the patient', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before creating labs', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await POST(createPostRequest(baseLabBody), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('uses normalized raw patient ids for lab writes instead of URL-encoded ids', async () => {
    const rawPatientId = 'patient/a b?x=1#frag';
    const response = (await POST(createPostRequest(baseLabBody), {
      params: Promise.resolve({ id: ` ${rawPatientId} ` }),
    }))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'plab0000000001',
        patient_id: rawPatientId,
      }),
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientLabObservation: expect.objectContaining({ create: patientLabObservationCreateMock }),
      }),
      'PatientLabObservation',
      'org_1',
    );
    expect(JSON.stringify(patientLabObservationCreateMock.mock.calls)).not.toContain(
      encodeURIComponent(rawPatientId),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'lab_1',
        display_id: 'plab0000000001',
        patient_id: rawPatientId,
      },
    });
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });

  it('validates same-org same-patient assigned visit-record provenance before creating', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_1',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(201);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'plab0000000001',
        org_id: 'org_1',
        patient_id: 'patient_1',
        source_type: 'visit_record',
        source_visit_record_id: 'visit_1',
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'lab_1',
        source_type: 'visit_record',
        source_visit_record_id: 'visit_1',
      },
    });
  });

  it('rejects visit-record labs without a source visit record before creating', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record belongs to another patient', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_wrong_patient',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        source_visit_record_id: ['指定された訪問記録を確認できません'],
      },
    });
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_wrong_patient',
        patient_id: 'patient_1',
      }),
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record belongs to another org', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_wrong_org',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        source_visit_record_id: ['指定された訪問記録を確認できません'],
      },
    });
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_wrong_org',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record is not found in the org/patient scope', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_unassigned',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        source_visit_record_id: ['指定された訪問記録を確認できません'],
      },
    });
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_unassigned',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
  });

  it('clears inconsistent visit record IDs for non-visit lab sources', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'manual',
        source_visit_record_id: 'visit_stale',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(201);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_type: 'manual',
        source_visit_record_id: null,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'lab_1',
        source_type: 'manual',
        source_visit_record_id: null,
      },
    });
  });

  it('returns a sanitized no-store 500 when lab creation fails', async () => {
    const rawError = '患者A eGFR 48.25 lab create failure';
    patientLabObservationCreateMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await POST(createPostRequest(baseLabBody), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('48.25');
    expect(recordPhiReadAuditForRequestMock).not.toHaveBeenCalled();
  });
});
