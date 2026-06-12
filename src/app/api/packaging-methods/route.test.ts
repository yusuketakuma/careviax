import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  packagingMethodFindManyMock,
  packagingMethodCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  packagingMethodFindManyMock: vi.fn(),
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
  return new NextRequest('http://localhost/api/packaging-methods', init);
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
          create: packagingMethodCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists packaging methods', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'method_1', name: '一包化' }],
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
