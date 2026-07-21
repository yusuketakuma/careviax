import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  scheduleFindManyMock,
  proposalFindManyMock,
  vehicleResourceFindFirstMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  vehicleResourceFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/db/client', () => ({
  prisma: { membership: { findFirst: membershipFindFirstMock } },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/server/services/visit-route-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/visit-route-engine')>();
  return { ...actual, computeOptimizedVisitRoute: vi.fn() };
});

import { POST as rawPOST } from './route';
import {
  createDeferred,
  createVisitRouteRequest,
  installVisitRouteContextMock,
} from './route.test-helpers';

const POST = (req: NextRequest) => rawPOST(req, { params: Promise.resolve({}) });

describe('/api/visit-routes POST transaction serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    vehicleResourceFindFirstMock.mockResolvedValue(null);
    installVisitRouteContextMock({
      withOrgContext: withOrgContextMock,
      scheduleFindMany: scheduleFindManyMock,
      proposalFindMany: proposalFindManyMock,
      vehicleResourceFindFirst: vehicleResourceFindFirstMock,
    });
  });

  it('does not start the next lookup before the current lookup resolves', async () => {
    const schedules = createDeferred<unknown[]>();
    const proposals = createDeferred<unknown[]>();
    scheduleFindManyMock.mockReturnValue(schedules.promise);
    proposalFindManyMock.mockReturnValue(proposals.promise);

    const responsePromise = POST(
      createVisitRouteRequest({
        schedule_ids: ['schedule_missing'],
        proposal_ids: ['proposal_missing'],
        vehicle_resource_id: 'vehicle_missing',
      }),
    );

    await vi.waitFor(() => expect(scheduleFindManyMock).toHaveBeenCalledTimes(1));
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(vehicleResourceFindFirstMock).not.toHaveBeenCalled();

    schedules.resolve([]);
    await vi.waitFor(() => expect(proposalFindManyMock).toHaveBeenCalledTimes(1));
    expect(vehicleResourceFindFirstMock).not.toHaveBeenCalled();

    proposals.resolve([]);
    await vi.waitFor(() => expect(vehicleResourceFindFirstMock).toHaveBeenCalledTimes(1));
    await expect(responsePromise).resolves.toMatchObject({ status: 404 });
  });
});
