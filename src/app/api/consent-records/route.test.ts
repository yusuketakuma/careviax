import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';
import {
  buildConsentAuthContext,
  createConsentRecordsRequest as createRequest,
  createMalformedConsentRecordPostRequest as createMalformedPostRequest,
} from './route.test-fixtures';

const {
  loggerErrorMock,
  unstableRethrowMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  consentRecordFindManyMock,
  consentRecordCountMock,
  consentRecordFindFirstMock,
  templateFindFirstMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  fileAssetFindFirstMock,
  validateOrgReferencesMock,
  consentRecordCreateMock,
  advisoryLockMock,
  withOrgContextMock,
  recordConsentRecordsViewedAuditMock,
  recordConsentRecordCreatedAuditMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  unstableRethrowMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  consentRecordFindManyMock: vi.fn(),
  consentRecordCountMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  fileAssetFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  consentRecordCreateMock: vi.fn(),
  advisoryLockMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  recordConsentRecordsViewedAuditMock: vi.fn(),
  recordConsentRecordCreatedAuditMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: ReturnType<typeof buildAuthContext>,
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) =>
    async (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      withRoutePerformanceMock(req, async () => {
        let authResult: { ctx: ReturnType<typeof buildAuthContext> } | { response: Response };
        try {
          authResult = await requireAuthContextMock(req, options);
        } catch (error) {
          unstableRethrowMock(error);
          const trace = {
            requestId: 'generated_request_1',
            correlationId: req.headers.get('x-correlation-id') ?? 'generated_request_1',
          };
          loggerErrorMock(
            {
              event: 'route_auth_unhandled_error',
              route: req.nextUrl.pathname,
              method: req.method,
              requestId: trace.requestId,
              correlationId: trace.correlationId,
            },
            error,
          );
          const response = NextResponse.json(
            { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
            { status: 500 },
          );
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Pragma', 'no-cache');
          response.headers.set('X-Request-Id', trace.requestId);
          response.headers.set('X-Correlation-Id', trace.correlationId);
          return response;
        }
        if ('response' in authResult) {
          authResult.response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          authResult.response.headers.set('Pragma', 'no-cache');
          return authResult.response;
        }
        return runWithRequestAuthContextMock(authResult.ctx, async () => {
          try {
            const response = await handler(req, authResult.ctx, routeContext);
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          } catch (error) {
            unstableRethrowMock(error);
            loggerErrorMock(
              {
                event: 'route_handler_unhandled_error',
                route: req.nextUrl.pathname,
                method: req.method,
                requestId: authResult.ctx.requestId,
                correlationId: authResult.ctx.correlationId,
              },
              error,
            );
            const response = NextResponse.json(
              { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
              { status: 500 },
            );
            response.headers.set('Cache-Control', 'private, no-store, max-age=0');
            response.headers.set('Pragma', 'no-cache');
            response.headers.set('X-Request-Id', authResult.ctx.requestId);
            response.headers.set('X-Correlation-Id', authResult.ctx.correlationId);
            return response;
          }
        });
      }),
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
  prisma: {
    consentRecord: {
      findMany: consentRecordFindManyMock,
      count: consentRecordCountMock,
      findFirst: consentRecordFindFirstMock,
    },
    template: {
      findFirst: templateFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    fileAsset: {
      findFirst: fileAssetFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: advisoryLockMock,
}));

vi.mock('@/server/services/consent-record-audit', () => ({
  recordConsentRecordsViewedAudit: recordConsentRecordsViewedAuditMock,
  recordConsentRecordCreatedAudit: recordConsentRecordCreatedAuditMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

const buildAuthContext = (req: NextRequest & { role?: string }) =>
  buildConsentAuthContext(req.role === undefined ? 'pharmacist' : req.role);

describe('/api/consent-records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    unstableRethrowMock.mockImplementation(() => undefined);
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent_1',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        document_url: 'https://files.example.test/legacy-consent.pdf',
      },
    ]);
    consentRecordCountMock.mockResolvedValue(1);
    consentRecordFindFirstMock.mockResolvedValue(null);
    templateFindFirstMock.mockResolvedValue({ id: 'template_1', version: 2 });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    fileAssetFindFirstMock.mockResolvedValue({ id: 'file_1' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    recordConsentRecordsViewedAuditMock.mockResolvedValue(undefined);
    recordConsentRecordCreatedAuditMock.mockResolvedValue(undefined);
    advisoryLockMock.mockResolvedValue(undefined);
    consentRecordCreateMock.mockResolvedValue({
      id: 'consent_2',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      document_url: null,
      document_file_id: null,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
          create: consentRecordCreateMock,
        },
        template: {
          findFirst: templateFindFirstMock,
        },
      }),
    );
  });

  it('rejects GET authentication before query, request context, or database work', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
    });
    const request = createRequest('http://localhost/api/consent-records?patient_id=patient_1');

    const response = (await GET(request))!;

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(request, {
      permission: 'canVisit',
      message: '同意記録の閲覧には訪問権限が必要です',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(recordConsentRecordsViewedAuditMock).not.toHaveBeenCalled();
  });

  it('rejects POST authentication before reading malformed JSON or mutation work', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
    });
    const request = createMalformedPostRequest('http://localhost/api/consent-records');

    const response = (await POST(request))!;

    expect(response.status).toBe(403);
    expectNoStore(response);
    expect(request.bodyUsed).toBe(false);
    expect(requireAuthContextMock).toHaveBeenCalledWith(request, {
      permission: 'canVisit',
      message: '同意記録の作成には訪問権限が必要です',
    });
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', () => GET(createRequest('http://localhost/api/consent-records?patient_id=patient_1'))],
    ['POST', () => POST(createMalformedPostRequest('http://localhost/api/consent-records'))],
  ] as const)(
    'returns a generated-trace safe 500 when %s authentication throws',
    async (method, invoke) => {
      const unsafeError = new Error('患者 山田太郎 raw consent auth secret');
      requireAuthContextMock.mockRejectedValueOnce(unsafeError);

      const response = (await invoke())!;

      expect(response.status).toBe(500);
      expectNoStore(response);
      expect(response.headers.get('X-Request-Id')).toBe('generated_request_1');
      expect(response.headers.get('X-Correlation-Id')).toBe('generated_request_1');
      await expect(response.json()).resolves.toEqual({
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
      });
      expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalledWith(
        {
          event: 'route_auth_unhandled_error',
          route: '/api/consent-records',
          method,
          requestId: 'generated_request_1',
          correlationId: 'generated_request_1',
        },
        unsafeError,
      );
      expect(JSON.stringify(loggerErrorMock.mock.calls[0]?.[0])).not.toContain('山田太郎');
    },
  );

  it('rethrows GET authentication control-flow without logging or database work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    requireAuthContextMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      GET(createRequest('http://localhost/api/consent-records?patient_id=patient_1')),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(recordConsentRecordsViewedAuditMock).not.toHaveBeenCalled();
  });

  it('rethrows POST handler control-flow without logging or mutation work', async () => {
    const controlFlowError = new Error('NEXT_REDIRECT');
    validateOrgReferencesMock.mockRejectedValueOnce(controlFlowError);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(
      POST(
        createRequest('http://localhost/api/consent-records', {
          patient_id: 'patient_1',
          consent_type: 'external_sharing',
          method: 'paper_scan',
          obtained_date: '2026-03-29',
        }),
      ),
    ).rejects.toBe(controlFlowError);

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('lists consent records for the target patient', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/consent-records?patient_id=patient_1&consent_type=external_sharing',
      ),
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '同意記録の閲覧には訪問権限が必要です',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(consentRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          consent_type: 'external_sharing',
          is_active: true,
        }),
        orderBy: [{ obtained_date: 'desc' }, { id: 'desc' }],
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: 'consent_1',
          document_url: null,
          has_document_url: true,
          document_url_redacted: true,
        },
      ],
      meta: {
        limit: 50,
        has_more: false,
        next_cursor: null,
        total_count: 1,
      },
    });
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body).not.toHaveProperty('totalCount');
    expect(JSON.stringify(body)).not.toContain('legacy-consent.pdf');
    expect(recordConsentRecordsViewedAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consentRecord: expect.objectContaining({
          findMany: consentRecordFindManyMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      expect.objectContaining({
        patientId: 'patient_1',
        caseId: null,
        consentType: 'external_sharing',
        isActive: true,
        limit: expect.any(Number),
        hasCursor: false,
        hasMore: false,
        totalCount: 1,
        records: [
          {
            id: 'consent_1',
            document_url: 'https://files.example.test/legacy-consent.pdf',
          },
        ],
      }),
    );
  });

  it('returns a cursor page and audits only visible consent records when rows overflow', async () => {
    consentRecordFindManyMock.mockResolvedValueOnce([
      {
        id: 'consent_1',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        document_url: 'https://files.example.test/visible-consent.pdf',
      },
      {
        id: 'consent_2',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        document_url: 'https://files.example.test/hidden-consent.pdf',
      },
    ]);
    consentRecordCountMock.mockResolvedValueOnce(2);

    const response = (await GET(
      createRequest('http://localhost/api/consent-records?patient_id=patient_1&limit=1'),
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(consentRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );

    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: 'consent_1',
          document_url: null,
          has_document_url: true,
          document_url_redacted: true,
        },
      ],
      meta: {
        limit: 1,
        has_more: true,
        next_cursor: 'consent_1',
        total_count: 2,
      },
    });
    expect(body).not.toHaveProperty('hasMore');
    expect(body).not.toHaveProperty('nextCursor');
    expect(body).not.toHaveProperty('totalCount');
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('hidden-consent.pdf');
    expect(recordConsentRecordsViewedAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        limit: 1,
        hasMore: true,
        totalCount: 2,
        records: [
          {
            id: 'consent_1',
            document_url: 'https://files.example.test/visible-consent.pdf',
          },
        ],
      }),
    );
  });

  it('fails closed when consent list view audit cannot be recorded', async () => {
    const unsafeError = new Error(
      'audit unavailable for raw consent document https://files.example.test/leak.pdf',
    );
    unsafeError.name = 'ConsentListAuditSecretError';
    recordConsentRecordsViewedAuditMock.mockRejectedValueOnce(unsafeError);

    // 監査記録に失敗したら成功扱いにせず fail closed。shared route boundary が想定外 throw を
    // 標準 500 エンベロープに変換するため、200 ではなく 500/INTERNAL_ERROR を返す。
    const response = (await GET(
      createRequest('http://localhost/api/consent-records?patient_id=patient_1'),
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = (await response.json()) as { code?: string; data?: unknown };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('leak.pdf');
    // 監査未記録のまま同意レコードを漏らさない
    expect(body.data).toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/consent-records',
        method: 'GET',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('leak.pdf');
    expect(logged).not.toContain('ConsentListAuditSecretError');
  });

  it('returns no-store validation errors for missing patient ids', async () => {
    const response = (await GET(createRequest('http://localhost/api/consent-records')))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'patient_idは必須です',
    });
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(recordConsentRecordsViewedAuditMock).not.toHaveBeenCalled();
  });

  it('does not list consent records outside the patient assignment scope', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = (await GET(
      createRequest('http://localhost/api/consent-records?patient_id=patient_forbidden'),
    ))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordCountMock).not.toHaveBeenCalled();
    expect(recordConsentRecordsViewedAuditMock).not.toHaveBeenCalled();
  });

  it('creates a consent record when no active duplicate exists', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(response.headers.get('X-Request-Id')).toBe('request_1');
    expect(response.headers.get('X-Correlation-Id')).toBe('correlation_1');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '同意記録の作成には訪問権限が必要です',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.any(Function),
    );
    expect(runWithRequestAuthContextMock).toHaveBeenCalledTimes(2);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      patient_id: 'patient_1',
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(consentRecordCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        template_id: 'template_1',
        template_version: 2,
        consent_type: 'external_sharing',
        method: 'paper_scan',
        document_url: null,
        document_file_id: null,
      }),
    });
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'consent_record_active_dedup',
      'org_1:patient_1:external_sharing',
    );
    expect(recordConsentRecordCreatedAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consentRecord: expect.objectContaining({
          findFirst: consentRecordFindFirstMock,
          create: consentRecordCreateMock,
        }),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      expect.objectContaining({
        id: 'consent_2',
        patient_id: 'patient_1',
        document_url: null,
        document_file_id: null,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'consent_2',
        document_url: null,
        has_document_url: false,
        document_url_redacted: false,
      },
    });
  });

  it('creates a consent record with a validated consent document file asset', async () => {
    consentRecordCreateMock.mockResolvedValueOnce({
      id: 'consent_2',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      document_url: '/api/files/file_1/download',
      document_file_id: 'file_1',
    });

    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
        document_file_id: 'file_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(fileAssetFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'file_1',
        org_id: 'org_1',
        purpose: 'consent-document',
        status: 'uploaded',
        mime_type: { in: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(consentRecordCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        document_url: '/api/files/file_1/download',
        document_file_id: 'file_1',
      }),
    });
    expect(recordConsentRecordCreatedAuditMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        document_url: '/api/files/file_1/download',
        has_document_url: true,
        document_url_redacted: false,
      },
    });
  });

  it('rejects an unbound consent document file before transaction or audit work', async () => {
    fileAssetFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
        document_file_id: 'file_1',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(fileAssetFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('stops after organization-reference validation failure without access or mutation work', async () => {
    validateOrgReferencesMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 }),
    });

    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        case_id: 'case_other',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(fileAssetFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('serializes concurrent active consent creates and lets one request detect the duplicate in-transaction (TOCTOU guard)', async () => {
    let activeConsentId: string | null = null;
    let transactionChain = Promise.resolve();
    const tx = {
      consentRecord: {
        findFirst: consentRecordFindFirstMock,
        create: consentRecordCreateMock,
      },
      template: {
        findFirst: templateFindFirstMock,
      },
    };
    consentRecordFindFirstMock.mockImplementation(async () =>
      activeConsentId ? { id: activeConsentId } : null,
    );
    consentRecordCreateMock.mockImplementation(async ({ data }) => {
      activeConsentId = 'consent_2';
      return {
        id: activeConsentId,
        patient_id: data.patient_id,
        consent_type: data.consent_type,
        document_url: data.document_url,
        document_file_id: data.document_file_id,
      };
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      const previousTransaction = transactionChain;
      let releaseTransaction!: () => void;
      transactionChain = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      await previousTransaction;
      try {
        return await callback(tx);
      } finally {
        releaseTransaction();
      }
    });

    const payload = {
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      method: 'paper_scan',
      obtained_date: '2026-03-29',
    };
    const responses = await Promise.all([
      POST(createRequest('http://localhost/api/consent-records', payload)),
      POST(createRequest('http://localhost/api/consent-records', payload)),
    ]);
    const createdResponse = responses.find((response) => response?.status === 201);
    const duplicateResponse = responses.find((response) => response?.status === 400);

    expect(createdResponse?.status).toBe(201);
    expect(duplicateResponse?.status).toBe(400);
    expectNoStore(duplicateResponse!);
    await expect(duplicateResponse!.json()).resolves.toMatchObject({
      message: 'この患者にはすでに有効な同意記録が存在します',
      details: {
        consent_type: ['同一種別の有効な同意がすでに存在します'],
      },
    });
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(advisoryLockMock).toHaveBeenCalledTimes(2);
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'consent_record_active_dedup',
      'org_1:patient_1:external_sharing',
    );
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        is_active: true,
      },
      select: { id: true },
    });
    expect(advisoryLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      consentRecordFindFirstMock.mock.invocationCallOrder[0],
    );
    expect(advisoryLockMock.mock.invocationCallOrder[1]).toBeLessThan(
      consentRecordFindFirstMock.mock.invocationCallOrder[1],
    );
    expect(consentRecordCreateMock).toHaveBeenCalledTimes(1);
    expect(recordConsentRecordCreatedAuditMock).toHaveBeenCalledTimes(1);
  });

  it('rejects external consent document urls before lookups or create side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
        document_url: 'https://files.example.test/legacy-consent.pdf',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('rejects absolute audited-looking consent document urls before create side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
        document_url: 'https://evil.example/api/files/file_1/download',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('does not create consent records outside the patient assignment scope', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_forbidden',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      }),
    ))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });

  it('fails closed when consent create audit cannot be recorded', async () => {
    const unsafeError = new Error(
      'audit unavailable for raw consent document https://files.example.test/leak.pdf',
    );
    unsafeError.name = 'ConsentCreateAuditSecretError';
    recordConsentRecordCreatedAuditMock.mockRejectedValueOnce(unsafeError);

    // 監査記録に失敗したら成功(2xx)を返さず fail closed。shared route boundary が想定外 throw を
    // 標準 500 エンベロープに変換するため、クライアントには 500/INTERNAL_ERROR を返す。
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('leak.pdf');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/consent-records',
        method: 'POST',
        requestId: 'request_1',
        correlationId: 'correlation_1',
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('leak.pdf');
    expect(logged).not.toContain('ConsentCreateAuditSecretError');
    expect(consentRecordCreateMock).toHaveBeenCalled();
  });

  it('rejects non-object request bodies before validation lookups or create side effects', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/consent-records', ['unexpected']),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before validation lookups or create side effects', async () => {
    const response = (await POST(
      createMalformedPostRequest('http://localhost/api/consent-records'),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
  });

  it('returns validation error when an explicit template_id is not found', async () => {
    templateFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/consent-records', {
        patient_id: 'patient_1',
        template_id: 'template_missing',
        consent_type: 'external_sharing',
        method: 'paper_scan',
        obtained_date: '2026-03-29',
      }),
    ))!;

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        template_id: ['指定されたテンプレートを確認できません'],
      },
    });
    expect(consentRecordCreateMock).not.toHaveBeenCalled();
    expect(recordConsentRecordCreatedAuditMock).not.toHaveBeenCalled();
  });
});
