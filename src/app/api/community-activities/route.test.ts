import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { communityActivityFindManyMock, communityActivityCreateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    communityActivityFindManyMock: vi.fn(),
    communityActivityCreateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    communityActivity: {
      findMany: communityActivityFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/community-activities', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

describe('/api/community-activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    communityActivityFindManyMock.mockResolvedValue([{ id: 'activity_1' }]);
    communityActivityCreateMock.mockResolvedValue({ id: 'activity_2' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        communityActivity: {
          create: communityActivityCreateMock,
        },
      }),
    );
  });

  it('lists community activities with filters', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/community-activities?activity_type=seminar&follow_up_required=true',
      ),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expect(communityActivityFindManyMock).toHaveBeenCalled();
  });

  it('creates a community activity record', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/community-activities', {
        activity_type: 'seminar',
        title: '地域向け勉強会',
        activity_date: '2026-03-29T09:00:00.000Z',
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(201);
    expect(communityActivityCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        title: '地域向け勉強会',
        created_by: 'user_1',
      }),
    });
  });

  it('rejects non-object POST payloads before activity creation', async () => {
    const response = (await POST(createRequest('http://localhost/api/community-activities', []), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communityActivityCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before activity creation', async () => {
    const response = (await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(communityActivityCreateMock).not.toHaveBeenCalled();
  });
});
