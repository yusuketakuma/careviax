import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  communityActivityFindFirstMock,
  communityActivityUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
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
    const response = (await PATCH({
      json: async () => ({
        title: '更新後タイトル',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'activity_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(communityActivityUpdateMock).toHaveBeenCalled();
  });
});
