import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  packagingMethodFindManyMock,
  packagingMethodCountMock,
  packagingMethodCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  packagingMethodFindManyMock: vi.fn(),
  packagingMethodCountMock: vi.fn(),
  packagingMethodCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (req: NextRequest, ctx: { orgId: string; userId: string }) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
      }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    packagingMethodMaster: {
      findMany: packagingMethodFindManyMock,
      count: packagingMethodCountMock,
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

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(init?: NextRequestInit) {
  return createGetRequest('', init);
}

function createGetRequest(search = '', init?: NextRequestInit) {
  return new NextRequest(`http://localhost/api/packaging-methods${search}`, init);
}

function createMalformedJsonPostRequest() {
  return createRequest({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/packaging-methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    packagingMethodFindManyMock.mockResolvedValue([
      {
        id: 'method_1',
        name: '一包化',
        description: '1回ごとの分包',
        icon_key: 'package',
        sort_order: 1,
        is_active: true,
      },
    ]);
    packagingMethodCountMock.mockResolvedValue(1);
    packagingMethodCreateMock.mockResolvedValue({
      id: 'method_2',
      name: 'カレンダー',
      description: '曜日別ケース',
      icon_key: 'calendar',
      sort_order: 2,
      is_active: true,
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        packagingMethodMaster: {
          count: packagingMethodCountMock,
          findMany: packagingMethodFindManyMock,
          create: packagingMethodCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists packaging methods', async () => {
    const response = (await GET(createGetRequest('?limit=5')))!;

    expect(response.status).toBe(200);
    expect(packagingMethodFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        icon_key: true,
        sort_order: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
      take: 5,
    });
    expect(packagingMethodCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
    });
    const body = await response.json();
    expect(Object.keys(body)).toEqual([
      'data',
      'total_count',
      'visible_count',
      'hidden_count',
      'truncated',
      'count_basis',
      'filters_applied',
      'limit',
    ]);
    expect(body).toMatchObject({
      data: [{ id: 'method_1', name: '一包化' }],
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'packaging_methods',
      filters_applied: {},
      limit: 5,
    });
  });

  it.each([
    ['', 100],
    ['?limit=200', 200],
    ['?limit=9999', 200],
    ['?limit=0', 1],
    ['?limit=abc', 100],
  ])('bounds packaging method list size for "%s"', async (search, expectedTake) => {
    packagingMethodFindManyMock.mockResolvedValue([]);

    const response = (await GET(createGetRequest(search)))!;

    expect(response.status).toBe(200);
    expect(packagingMethodFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
        },
        take: expectedTake,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
  });

  it('returns counted metadata when the bounded list hides packaging methods', async () => {
    packagingMethodFindManyMock.mockResolvedValue([
      {
        id: 'method_1',
        name: '一包化',
        description: '1回ごとの分包',
        icon_key: 'package',
        sort_order: 1,
        is_active: true,
      },
      {
        id: 'method_2',
        name: '服薬カレンダー',
        description: '曜日別ケース',
        icon_key: 'calendar',
        sort_order: 2,
        is_active: true,
      },
    ]);
    packagingMethodCountMock.mockResolvedValue(5);

    const response = (await GET(createGetRequest('?limit=2')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'method_1' }, { id: 'method_2' }],
      total_count: 5,
      visible_count: 2,
      hidden_count: 3,
      truncated: true,
      count_basis: 'packaging_methods',
      filters_applied: {},
      limit: 2,
    });
  });

  it('creates a packaging method with wrapped data', async () => {
    const response = (await POST(
      createRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'カレンダー',
          description: '曜日別ケース',
          icon_key: 'calendar',
          sort_order: 2,
          is_active: true,
        }),
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(packagingMethodCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        name: 'カレンダー',
        sort_order: 2,
        is_active: true,
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'method_2', name: 'カレンダー' },
    });
  });

  it('rejects non-object create payloads before opening an org transaction', async () => {
    const response = (await POST(
      createRequest({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([]),
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(packagingMethodCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before opening an org transaction', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(packagingMethodCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
