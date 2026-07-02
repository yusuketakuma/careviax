import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  auditLogCreateMock,
  contactPartyFindManyMock,
  firstVisitDocumentCreateMock,
  firstVisitDocumentFindManyMock,
  templateFindFirstMock,
  requireWritablePatientMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  firstVisitDocumentCreateMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
    template: {
      findFirst: templateFindFirstMock,
    },
    contactParty: {
      findMany: contactPartyFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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

describe('/api/first-visit-documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockImplementation(async (req) => ({ ctx: buildAuthContext(req) }));
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, callback) => callback());
    requireWritablePatientMock.mockResolvedValue({
      patient: { id: 'patient_1', archived_at: null },
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    firstVisitDocumentFindManyMock.mockResolvedValue([
      {
        id: 'doc_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        emergency_contacts: [],
        document_url: null,
        delivered_at: null,
        delivered_to: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    firstVisitDocumentCreateMock.mockResolvedValue({
      id: 'doc_2',
      patient_id: 'patient_1',
      case_id: 'case_1',
      emergency_contacts: [{ name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' }],
      delivered_at: null,
      delivered_to: null,
      document_url: '/api/visit-records/record_1/pdf',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
    });
    templateFindFirstMock.mockResolvedValue({
      id: 'template_default',
      name: '初回契約セット',
      template_type: 'consent_form',
      version: 3,
    });
    contactPartyFindManyMock.mockResolvedValue([
      {
        name: '山田花子',
        relation: 'child',
        phone: '090-1111-2222',
        email: null,
        fax: null,
        organization_name: '山田家',
        department: null,
        is_primary: true,
        is_emergency_contact: true,
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        auditLog: {
          create: auditLogCreateMock,
        },
        firstVisitDocument: {
          create: firstVisitDocumentCreateMock,
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with documents', async () => {
      const response = (await GET(
        createRequest('http://localhost/api/first-visit-documents?patient_id=patient_1'),
      ))!;

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      expect(withRoutePerformanceMock).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.any(Function),
      );
      expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
        permission: 'canVisit',
        message: '初回文書の閲覧権限がありません',
      });
      expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
        expect.any(Function),
      );
      // org-wide ロール(pharmacist)は担当割当をバイパスするため、
      // アクセス可能ケースの絞り込み(careCase.findMany)は行われず、
      // 取得 where には case_id フィルタが付かない(org + patient のみ)。
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          where: {
            org_id: 'org_1',
            patient_id: 'patient_1',
          },
        }),
      );
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });

    it('returns 200 with a valid case filter', async () => {
      const response = (await GET(
        createRequest(
          'http://localhost/api/first-visit-documents?patient_id=patient_1&case_id=case_1',
        ),
      ))!;

      expect(response.status).toBe(200);
      expectSensitiveNoStore(response);
      expect(careCaseFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'case_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
        },
        select: { id: true },
      });
      expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id: 'org_1',
            patient_id: 'patient_1',
            case_id: 'case_1',
          },
        }),
      );
    });

    it.each([
      ['patient_id', 'patient_id=', { patient_id: ['patient_id を指定してください'] }],
      ['blank patient_id', 'patient_id=%20%20', { patient_id: ['patient_id を指定してください'] }],
      [
        'padded patient_id',
        'patient_id=%20patient_1',
        { patient_id: ['patient_id の形式が不正です'] },
      ],
      [
        'overlong patient_id',
        `patient_id=${'p'.repeat(101)}`,
        { patient_id: ['patient_id の形式が不正です'] },
      ],
      [
        'duplicate patient_id',
        'patient_id=patient_1&patient_id=patient_2',
        { patient_id: ['patient_id は1つだけ指定してください'] },
      ],
      ['case_id', 'case_id=', { case_id: ['case_id を指定してください'] }],
      ['blank case_id', 'case_id=%20%20', { case_id: ['case_id を指定してください'] }],
      ['padded case_id', 'case_id=case_1%20', { case_id: ['case_id の形式が不正です'] }],
      ['overlong case_id', `case_id=${'c'.repeat(101)}`, { case_id: ['case_id の形式が不正です'] }],
      [
        'duplicate case_id',
        'case_id=case_1&case_id=case_2',
        { case_id: ['case_id は1つだけ指定してください'] },
      ],
    ])(
      'rejects malformed explicit %s on read before scope resolution',
      async (_name, query, details) => {
        const response = (await GET(
          createRequest(`http://localhost/api/first-visit-documents?${query}`),
        ))!;

        expect(response.status).toBe(400);
        expectSensitiveNoStore(response);
        await expect(response.json()).resolves.toMatchObject({
          code: 'VALIDATION_ERROR',
          message: '検索条件が不正です',
          details,
        });
        expect(careCaseFindFirstMock).not.toHaveBeenCalled();
        expect(careCaseFindManyMock).not.toHaveBeenCalled();
        expect(firstVisitDocumentFindManyMock).not.toHaveBeenCalled();
      },
    );

    it('returns a sanitized no-store 500 without raw logging when document listing fails unexpectedly', async () => {
      const err = new Error('患者 山田太郎 raw first visit document secret');
      err.name = 'FirstVisitDocumentListSecretError';
      firstVisitDocumentFindManyMock.mockRejectedValueOnce(err);

      const response = (await GET(
        createRequest('http://localhost/api/first-visit-documents?patient_id=patient_1'),
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
          event: 'first_visit_documents_get_unhandled_error',
          route: '/api/first-visit-documents',
          method: 'GET',
          status: 500,
        }),
        err,
      );
      const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
      expect(logError).toBe(err);
      expect(logContext).not.toHaveProperty('error_name');
      const logContextText = JSON.stringify(logContext);
      expect(logContextText).not.toContain('山田太郎');
      expect(logContextText).not.toContain('raw first visit');
      expect(logContextText).not.toContain('FirstVisitDocumentListSecretError');
    });
  });

  describe('POST', () => {
    it('rejects non-object JSON payloads before case access check or document creation', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', []),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'リクエストボディが不正です',
      });
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects malformed emergency contact phone before case access check or document creation', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-ABCD-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '入力値が不正です',
        details: {
          emergency_contacts: expect.arrayContaining(['電話番号形式が不正です']),
        },
      });
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
    });

    it('returns 201 when creating a document', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url: '/api/visit-records/record_1/pdf',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: ' 090-1234-5678 ' },
          ],
        }),
      ))!;

      expect(response.status).toBe(201);
      expectSensitiveNoStore(response);
      expect(withRoutePerformanceMock).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.any(Function),
      );
      expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
        permission: 'canVisit',
        message: '初回文書の作成権限がありません',
      });
      expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
        expect.any(Function),
      );
      expect(careCaseFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'case_1',
          org_id: 'org_1',
          patient_id: 'patient_1',
        },
        select: { id: true },
      });
      expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          document_url: '/api/visit-records/record_1/pdf',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      });
      expect(templateFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            org_id: 'org_1',
            template_type: 'consent_form',
            is_default: true,
          }),
        }),
      );
      expect(auditLogCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'first_visit_document.generated',
          target_type: 'first_visit_document',
          target_id: 'doc_2',
          changes: expect.objectContaining({
            document_action: expect.objectContaining({
              action: 'generated',
              document_type: 'consent',
              template_id: 'template_default',
              template_name: '初回契約セット',
              template_version: '3',
            }),
            patient_id: 'patient_1',
            case_id: 'case_1',
            document_url: '/api/visit-records/record_1/pdf',
          }),
        }),
      });
      const body = await response.json();
      expect(body).toEqual({
        data: {
          id: 'doc_2',
          updated_at: '2026-06-16T00:00:00.000Z',
        },
      });
      expect(body.data).not.toHaveProperty('emergency_contacts');
      expect(body.data).not.toHaveProperty('delivered_to');
      expect(body.data).not.toHaveProperty('document_url');
    });

    it('rejects archived patients before deriving contacts or creating documents', async () => {
      requireWritablePatientMock.mockResolvedValue({
        response: Response.json(
          { message: 'アーカイブ中の患者は復元するまで更新できません' },
          { status: 409 },
        ),
      });

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          template_id: 'template_default',
        }),
      ))!;

      expect(response.status).toBe(409);
      expectSensitiveNoStore(response);
      expect(contactPartyFindManyMock).not.toHaveBeenCalled();
      expect(templateFindFirstMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });

    it('fills emergency contacts from patient contacts when creating from a template', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          template_id: 'template_default',
        }),
      ))!;

      expect(response.status).toBe(201);
      expectSensitiveNoStore(response);
      expect(contactPartyFindManyMock).toHaveBeenCalledWith({
        where: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          OR: [{ is_primary: true }, { is_emergency_contact: true }],
        },
        orderBy: [{ is_primary: 'desc' }, { is_emergency_contact: 'desc' }, { created_at: 'asc' }],
        take: 5,
        select: {
          name: true,
          relation: true,
          phone: true,
          email: true,
          fax: true,
          organization_name: true,
          department: true,
          is_primary: true,
          is_emergency_contact: true,
        },
      });
      expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          emergency_contacts: [
            {
              name: '山田花子',
              relationship: '子',
              relation: '子',
              phone: '090-1111-2222',
              email: null,
              fax: null,
              organization_name: '山田家',
              department: null,
              is_primary: true,
              is_emergency_contact: true,
            },
          ],
        }),
      });
    });

    it('rejects template creation when no emergency contact can be derived', async () => {
      contactPartyFindManyMock.mockResolvedValue([]);

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          template_id: 'template_default',
        }),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          emergency_contacts: ['緊急連絡先を1件以上入力してください'],
        },
      });
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
    });

    it('rejects non-local HTTP document URLs for signed contract files', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url: 'http://files.example.test/contracts/doc_1.pdf',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          document_url: expect.arrayContaining([
            '文書URLは相対パス、HTTPS、またはローカル開発用HTTPで指定してください',
          ]),
        },
      });
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
    });

    it('allows HTTPS document URLs when creating a document', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url: 'https://files.example.test/contracts/doc_1.pdf',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(201);
      expectSensitiveNoStore(response);
      expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          document_url: 'https://files.example.test/contracts/doc_1.pdf',
        }),
      });
    });

    it('uses an explicitly selected first visit template when creating a document', async () => {
      templateFindFirstMock.mockResolvedValue({
        id: 'template_1',
        name: '重要事項説明書',
        template_type: 'important_matters',
        version: 7,
      });

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          template_id: 'template_1',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(201);
      expectSensitiveNoStore(response);
      expect(templateFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'template_1',
          org_id: 'org_1',
          template_type: {
            in: ['contract_document', 'important_matters', 'privacy_consent', 'consent_form'],
          },
        },
        select: {
          id: true,
          name: true,
          template_type: true,
          version: true,
        },
      });
      expect(auditLogCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'first_visit_document.generated',
          changes: expect.objectContaining({
            document_action: expect.objectContaining({
              document_type: 'important_matters',
              template_id: 'template_1',
              template_name: '重要事項説明書',
              template_version: '7',
            }),
          }),
        }),
      });
    });

    it('rejects an explicit first visit template outside the organization', async () => {
      templateFindFirstMock.mockResolvedValue(null);

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          template_id: 'template_other',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          template_id: ['有効な初回文書テンプレートを選択してください'],
        },
      });
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });

    it('returns 404 without creating when the case is outside assignment scope', async () => {
      careCaseFindFirstMock.mockResolvedValue(null);

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_other',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      ))!;

      expect(response.status).toBe(404);
      expectSensitiveNoStore(response);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 400 with invalid body', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: '',
        }),
      ))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
    });

    it('returns a sanitized no-store 500 without raw logging when document creation fails unexpectedly', async () => {
      const err = new Error('患者 山田太郎 raw first visit document create secret');
      err.name = 'FirstVisitDocumentCreateSecretError';
      withOrgContextMock.mockRejectedValueOnce(err);

      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url: '/api/visit-records/record_1/pdf',
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
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
          event: 'first_visit_documents_post_unhandled_error',
          route: '/api/first-visit-documents',
          method: 'POST',
          status: 500,
        }),
        err,
      );
      const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
      expect(logError).toBe(err);
      expect(logContext).not.toHaveProperty('error_name');
      const logContextText = JSON.stringify(logContext);
      expect(logContextText).not.toContain('山田太郎');
      expect(logContextText).not.toContain('raw first visit');
      expect(logContextText).not.toContain('FirstVisitDocumentCreateSecretError');
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
    });
  });
});
