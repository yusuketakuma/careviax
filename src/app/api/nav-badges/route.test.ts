import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthMock, buildNavBadgePayloadMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        });
    },
  ),
  buildNavBadgePayloadMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthMock,
}));

vi.mock('@/server/services/nav-badges', () => ({
  buildNavBadgePayload: buildNavBadgePayloadMock,
}));

import { GET as rawGET } from './route';

const routeContext = { params: Promise.resolve({}) };

describe('/api/nav-badges GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildNavBadgePayloadMock.mockResolvedValue({ audit: 2, handoff: 3 });
  });

  it('returns the aggregated sidebar badge counts for the authenticated org context', async () => {
    const response = await rawGET(new NextRequest('http://localhost/api/nav-badges'), routeContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { audit: 2, handoff: 3 } });
    expect(buildNavBadgePayloadMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
    });
  });
});
