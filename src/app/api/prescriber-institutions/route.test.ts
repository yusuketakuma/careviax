import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const { prescriberInstitutionFindManyMock, prescriberInstitutionCreateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    prescriberInstitutionFindManyMock: vi.fn(),
    prescriberInstitutionCreateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriberInstitution: {
      findMany: prescriberInstitutionFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown, role = 'pharmacist'): AuthenticatedTestRequest {
  return Object.assign(
    new NextRequest(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { orgId: 'org_1', userId: 'user_1', role },
  );
}

function createMalformedJsonRequest(role = 'admin'): AuthenticatedTestRequest {
  return Object.assign(
    new NextRequest('http://localhost/api/prescriber-institutions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }),
    { orgId: 'org_1', userId: 'user_1', role },
  );
}

describe('/api/prescriber-institutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prescriberInstitutionFindManyMock.mockResolvedValue([
      {
        id: 'institution_1',
        name: 'みなとクリニック',
        institution_code: '1234567',
        address: '東京都港区1-1-1',
        phone: '03-1111-2222',
        fax: '03-1111-3333',
        notes: null,
        _count: {
          prescription_intakes: 4,
        },
        prescription_intakes: [{ prescribed_date: new Date('2026-03-28T00:00:00.000Z') }],
        created_at: new Date('2026-03-20T00:00:00.000Z'),
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
    prescriberInstitutionCreateMock.mockResolvedValue({
      id: 'institution_2',
      name: 'さくら病院',
      institution_code: '7654321',
      address: '東京都千代田区2-2-2',
      phone: '03-9999-2222',
      fax: '03-9999-3333',
      notes: '主治医向け',
      created_at: new Date('2026-03-28T00:00:00.000Z'),
      updated_at: new Date('2026-03-28T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriberInstitution: {
          create: prescriberInstitutionCreateMock,
        },
      }),
    );
  });

  it('lists institutions with usage summary', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/prescriber-institutions?q=みなと'),
    ))!;

    expect(response.status).toBe(200);
    expect(prescriberInstitutionFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [
          { name: { contains: 'みなと', mode: 'insensitive' } },
          { institution_code: { contains: 'みなと', mode: 'insensitive' } },
          { address: { contains: 'みなと', mode: 'insensitive' } },
        ],
      },
      include: {
        _count: {
          select: {
            prescription_intakes: true,
          },
        },
        prescription_intakes: {
          orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
          take: 1,
          select: {
            prescribed_date: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'institution_1',
          prescription_count: 4,
          last_prescribed_at: '2026-03-28T00:00:00.000Z',
        },
      ],
    });
  });

  it('creates an institution master row', async () => {
    const response = (await POST(
      createRequest(
        'http://localhost/api/prescriber-institutions',
        {
          name: 'さくら病院',
          institution_code: '7654321',
          phone: ' 03-9999-2222 ',
          fax: ' 03-9999-3333 ',
          notes: '主治医向け',
        },
        'admin',
      ),
    ))!;

    expect(response.status).toBe(201);
    expect(prescriberInstitutionCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        name: 'さくら病院',
        institution_code: '7654321',
        address: null,
        phone: '03-9999-2222',
        fax: '03-9999-3333',
        notes: '主治医向け',
      },
    });
  });

  it('normalizes blank optional contact fields to null on create', async () => {
    const response = (await POST(
      createRequest(
        'http://localhost/api/prescriber-institutions',
        {
          name: 'さくら病院',
          phone: '   ',
          fax: '\t',
        },
        'admin',
      ),
    ))!;

    expect(response.status).toBe(201);
    expect(prescriberInstitutionCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        name: 'さくら病院',
        institution_code: null,
        address: null,
        phone: null,
        fax: null,
        notes: null,
      },
    });
  });

  it('rejects malformed contact numbers before opening an org transaction', async () => {
    const response = (await POST(
      createRequest(
        'http://localhost/api/prescriber-institutions',
        {
          name: 'さくら病院',
          phone: '03-ABCD-2222',
          fax: 'FAX-3333',
        },
        'admin',
      ),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        phone: ['電話番号形式が不正です'],
        fax: ['FAX番号形式が不正です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/prescriber-institutions', [], 'admin'),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriberInstitutionCreateMock).not.toHaveBeenCalled();
  });
});
