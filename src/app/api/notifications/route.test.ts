import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  countMock,
  findManyMock,
  updateManyMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  countMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
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

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
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
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    updateManyMock.mockResolvedValue({ count: 0 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notification: {
          count: countMock,
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(findManyMock.mock.calls[0]?.[0].orderBy).toEqual([
      { created_at: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('returns only unread count for header summary requests', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    countMock.mockResolvedValue(6);

    const response = await GET(
      createRequest('http://localhost/api/notifications?summary=1', { 'x-org-id': 'org_1' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({ data: { unreadCount: 6 } });
    expect(countMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: 'user_1',
        is_read: false,
      },
    });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when notification listing fails unexpectedly', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    const unsafeError = new Error('raw patient notification secret');
    unsafeError.name = 'NotificationPatientSecretError';
    findManyMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient notification secret');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'notifications_get_unhandled_error',
        route: '/api/notifications',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('raw patient notification secret');
    expect(loggedContext).not.toContain('NotificationPatientSecretError');
    expect(loggedContext).not.toContain('user_id');
    expect(loggedContext).not.toContain('body');
  });

  it('marks only valid unique notification ids as read', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await PATCH(
      createPatchRequest({ ids: ['notice_1', '', 'notice_1', 123, ' notice_2 '] }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
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
      expectNoStore(response);
    }

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch bodies before updating notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await PATCH(createMalformedJsonPatchRequest());
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('marks all current-user notifications as read with no-store response headers', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await PATCH(createPatchRequest({ all: true }));
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', user_id: 'user_1', is_read: false },
      data: { is_read: true, read_at: expect.any(Date) },
    });
    await expect(response.json()).resolves.toMatchObject({
      message: '全て既読にしました',
    });
  });

  it('returns a sanitized no-store 500 when marking notifications fails unexpectedly', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    const unsafeError = new Error('raw notification patient secret');
    unsafeError.name = 'NotificationPatientSecretError';
    updateManyMock.mockRejectedValueOnce(unsafeError);

    const response = await PATCH(createPatchRequest({ ids: ['notice_1'] }));
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw notification patient secret');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'notifications_patch_unhandled_error',
        route: '/api/notifications',
        method: 'PATCH',
        status: 500,
      },
      unsafeError,
    );
    const loggedContext = JSON.stringify(loggerErrorMock.mock.calls[0]?.[0]);
    expect(loggedContext).not.toContain('raw notification patient secret');
    expect(loggedContext).not.toContain('NotificationPatientSecretError');
    expect(loggedContext).not.toContain('ids');
    expect(loggedContext).not.toContain('notice_1');
  });
});
