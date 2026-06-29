import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
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
  withOrgContextMock,
  recordConsentRecordsViewedAuditMock,
  recordConsentRecordCreatedAuditMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
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
  withOrgContextMock: vi.fn(),
  recordConsentRecordsViewedAuditMock: vi.fn(),
  recordConsentRecordCreatedAuditMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
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

vi.mock('@/server/services/consent-record-audit', () => ({
  recordConsentRecordsViewedAudit: recordConsentRecordsViewedAuditMock,
  recordConsentRecordCreatedAudit: recordConsentRecordCreatedAuditMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedPostRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"patient_id":',
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

describe('/api/consent-records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
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
          create: consentRecordCreateMock,
        },
      }),
    );
  });

  it('lists consent records for the target patient', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/consent-records?patient_id=patient_1&consent_type=external_sharing',
      ),
    ))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
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
    });
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

  it('fails closed when consent list view audit cannot be recorded', async () => {
    recordConsentRecordsViewedAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for raw consent document https://files.example.test/leak.pdf'),
    );

    // 監査記録に失敗したら成功扱いにせず fail closed。route-local boundary が想定外 throw を
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
      'consent_records_get_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'consent_records_get_unhandled_error',
        route: '/api/consent-records',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('leak.pdf');
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
    expect(recordConsentRecordCreatedAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        consentRecord: expect.objectContaining({
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
  });

  it('creates a consent record with a validated consent document file asset', async () => {
    consentRecordCreateMock.mockResolvedValueOnce({
      id: 'consent_2',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      document_url: '/api/files/file_1/presigned-download?download=1',
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
        document_url: '/api/files/file_1/presigned-download?download=1',
        document_file_id: 'file_1',
      }),
    });
    expect(recordConsentRecordCreatedAuditMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      document_url: '/api/files/file_1/presigned-download?download=1',
      has_document_url: true,
      document_url_redacted: false,
    });
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
        document_url: 'https://evil.example/api/files/file_1/presigned-download?download=1',
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
    recordConsentRecordCreatedAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for raw consent document https://files.example.test/leak.pdf'),
    );

    // 監査記録に失敗したら成功(2xx)を返さず fail closed。route-local boundary が想定外 throw を
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
      'consent_records_post_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'consent_records_post_unhandled_error',
        route: '/api/consent-records',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('leak.pdf');
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
  });
});
