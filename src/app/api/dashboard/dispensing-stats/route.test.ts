import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, dispenseTaskCountMock, dispenseTaskFindManyMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    dispenseTaskCountMock: vi.fn(),
    dispenseTaskFindManyMock: vi.fn(),
  }));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    dispenseTask: {
      count: dispenseTaskCountMock,
      findMany: dispenseTaskFindManyMock,
    },
  },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/dispensing-stats', {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/dashboard/dispensing-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    dispenseTaskCountMock
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    dispenseTaskFindManyMock.mockResolvedValue([
      { updated_at: new Date() },
      { updated_at: new Date() },
    ]);
  });

  it('returns dispensing dashboard metrics', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pendingTasks: 3,
      auditPendingTasks: 2,
      completedToday: 5,
    });
  });
});
