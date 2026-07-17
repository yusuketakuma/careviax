import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  patientLockExecuteRawMock,
  firstVisitDocumentFindManyMock,
  firstVisitDocumentUpdateManyMock,
  auditLogFindManyMock,
  auditLogCreateMock,
  getPatientDocumentsDataMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientLockExecuteRawMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  firstVisitDocumentUpdateManyMock: vi.fn(),
  auditLogFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  getPatientDocumentsDataMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
    options: unknown,
  ) => {
    return async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      withRoutePerformanceMock(req, async () => {
        let response: Response;
        try {
          const authResult = await requireAuthContextMock(req, options);
          response =
            authResult && typeof authResult === 'object' && 'response' in authResult
              ? authResult.response
              : await runWithRequestAuthContextMock(authResult.ctx, () =>
                  handler(req, authResult.ctx, routeContext),
                );
        } catch (error) {
          loggerErrorMock(
            {
              event: 'route_handler_unhandled_error',
              route: req.nextUrl.pathname,
              method: req.method,
            },
            error,
          );
          response = new Response(
            JSON.stringify({
              code: 'INTERNAL_ERROR',
              message: 'サーバー内部でエラーが発生しました',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      });
  },
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-detail-documents', () => ({
  getPatientDocumentsData: getPatientDocumentsDataMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createPostRequest(body: unknown) {
  let versionedBody = body;
  if (
    typeof body === 'object' &&
    body !== null &&
    'document_ids' in body &&
    Array.isArray(body.document_ids)
  ) {
    const { document_ids, ...rest } = body;
    versionedBody = {
      ...rest,
      documents: document_ids.map((id) => ({
        id,
        expected_updated_at: '2026-06-16T00:00:00.000Z',
      })),
    };
  }
  return new NextRequest('http://localhost/api/first-visit-documents/print-batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'user-agent': 'vitest',
    },
    body: JSON.stringify(versionedBody),
  });
}

function buildAuthContext(req: NextRequest & { role?: string }) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    role: req.role ?? 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  };
}

describe('/api/first-visit-documents/print-batch', () => {
  const updatedAt = new Date('2026-06-16T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    patientLockExecuteRawMock.mockResolvedValue(1);
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        id: 'doc_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: null,
        delivered_at: null,
        delivered_to: null,
        updated_at: updatedAt,
      },
      {
        id: 'doc_2',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: '/existing-copy',
        delivered_at: new Date('2026-06-15T00:00:00.000Z'),
        delivered_to: '長女 山田花子',
        updated_at: updatedAt,
      },
    ]);
    firstVisitDocumentUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogFindManyMock.mockResolvedValue([
      {
        target_id: 'doc_1',
        changes: {
          document_action: {
            action: 'generated',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            storage_location: 'store',
          },
        },
      },
      {
        target_id: 'doc_2',
        changes: {
          document_action: {
            action: 'generated',
            document_type: 'important_matters',
            template_name: '重要事項説明書',
            template_version: 'v2',
            storage_location: 'headquarters',
          },
        },
      },
    ]);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    getPatientDocumentsDataMock.mockResolvedValue({
      print_readiness: {
        overall_status: 'ready',
        missing_required_count: 0,
        warning_count: 0,
        template_versions: [],
        checks: [],
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        $executeRaw: patientLockExecuteRawMock,
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        firstVisitDocument: {
          findMany: firstVisitDocumentFindManyMock,
          updateMany: firstVisitDocumentUpdateManyMock,
        },
        auditLog: {
          findMany: auditLogFindManyMock,
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('records all selected first-visit documents with one server-generated print batch id', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '初回文書の印刷権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    const body = await response.json();
    expect(body.data).toMatchObject({
      printed_document_ids: ['doc_1', 'doc_2'],
      document_count: 2,
    });
    expect(body.data.print_batch_id).toMatch(/^print_[0-9A-Za-z]+_[0-9a-f]{12}$/);

    expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['doc_1', 'doc_2'] },
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        document_url: true,
        delivered_at: true,
        delivered_to: true,
        updated_at: true,
      },
    });
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(auditLogCreateMock).toHaveBeenCalledTimes(2);
    expect(firstVisitDocumentUpdateManyMock.mock.invocationCallOrder[1]).toBeLessThan(
      auditLogCreateMock.mock.invocationCallOrder[0]!,
    );
    const printBatchIds = auditLogCreateMock.mock.calls.map(
      ([args]) => args.data.changes.document_action.print_batch_id,
    );
    expect(printBatchIds).toEqual([body.data.print_batch_id, body.data.print_batch_id]);
    expect(new Set(printBatchIds).size).toBe(1);
    expect(auditLogCreateMock).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        action: 'first_visit_document.printed',
        target_id: 'doc_1',
        changes: expect.objectContaining({
          document_action: expect.objectContaining({
            action: 'printed',
            document_type: 'contract',
            template_name: '居宅療養管理指導契約書',
            template_version: 'v1.1',
            storage_location: 'store',
            print_batch_id: body.data.print_batch_id,
          }),
          next: expect.objectContaining({
            document_url:
              '/reports/print?type=first_visit_documents&patient_id=patient_1&document_id=doc_1&copy=1',
          }),
        }),
      }),
    });
  });

  it('does not write partial audit history when any selected document is missing', async () => {
    firstVisitDocumentFindManyMock.mockResolvedValueOnce([
      {
        id: 'doc_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: null,
        delivered_at: null,
        delivered_to: null,
        updated_at: updatedAt,
      },
    ]);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_missing'],
      }),
    ))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('blocks the whole batch when print readiness is incomplete', async () => {
    getPatientDocumentsDataMock.mockResolvedValueOnce({
      print_readiness: {
        overall_status: 'blocked',
        missing_required_count: 1,
        warning_count: 0,
        template_versions: [],
        checks: [
          {
            key: 'care_insurance',
            label: '介護保険情報',
            completed: false,
            severity: 'required',
            description: '介護保険番号を確認します。',
            action_href: '/patients/patient_1#care-insurance',
            action_label: '保険情報へ',
          },
        ],
      },
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '初回文書の印刷前チェックで必須項目が未完了です。不足: 介護保険情報',
    });
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before print readiness, document updates, or audit writes', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(getPatientDocumentsDataMock).not.toHaveBeenCalled();
    expect(auditLogFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('does not create audit history when a copy URL update conflicts', async () => {
    firstVisitDocumentUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: { reason: 'first_visit_document_version_conflict' },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('claims every exact version even when save_copy is false', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_2', 'doc_1'],
        save_copy: false,
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: 'doc_1' }) }),
    );
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: 'doc_2' }) }),
    );
  });

  it('claims all rows before audits and reports a mid-batch conflict without audit writes', async () => {
    firstVisitDocumentUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: false,
      }),
    ))!;

    expect(response.status).toBe(409);
    expect(firstVisitDocumentUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate document ids before entering the transaction', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        documents: [
          { id: 'doc_1', expected_updated_at: updatedAt.toISOString() },
          { id: 'doc_1', expected_updated_at: updatedAt.toISOString() },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('maps known transaction conflict P2034 to a fixed 409', async () => {
    withOrgContextMock.mockRejectedValueOnce({ code: 'P2034' });

    const response = (await POST(
      createPostRequest({ patient_id: 'patient_1', document_ids: ['doc_1'] }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
  });

  it('does not mask broad P2028 transaction failures as stale document conflicts', async () => {
    withOrgContextMock.mockRejectedValueOnce({ code: 'P2028' });

    const response = (await POST(
      createPostRequest({ patient_id: 'patient_1', document_ids: ['doc_1'] }),
    ))!;

    expect(response.status).toBe(500);
  });

  it('rejects an empty document list before entering the transaction', async () => {
    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: [],
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when the print batch transaction fails unexpectedly', async () => {
    const err = new Error('患者 山田太郎 raw first visit print batch secret');
    err.name = 'FirstVisitDocumentPrintBatchSecretError';
    withOrgContextMock.mockRejectedValueOnce(err);

    const response = (await POST(
      createPostRequest({
        patient_id: 'patient_1',
        document_ids: ['doc_1', 'doc_2'],
        save_copy: true,
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw first visit');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'route_handler_unhandled_error',
        route: '/api/first-visit-documents/print-batch',
        method: 'POST',
      }),
      err,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(err);
    expect(logContext).not.toHaveProperty('error_name');
    const logContextText = JSON.stringify(logContext);
    expect(logContextText).not.toContain('山田太郎');
    expect(logContextText).not.toContain('raw first visit');
    expect(logContextText).not.toContain('FirstVisitDocumentPrintBatchSecretError');
    expect(firstVisitDocumentUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
