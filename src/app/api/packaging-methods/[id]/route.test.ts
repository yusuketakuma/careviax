import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  packagingMethodFindFirstMock,
  packagingMethodUpdateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  packagingMethodFindFirstMock: vi.fn(),
  packagingMethodUpdateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    packagingMethodMaster: {
      findFirst: packagingMethodFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createJsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/packaging-methods/method_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/packaging-methods/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    packagingMethodFindFirstMock.mockResolvedValue({ id: 'method_1' });
    packagingMethodUpdateMock.mockResolvedValue({
      id: 'method_1',
      name: '差替え',
      description: null,
      icon_key: 'pill',
      sort_order: 3,
      is_active: false,
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        packagingMethodMaster: {
          update: packagingMethodUpdateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('updates a packaging method', async () => {
    const response = (await PATCH(
      createJsonRequest({
        name: '差替え',
        icon_key: 'pill',
        sort_order: 3,
        is_active: false,
      }),
      {
        params: Promise.resolve({ id: 'method_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(packagingMethodUpdateMock).toHaveBeenCalledWith({
      where: { id: 'method_1' },
      data: {
        name: '差替え',
        icon_key: 'pill',
        sort_order: 3,
        is_active: false,
      },
    });
  });
});
