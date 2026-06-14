import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  firstVisitDocumentCreateMock,
  firstVisitDocumentFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  firstVisitDocumentCreateMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

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

describe('/api/first-visit-documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
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
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
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
      // org-wide ロール(pharmacist)は担当割当をバイパスするため、
      // アクセス可能ケースの絞り込み(careCase.findMany)は行われず、
      // 取得 where には case_id フィルタが付かない(org + patient のみ)。
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id: 'org_1',
            patient_id: 'patient_1',
          },
        }),
      );
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST', () => {
    it('rejects non-object JSON payloads before case access check or document creation', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', []),
      ))!;

      expect(response.status).toBe(400);
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
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: ' 090-1234-5678 ' },
          ],
        }),
      ))!;

      expect(response.status).toBe(201);
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
          emergency_contacts: [
            { name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' },
          ],
        }),
      });
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
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 400 with invalid body', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: '',
        }),
      ))!;

      expect(response.status).toBe(400);
    });
  });
});
