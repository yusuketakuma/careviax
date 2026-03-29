import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { visitScheduleFindManyMock } = vi.hoisted(() => ({
  visitScheduleFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({ ...req, orgId: 'org_1' } as NextRequest & { orgId: string });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/visit-schedules/today', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleFindManyMock.mockResolvedValue([{ id: 'schedule_1' }]);
  });

  it('lists today visit schedules', async () => {
    const response = await GET({
      url: 'http://localhost/api/visit-schedules/today?pharmacist_id=pharm_1',
    } as NextRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'schedule_1' }],
    });
  });
});
