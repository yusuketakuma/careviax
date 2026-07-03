import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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

const VISIT_RECORD_UPDATED_AT = '2026-06-18T01:23:45.000Z';
const REPORT_UPDATED_AT = new Date('2026-06-18T02:30:00.000Z');
const REPORT_UPDATED_AT_ISO = REPORT_UPDATED_AT.toISOString();

function createGenerateFromVisitRequest(body: unknown) {
  const effectiveBody =
    body !== undefined &&
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    !('expected_visit_record_updated_at' in body)
      ? { expected_visit_record_updated_at: VISIT_RECORD_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/care-reports/generate-from-visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(effectiveBody),
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
      reports: [
        {
          id: 'report_1',
          report_type: 'physician_report',
          status: 'draft',
          updated_at: REPORT_UPDATED_AT,
        },
      ],
    });

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'report_1',
          report_type: 'physician_report',
          status: 'draft',
          updated_at: REPORT_UPDATED_AT_ISO,
        },
      ],
    });
    expect(generateReportsFromVisitMock).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'visit_1',
      undefined,
      { userId: 'user_1', role: 'pharmacist' },
      {
        expectedVisitRecordUpdatedAt: new Date(VISIT_RECORD_UPDATED_AT),
        expectedReportUpdatedAt: null,
      },
    );
  });

  it('passes the existing draft report version when an explicit report type is regenerated', async () => {
    generateReportsFromVisitMock.mockResolvedValue({
      reports: [
        {
          id: 'report_1',
          report_type: 'physician_report',
          status: 'draft',
          updated_at: REPORT_UPDATED_AT,
        },
      ],
    });

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        expected_report_updated_at: '2026-06-18T02:00:00.000Z',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(201);
    expect(generateReportsFromVisitMock).toHaveBeenCalledWith(
      'org_1',
      'user_1',
      'visit_1',
      'physician_report',
      { userId: 'user_1', role: 'pharmacist' },
      {
        expectedVisitRecordUpdatedAt: new Date(VISIT_RECORD_UPDATED_AT),
        expectedReportUpdatedAt: new Date('2026-06-18T02:00:00.000Z'),
      },
    );
  });

  it('rejects report draft version tokens without an explicit report type', async () => {
    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
        expected_report_updated_at: '2026-06-18T02:00:00.000Z',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_report_updated_at: ['報告書下書きの版情報はreport_type指定時のみ使用できます'],
      },
    });
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });

  it('requires the visit record version before calling the generator', async () => {
    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
        expected_visit_record_updated_at: undefined,
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        expected_visit_record_updated_at: expect.any(Array),
      },
    });
    expect(generateReportsFromVisitMock).not.toHaveBeenCalled();
  });

  it('returns conflict when the visit record changed before generation', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('VISIT_RECORD_STALE_FOR_REPORT_GENERATION'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
        expected_visit_record_updated_at: '2026-06-18T01:20:00.000Z',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問記録が同時に更新されました。再読み込みしてください',
    });
  });

  it('returns conflict when an existing report draft changed before regeneration', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('CARE_REPORT_DRAFT_STALE_FOR_REPORT_GENERATION'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        expected_report_updated_at: '2026-06-18T02:00:00.000Z',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '報告書下書きが同時に更新されました。再読み込みしてください',
    });
  });

  it('returns conflict when an existing draft would be reused without a report version token', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('CARE_REPORT_DRAFT_VERSION_REQUIRED_FOR_REPORT_GENERATION'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '既存の報告書下書きがあります。下書き詳細を再読み込みしてから個別に再生成してください',
    });
  });

  it('returns 404 when the visit record is missing', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('VisitSchedule not found for schedule_id: schedule_secret'),
    );

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_missing',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '報告書生成に必要な情報が見つかりません',
    });
    expect(JSON.stringify(body)).not.toContain('schedule_secret');
    expect(JSON.stringify(body)).not.toContain('VisitSchedule');
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

  it('returns a validation error when structured SOAP is incomplete for external reports', async () => {
    generateReportsFromVisitMock.mockRejectedValue(
      new Error('REPORTABLE_STRUCTURED_SOAP_REQUIRED_FOR_REPORT'),
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
      message:
        '報告書を生成するには服薬状況・副作用確認・薬学的評価・計画を含む構造化SOAP記録が必要です',
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

  it('returns a sanitized no-store 500 when report generation fails unexpectedly', async () => {
    const rawError = '患者A 03-1111-2222 report generation renderer failure';
    generateReportsFromVisitMock.mockRejectedValue(new Error(rawError));

    const response = (await POST(
      createGenerateFromVisitRequest({
        visit_record_id: 'visit_1',
      }),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
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
