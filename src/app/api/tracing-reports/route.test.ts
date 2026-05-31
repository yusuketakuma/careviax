import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'pharmacist';
};

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

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist' as const,
        }),
      ),
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

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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
      createRequest('http://localhost/api/tracing-reports?patient_id=patient_1&status=draft'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'report_1', patient_id: 'patient_1' }],
    });
    expect(tracingReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { case_id: 'case_1', patient_id: 'patient_1' },
            { case_id: null, patient_id: { in: ['patient_1'] } },
          ],
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
      }),
    });
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
