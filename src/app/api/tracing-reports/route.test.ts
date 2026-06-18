import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  tracingReportFindManyMock,
  tracingReportCreateMock,
  patientFindManyMock,
  patientFindFirstMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  medicationIssueFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  tracingReportFindManyMock: vi.fn(),
  tracingReportCreateMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist' as const,
      }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    tracingReport: {
      findMany: tracingReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    medicationIssue: {
      findFirst: medicationIssueFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"patient_id":',
  });
}

describe('/api/tracing-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tracingReportFindManyMock.mockResolvedValue([
      { id: 'report_1', patient_id: 'patient_1', status: 'draft' },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '山田太郎' }]);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    medicationIssueFindFirstMock.mockResolvedValue({ id: 'issue_1' });
    tracingReportCreateMock.mockResolvedValue({
      id: 'report_2',
      patient_id: 'patient_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        tracingReport: {
          create: tracingReportCreateMock,
        },
      }),
    );
  });

  it('lists tracing reports', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/tracing-reports?patient_id=%20patient_1%20&status=%20draft%20',
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'report_1', patient_id: 'patient_1' }],
    });
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: 'patient_1',
          status: 'draft',
        }),
      }),
    );
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          OR: expect.anything(),
        }),
      }),
    );
  });

  it('ignores blank optional search filters before report lookup', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/tracing-reports?patient_id=%20%20%20&status=%20%20%20'),
    ))!;

    expect(response.status).toBe(200);
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          patient_id: expect.anything(),
          status: expect.anything(),
        }),
      }),
    );
  });

  it('rejects an unsupported status filter before report or assignment reads', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/tracing-reports?status=archived'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'status が不正です',
      details: {
        status: ['status が不正です'],
      },
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(tracingReportFindManyMock).not.toHaveBeenCalled();
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('creates a tracing report', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: 'patient_1',
        content: { summary: '確認事項' },
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        content: { summary: '確認事項' },
      }),
    });
  });

  it('normalizes source fields before access checks and persistence', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: ' patient_1 ',
        case_id: ' case_1 ',
        issue_id: ' issue_1 ',
        content: { summary: '確認事項' },
        sent_to_physician: ' 在宅主治医 ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'case_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
        }),
      }),
    );
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'issue_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
          OR: [{ case_id: 'case_1' }, { case_id: null }],
        }),
      }),
    );
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        issue_id: 'issue_1',
        sent_to_physician: '在宅主治医',
      }),
    });
  });

  it('rejects blank patient ids before access checks or create side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: '   ',
        content: { summary: '確認事項' },
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportCreateMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional fields before writing patient-only reports', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: 'patient_1',
        case_id: '   ',
        issue_id: '   ',
        content: { summary: '確認事項' },
        sent_to_physician: '   ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        content: { summary: '確認事項' },
      }),
    });
    expect(tracingReportCreateMock.mock.calls[0]?.[0].data).not.toHaveProperty('case_id', '   ');
    expect(tracingReportCreateMock.mock.calls[0]?.[0].data).not.toHaveProperty('issue_id', '   ');
    expect(tracingReportCreateMock.mock.calls[0]?.[0].data).not.toHaveProperty(
      'sent_to_physician',
      '   ',
    );
  });

  it('rejects non-object request bodies before access checks or create side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', ['unexpected']),
    ))!;

    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before access checks or create side effects', async () => {
    const response = (await POST(
      createMalformedJsonRequest('http://localhost/api/tracing-reports'),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(tracingReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched patient and case combinations before creating', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: 'patient_2',
        case_id: 'case_1',
        content: { summary: '確認事項' },
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'case_1',
          org_id: 'org_1',
          patient_id: 'patient_2',
        }),
      }),
    );
    expect(tracingReportCreateMock).not.toHaveBeenCalled();
  });

  it('rejects medication issues outside the selected patient and case scope', async () => {
    medicationIssueFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/tracing-reports', {
        patient_id: 'patient_1',
        case_id: 'case_1',
        issue_id: 'issue_other',
        content: { summary: '確認事項' },
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'issue_other',
          org_id: 'org_1',
          patient_id: 'patient_1',
          OR: [{ case_id: 'case_1' }, { case_id: null }],
        }),
      }),
    );
    expect(tracingReportCreateMock).not.toHaveBeenCalled();
  });
});
