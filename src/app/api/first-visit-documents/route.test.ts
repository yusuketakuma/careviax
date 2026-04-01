import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  firstVisitDocumentFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/first-visit-documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        firstVisitDocument: {
          create: vi.fn().mockResolvedValue({
            id: 'doc_2',
            patient_id: 'patient_1',
            case_id: 'case_1',
            emergency_contacts: [{ name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' }],
          }),
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with documents', async () => {
      const response = (await GET(createRequest('http://localhost/api/first-visit-documents?patient_id=patient_1')))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST', () => {
    it('returns 201 when creating a document', async () => {
      const response = (await POST(
        createRequest('http://localhost/api/first-visit-documents', {
          patient_id: 'patient_1',
          case_id: 'case_1',
          emergency_contacts: [{ name: '山田太郎', relationship: '配偶者', phone: '090-1234-5678' }],
        }),
      ))!;

      expect(response.status).toBe(201);
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
