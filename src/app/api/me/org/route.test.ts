import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { organizationFindUniqueMock } = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/me/org');
}

describe('/api/me/org GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindUniqueMock.mockResolvedValue({ name: 'CareViaX薬局' });
  });

  it('returns the authenticated organization name', async () => {
    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(200);
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'org_1' },
      select: { name: true },
    });
    await expect(response.json()).resolves.toEqual({ data: { name: 'CareViaX薬局' } });
  });

  it('returns an empty name when the authenticated organization is missing', async () => {
    organizationFindUniqueMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { name: '' } });
  });
});
