import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'pharmacist';
};

const { generateReportsFromVisitMock } = vi.hoisted(() => ({
  generateReportsFromVisitMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }) as AuthenticatedTestRequest,
      );
  },
}));

vi.mock('@/server/services/report-generator', () => ({
  generateReportsFromVisit: generateReportsFromVisitMock,
}));

import { POST } from './route';

function createGenerateFromVisitRequest(body: unknown) {
  return new NextRequest('http://localhost/api/care-reports/generate-from-visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedGenerateFromVisitRequest() {
  return new NextRequest('http://localhost/api/care-reports/generate-from-visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"visit_record_id":',
  });
}

describe('/api/care-reports/generate-from-visit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates reports from a visit record', async () => {
    generateReportsFromVisitMock.mockResolvedValue({
      reports: [{ id: 'report_1', report_type: 'physician_report' }],
    });

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'report_1', report_type: 'physician_report' }],
    });
    expect(generateReportsFromVisitMock).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'visit_1',
      undefined,
      { userId: 'user_1', role: 'pharmacist' },
    );
  });

  it('returns 404 when the visit record is missing', async () => {
    generateReportsFromVisitMock.mockRejectedValue(new Error('visit record not found'));

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_missing',
      }),
    ))!;

    expect(response.status).toBe(404);
  });

  it('returns 403 when the caller cannot access the visit record assignment', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('VisitRecord not accessible: visit_1'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
    ))!;

    expect(response.status).toBe(403);
  });

  it('rejects non-object generation payloads before calling the generator', async () => {
    const response = (await POST(createGenerateFromVisitRequest([])))!;

    expect(response.status).toBe(400);
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before calling the generator', async () => {
    const response = (await POST(createMalformedGenerateFromVisitRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });
});
