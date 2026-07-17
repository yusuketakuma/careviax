import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContext,
  authOptionsCapture,
  requireAuthContextMock,
  buildMedicationHistoryPdfMock,
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
    requestId: 'request_medication_history_pdf_1',
    correlationId: 'correlation_medication_history_pdf_1',
  },
  authOptionsCapture: { value: undefined as unknown },
  requireAuthContextMock: vi.fn(),
  buildMedicationHistoryPdfMock: vi.fn(),
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
  buildMedicationHistoryPdf: buildMedicationHistoryPdfMock,
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
  return new NextRequest('http://localhost/api/patients/patient_1/medications/pdf');
}

function expectRequestTrace(response: Response) {
  expect(response.headers.get('X-Request-Id')).toBe('request_medication_history_pdf_1');
  expect(response.headers.get('X-Correlation-Id')).toBe('correlation_medication_history_pdf_1');
}

describe('/api/patients/[id]/medications/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    pdfResponseMock.mockReturnValue(new Response('pdf', { status: 200 }));
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('registers the exact medication history PDF authorization policy', () => {
    expect(authOptionsCapture.value).toEqual({
      permission: 'canVisit',
      message: '薬歴 PDF の閲覧権限がありません',
    });
  });

  it('returns the medication history pdf', async () => {
    buildMedicationHistoryPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'medications.pdf',
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(buildMedicationHistoryPdfMock).toHaveBeenCalledWith('org_1', 'patient_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'medications.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(prismaMock, {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'medication_history',
      targetId: 'patient_1',
      format: 'pdf',
      recordCount: 1,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'request_medication_history_pdf_1',
      correlationId: 'correlation_medication_history_pdf_1',
    });
  });

  it('leaves unexpected response creation failures to the shared wrapper boundary', async () => {
    buildMedicationHistoryPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'medications.pdf',
    });
    pdfResponseMock.mockImplementationOnce(() => {
      throw new Error('患者 山田花子 090-1234-5678 raw medication history response detail');
    });

    await expect(
      GET(createGetRequest(), {
        params: Promise.resolve({ id: 'patient_1' }),
      }),
    ).rejects.toThrow('raw medication history response detail');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the medication history PDF export audit cannot be recorded', async () => {
    buildMedicationHistoryPdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'medications.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 provider raw error'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'MEDICATION_HISTORY_PDF_EXPORT_AUDIT_FAILED',
      message: '薬歴 PDF 出力監査を記録できませんでした',
    });
    expect(JSON.stringify(body)).not.toContain('山田 太郎');
    expect(JSON.stringify(body)).not.toContain('provider raw error');
    expect(recordDataExportAuditMock).toHaveBeenCalledTimes(1);
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before building or auditing the pdf', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(buildMedicationHistoryPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not audit or render a pdf when the scoped patient lookup fails', async () => {
    buildMedicationHistoryPdfMock.mockRejectedValue(new PdfNotFoundError('patient'));

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildMedicationHistoryPdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 の薬歴が見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('薬歴 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildMedicationHistoryPdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildMedicationHistoryPdfMock.mockRejectedValue(
      new Error('patient_1 raw medication history render failure'),
    );

    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expectRequestTrace(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('薬歴 PDF を生成できませんでした');
    expect(body).not.toContain('patient_1 raw medication history render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
