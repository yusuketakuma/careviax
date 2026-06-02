import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { communityActivityFindFirstMock, communityActivityUpdateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    communityActivityFindFirstMock: vi.fn(),
    communityActivityUpdateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communityActivity: {
      findFirst: communityActivityFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/community-activities/activity_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/community-activities/activity_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

describe('/api/community-activities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communityActivityFindFirstMock.mockResolvedValue({ id: 'activity_1' });
    communityActivityUpdateMock.mockResolvedValue({ id: 'activity_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communityActivity: {
          update: communityActivityUpdateMock,
        },
      }),
    );
  });

  it('updates a community activity', async () => {
    const response = (await PATCH(
      createRequest({
        title: '更新後タイトル',
      }),
      {
        params: Promise.resolve({ id: 'activity_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(communityActivityUpdateMock).toHaveBeenCalled();
  });

  it('rejects non-object PATCH payloads before activity lookup or update', async () => {
    const response = (await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'activity_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(communityActivityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communityActivityUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before activity lookup or update', async () => {
    const response = (await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'activity_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(communityActivityFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communityActivityUpdateMock).not.toHaveBeenCalled();
  });
});
