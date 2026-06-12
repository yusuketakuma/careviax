import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, findManyMock, updateManyMock, withOrgContextMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    findManyMock: vi.fn(),
    updateManyMock: vi.fn(),
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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET as rawGET, PATCH as rawPATCH } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const PATCH = (req: NextRequest) => rawPATCH(req, emptyRouteContext);

function createRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/notifications', {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/notifications', {
    method: 'PATCH',
    headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/notifications GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    updateManyMock.mockResolvedValue({ count: 0 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notification: {
          findMany: findManyMock,
          updateMany: updateManyMock,
        },
      }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 403 when a non-admin requests another user notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(
      createRequest('http://localhost/api/notifications?user_id=user_2', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when an admin requests another user notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await GET(
      createRequest('http://localhost/api/notifications?user_id=user_2', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledOnce();
  });

  it('marks only valid unique notification ids as read', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await PATCH(
      createPatchRequest({ ids: ['notice_1', '', 'notice_1', 123, ' notice_2 '] }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['notice_1', 'notice_2'] },
        org_id: 'org_1',
        user_id: 'user_1',
      },
      data: { is_read: true, read_at: expect.any(Date) },
    });
    await expect(response.json()).resolves.toMatchObject({
      message: '2件を既読にしました',
    });
  });

  it('rejects malformed patch bodies before updating notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    for (const body of [{ ids: [123, ''] }, { ids: 'notice_1' }, { all: 'true' }, []]) {
      const response = await PATCH(createPatchRequest(body));
      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
    }

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch bodies before updating notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await PATCH(createMalformedJsonPatchRequest());
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
