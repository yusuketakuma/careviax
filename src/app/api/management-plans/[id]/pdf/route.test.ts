import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  authOptionsCapture,
  requireAuthContextMock,
  buildManagementPlanPdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  authContext: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'request_management_plan_pdf_1',
    correlationId: 'correlation_management_plan_pdf_1',
  },
  authOptionsCapture: { value: undefined as unknown },
  requireAuthContextMock: vi.fn(),
  buildManagementPlanPdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    authOptionsCapture.value = options;
    return async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      const authResult = await requireAuthContextMock(req, options);
      const response =
        'response' in authResult
          ? authResult.response
          : await handler(req, authResult.ctx, routeContext);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      response.headers.set('Pragma', 'no-cache');
      if ('ctx' in authResult) {
        response.headers.set('X-Request-Id', authResult.ctx.requestId);
        response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
      }
      return response;
    };
  },
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildManagementPlanPdf: buildManagementPlanPdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { GET } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/management-plans/plan_1/pdf');
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_management_plan_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_management_plan_pdf_1');
}

describe('/api/management-plans/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('registers the exact management plan PDF authorization policy', () => {
    expect(authOptionsCapture.value).toEqual({
      permission: 'canVisit',
      message: '管理計画書 PDF の閲覧権限がありません',
    });
  });

  it('rejects blank management plan ids before rendering or audit', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '管理計画書IDが不正です',
    });
    expect(buildManagementPlanPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns the rendered management plan pdf', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'plan.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildManagementPlanPdfMock).toHaveBeenCalledWith('org_1', 'plan_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'plan.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(prismaMock, {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'management_plan',
      targetId: 'plan_1',
      format: 'pdf',
      recordCount: 1,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'request_management_plan_pdf_1',
      correlationId: 'correlation_management_plan_pdf_1',
    });
  });

  it('leaves unexpected response creation failures to the shared wrapper boundary', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'plan.pdf',
    });
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw management plan response detail');
    });

    await expect(
      GET(createGetRequest(), {
        params: Promise.resolve({ id: 'plan_1' }),
      }),
    ).rejects.toThrow('raw management plan response detail');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the management plan PDF export audit cannot be recorded', async () => {
    buildManagementPlanPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'plan.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 provider raw error'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'MANAGEMENT_PLAN_PDF_EXPORT_AUDIT_FAILED',
      message: '管理計画書 PDF 出力監査を記録できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田 太郎');
    expect(JSON.stringify(body)).not.toContain('provider raw error');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the pdf source is missing', async () => {
    buildManagementPlanPdfMock.mockRejectedValue(new PdfNotFoundError('managementPlan'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildManagementPlanPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildManagementPlanPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 の管理計画書が見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('管理計画書 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
