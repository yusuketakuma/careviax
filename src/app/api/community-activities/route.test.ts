import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communityActivityFindManyMock,
  communityActivityCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
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
    const response = (await GET({
      url: 'http://localhost/api/community-activities?activity_type=seminar&follow_up_required=true',
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    expect(communityActivityFindManyMock).toHaveBeenCalled();
  });

  it('creates a community activity record', async () => {
    const response = (await POST({
      json: async () => ({
        activity_type: 'seminar',
        title: '地域向け勉強会',
        activity_date: '2026-03-29T09:00:00.000Z',
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(communityActivityCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        title: '地域向け勉強会',
        created_by: 'user_1',
      }),
    });
  });
});
