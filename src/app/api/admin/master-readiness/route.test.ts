import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, buildSnapshotMock } = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'admin' },
        routeContext: { params: Promise<Record<string, never>> },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, routeContext = emptyRouteContext) =>
        handler(
          req,
          {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'admin',
          },
          routeContext,
        );
    },
  ),
  buildSnapshotMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/admin-master-readiness', () => ({
  buildAdminMasterReadinessSnapshot: buildSnapshotMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/admin/master-readiness');
}

describe('/api/admin/master-readiness GET', () => {
  beforeEach(() => {
    buildSnapshotMock.mockClear();
    buildSnapshotMock.mockResolvedValue({
      generated_at: '2026-04-21T00:00:00.000Z',
      summary: { ready_count: 1, warning_count: 0, missing_count: 0 },
      groups: [],
    });
  });

  it('returns the admin master readiness snapshot', async () => {
    const response = await GET(createRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        summary: { ready_count: 1 },
      },
    });
    expect(buildSnapshotMock).toHaveBeenCalledWith(expect.anything(), 'org_1');
  });

  it('requires admin permission', () => {
    expect(withAuthContextMock).toHaveBeenCalledWith(expect.any(Function), {
      permission: 'canAdmin',
      message: '設定・マスター整備状況の閲覧権限がありません',
    });
  });
});
