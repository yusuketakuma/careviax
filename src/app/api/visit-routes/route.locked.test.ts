import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  computeOptimizedVisitRouteMock,
  scheduleFindManyMock,
  proposalFindManyMock,
  vehicleResourceFindFirstMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  vehicleResourceFindFirstMock: vi.fn(),
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

vi.mock('@/server/services/visit-route-engine', () => ({
  computeOptimizedVisitRoute: computeOptimizedVisitRouteMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-routes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function mockRouteContext() {
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      visitSchedule: { findMany: scheduleFindManyMock },
      visitScheduleProposal: { findMany: proposalFindManyMock },
      visitVehicleResource: { findFirst: vehicleResourceFindFirstMock },
    }),
  );
}

function siteFor() {
  return { id: 'site_1', name: '本店', lat: 35.0, lng: 139.0 };
}

function scheduleFixtures() {
  return [
    {
      id: 'schedule_1',
      priority: 'normal',
      scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
      site: siteFor(),
      case_: {
        patient: {
          name: '確定 患者',
          residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
        },
      },
    },
    {
      id: 'schedule_2',
      priority: 'emergency',
      scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
      site: siteFor(),
      case_: {
        patient: {
          name: '緊急 患者',
          residences: [{ address: '東京都港区1-1-2', lat: 35.2, lng: 139.2 }],
        },
      },
    },
  ];
}

const okPlan = {
  status: 'ok' as const,
  note: null,
  travelMode: 'DRIVE' as const,
  origin: { lat: 35.0, lng: 139.0, label: '本店' },
  encodedPath: null,
  orderedScheduleIds: ['schedule_1', 'schedule_2'],
  totalDistanceMeters: 5400,
  totalDurationSeconds: 1500,
  stopSummaries: [],
};

describe('/api/visit-routes POST locked_schedule_ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    scheduleFindManyMock.mockResolvedValue([]);
    proposalFindManyMock.mockResolvedValue([]);
    vehicleResourceFindFirstMock.mockResolvedValue(null);
    computeOptimizedVisitRouteMock.mockResolvedValue(okPlan);
  });

  it('passes lockedScheduleIds through to the route engine when provided', async () => {
    scheduleFindManyMock.mockResolvedValue(scheduleFixtures());
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        locked_schedule_ids: ['schedule_1'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({ lockedScheduleIds: ['schedule_1'] }),
    );
  });

  it('omits lockedScheduleIds entirely when none are requested', async () => {
    scheduleFindManyMock.mockResolvedValue(scheduleFixtures());
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const callArg = computeOptimizedVisitRouteMock.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('lockedScheduleIds');
  });

  it('ignores locked ids that are not part of the routable targets', async () => {
    scheduleFindManyMock.mockResolvedValue(scheduleFixtures());
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        locked_schedule_ids: ['schedule_unknown'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const callArg = computeOptimizedVisitRouteMock.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('lockedScheduleIds');
  });
});
