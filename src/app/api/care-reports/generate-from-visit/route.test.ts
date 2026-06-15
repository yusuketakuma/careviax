import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { generateReportsFromVisitMock } = vi.hoisted(() => ({
  generateReportsFromVisitMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
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
      emptyRouteContext,
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
      emptyRouteContext,
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
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(403);
  });

  it('returns a validation error when the visit is not linked to a medication cycle', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書を生成するには訪問予定と処方サイクルの紐付けが必要です',
    });
  });

  it('returns a validation error when structured SOAP is missing', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('STRUCTURED_SOAP_REQUIRED_FOR_REPORT'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書を生成するには訪問時の構造化SOAP記録が必要です',
    });
  });

  it('returns a validation error when the linked medication cycle is missing', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('MEDICATION_CYCLE_NOT_FOUND_FOR_REPORT'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '報告書を生成する処方サイクルが見つかりません',
    });
  });

  it('rejects non-object generation payloads before calling the generator', async () => {
    const response = (await POST(createGenerateFromVisitRequest([]), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });

  it('rejects blank visit record ids before calling the generator', async () => {
    const response = (await POST(
      createGenerateFromVisitRequest({ visit_record_id: '   ' }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before calling the generator', async () => {
    const response = (await POST(createMalformedGenerateFromVisitRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });
});
