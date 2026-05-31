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

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        }) as AuthenticatedTestRequest,
      );
  },
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

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(init?: NextRequestInit) {
  return new NextRequest('http://localhost/api/packaging-methods', init);
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
});
