import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, dispenseTaskCountMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskCountMock: vi.fn(),
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
  });

  it('returns dispensing dashboard metrics', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const json = await response.json();
    expect(json).toMatchObject({
      pendingTasks: 3,
      auditPendingTasks: 2,
      completedToday: 5,
    });
    expect(json).not.toHaveProperty('completedLast7Days');
    expect(dispenseTaskCountMock).toHaveBeenCalledTimes(3);
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        status: 'pending',
      },
    });
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        audits: { none: {} },
      },
    });
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(3, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        updated_at: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
      },
    });
  });

  it('returns a sanitized no-store 500 when metric reads fail', async () => {
    const rawError = 'raw dispensing dashboard count failure';
    dispenseTaskCountMock.mockReset();
    dispenseTaskCountMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
  });
});
