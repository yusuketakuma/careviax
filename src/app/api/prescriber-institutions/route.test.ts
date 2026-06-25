import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestAuthContext = { orgId: string; userId: string; role: 'pharmacist' | 'admin' };
type TestRouteContext = { params: Promise<Record<string, string>> };

const {
  prescriberInstitutionFindManyMock,
  prescriberInstitutionCreateMock,
  withAuthContextMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  prescriberInstitutionFindManyMock: vi.fn(),
  prescriberInstitutionCreateMock: vi.fn(),
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: TestAuthContext,
        routeContext: TestRouteContext,
      ) => Promise<Response>,
    ) => {
      return (
        req: NextRequest,
        routeContext: TestRouteContext = { params: Promise.resolve({}) },
      ) => {
        const role = req.headers.get('x-test-role') === 'admin' ? 'admin' : 'pharmacist';
        return handler(req, { orgId: 'org_1', userId: 'user_1', role }, routeContext);
      };
    },
  ),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(url: string, body?: unknown, role = 'pharmacist') {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? { 'x-test-role': role }
        : { 'content-type': 'application/json', 'x-test-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedJsonRequest(role = 'admin') {
  return new NextRequest('http://localhost/api/prescriber-institutions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-role': role },
    body: '{',
  });
}

function createInstitutionFixture(id: string, name = 'みなとクリニック') {
  return {
    id,
    name,
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
  };
}

describe('/api/prescriber-institutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prescriberInstitutionFindManyMock.mockResolvedValue([
      createInstitutionFixture('institution_1'),
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
      take: 501,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'institution_1',
          prescription_count: 4,
          last_prescribed_at: '2026-03-28T00:00:00.000Z',
        },
      ],
      meta: {
        limit: 500,
        has_more: false,
      },
    });
  });

  it('preserves the complete full list when q is absent', async () => {
    prescriberInstitutionFindManyMock.mockResolvedValue([
      createInstitutionFixture('institution_1', 'みなとクリニック'),
      createInstitutionFixture('institution_2', 'さくら病院'),
    ]);

    const response = (await GET(createRequest('http://localhost/api/prescriber-institutions')))!;

    expect(response.status).toBe(200);
    const query = prescriberInstitutionFindManyMock.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      where: {
        org_id: 'org_1',
      },
      include: expect.any(Object),
      orderBy: [{ name: 'asc' }],
    });
    expect(query).not.toHaveProperty('take');
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body).not.toHaveProperty('meta');
  });

  it('treats blank q as an unfiltered full-list request', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/prescriber-institutions?q=%20%20'),
    ))!;

    expect(response.status).toBe(200);
    expect(prescriberInstitutionFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    await expect(response.json()).resolves.not.toHaveProperty('meta');
  });

  it('trims q-filtered search results and reports has_more', async () => {
    prescriberInstitutionFindManyMock.mockResolvedValue([
      createInstitutionFixture('institution_1', 'みなとクリニック'),
      createInstitutionFixture('institution_2', 'みなと病院'),
      createInstitutionFixture('institution_3', 'みなと薬局'),
    ]);

    const response = (await GET(
      createRequest('http://localhost/api/prescriber-institutions?q=みなと&limit=2'),
    ))!;

    expect(response.status).toBe(200);
    expect(prescriberInstitutionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'institution_1' }, { id: 'institution_2' }],
      meta: {
        limit: 2,
        has_more: true,
      },
    });
  });

  it.each([
    ['9999', 501],
    ['0', 2],
    ['abc', 501],
  ])('bounds q-filtered limit "%s" to take %i', async (limit, expectedTake) => {
    const response = (await GET(
      createRequest(`http://localhost/api/prescriber-institutions?q=みなと&limit=${limit}`),
    ))!;

    expect(response.status).toBe(200);
    expect(prescriberInstitutionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
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
