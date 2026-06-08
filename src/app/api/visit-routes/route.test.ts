import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  withAuthMock,
  withOrgContextMock,
  computeOptimizedVisitRouteMock,
  scheduleFindManyMock,
  proposalFindManyMock,
  vehicleResourceFindFirstMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      );
  }),
  withOrgContextMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  vehicleResourceFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/visit-route-engine', () => ({
  computeOptimizedVisitRoute: computeOptimizedVisitRouteMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

function mockRouteContext() {
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      visitSchedule: {
        findMany: scheduleFindManyMock,
      },
      visitScheduleProposal: {
        findMany: proposalFindManyMock,
      },
      visitVehicleResource: {
        findFirst: vehicleResourceFindFirstMock,
      },
    }),
  );
}

describe('/api/visit-routes POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFindManyMock.mockResolvedValue([]);
    proposalFindManyMock.mockResolvedValue([]);
    vehicleResourceFindFirstMock.mockResolvedValue(null);
  });

  it('computes an optimized route from selected schedules', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: 'encoded-path',
      orderedScheduleIds: ['schedule_2', 'schedule_1'],
      totalDistanceMeters: 5400,
      totalDurationSeconds: 1500,
      stopSummaries: [],
    });

    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
      {
        id: 'schedule_2',
        priority: 'urgent',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '佐藤 花子',
            residences: [{ address: '東京都港区1-1-2', lat: 35.2, lng: 139.2 }],
          },
        },
      },
    ]);

    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      orderedScheduleIds: ['schedule_2', 'schedule_1'],
    });
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith({
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      travelMode: 'DRIVE',
      waypoints: [
        expect.objectContaining({ scheduleId: 'schedule_1', priority: 'normal' }),
        expect.objectContaining({ scheduleId: 'schedule_2', priority: 'urgent' }),
      ],
    });
  });

  it('rejects non-object route payloads before loading route inputs', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading route inputs', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('returns 404 without route calculation when a selected schedule is outside assignment scope', async () => {
    mockRouteContext();
    scheduleFindManyMock.mockResolvedValue([]);

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(scheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: { in: ['schedule_1'] },
          AND: [expect.objectContaining({ OR: expect.any(Array) })],
        }),
      }),
    );
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('annotates the response when some schedules are missing coordinates', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'unavailable',
      note: 'Google Maps API key が未設定のためルート最適化を計算できません',
      travelMode: 'WALK',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: [],
    });

    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
      {
        id: 'schedule_2',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '座標なし患者',
            residences: [{ address: '東京都港区1-1-9', lat: null, lng: null }],
          },
        },
      },
    ]);

    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        travel_mode: 'WALK',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unavailable',
      note: expect.stringContaining('座標未設定: 座標なし患者'),
    });
  });

  it('passes through the requested travel mode', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'WALK',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 900,
      totalDurationSeconds: 720,
      stopSummaries: [],
    });

    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);

    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        travel_mode: 'WALK',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        travelMode: 'WALK',
      }),
    );
  });

  it('uses persisted vehicle resources for route travel mode and constraints', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'TWO_WHEELER',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 900,
      totalDurationSeconds: 1200,
      stopSummaries: [],
    });
    vehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'TWO_WHEELER',
      max_stops: 4,
      max_route_duration_minutes: 60,
    });
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        vehicle_resource_id: 'vehicle_1',
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(vehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        travel_mode: true,
        max_stops: true,
        max_route_duration_minutes: true,
      },
    });
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        travelMode: 'TWO_WHEELER',
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      vehicle_resource: {
        vehicle_id: 'vehicle_1',
        label: '社用車A',
        max_stops: 4,
        max_route_duration_minutes: 60,
        constraint_status: 'ok',
      },
    });
  });

  it('returns 404 when a persisted vehicle resource is missing or unavailable', async () => {
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);
    vehicleResourceFindFirstMock.mockResolvedValue(null);
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        vehicle_resource_id: 'vehicle_missing',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('rejects persisted vehicle resources from a different site before route calculation', async () => {
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        site: { id: 'site_1', name: '本店', lat: 35.0, lng: 139.0 },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);
    vehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      travel_mode: 'DRIVE',
      max_stops: 4,
      max_route_duration_minutes: null,
    });
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        vehicle_resource_id: 'vehicle_2',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('rejects persisted vehicle resources when route targets span multiple sites', async () => {
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        site: { id: 'site_1', name: '本店', lat: 35.0, lng: 139.0 },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
      {
        id: 'schedule_2',
        priority: 'normal',
        site: { id: 'site_2', name: '支店', lat: 35.4, lng: 139.4 },
        case_: {
          patient: {
            name: '佐藤 花子',
            residences: [{ address: '東京都港区1-1-2', lat: 35.2, lng: 139.2 }],
          },
        },
      },
    ]);
    vehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 4,
      max_route_duration_minutes: null,
    });
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '車両リソースを指定する場合は、同一拠点の訪問予定または候補だけを選択してください',
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('rejects persisted vehicle resources that exceed stop capacity before route calculation', async () => {
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        site: { id: 'site_1', name: '本店', lat: 35.0, lng: 139.0 },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
      {
        id: 'schedule_2',
        priority: 'normal',
        site: { id: 'site_1', name: '本店', lat: 35.0, lng: 139.0 },
        case_: {
          patient: {
            name: '佐藤 花子',
            residences: [{ address: '東京都港区1-1-2', lat: 35.2, lng: 139.2 }],
          },
        },
      },
    ]);
    vehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 1,
      max_route_duration_minutes: null,
    });
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('rejects routes that exceed the selected vehicle stop capacity before loading inputs', async () => {
    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        travel_mode: 'DRIVE',
        vehicle_resource: {
          vehicle_id: 'car_1',
          label: '社用車1',
          max_stops: 1,
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        vehicle_resource: ['この車両リソースで訪問できる件数は最大 1 件です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(proposalFindManyMock).not.toHaveBeenCalled();
    expect(computeOptimizedVisitRouteMock).not.toHaveBeenCalled();
  });

  it('marks routes unavailable when they exceed the selected vehicle duration capacity', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: 9000,
      totalDurationSeconds: 5400,
      stopSummaries: [],
    });

    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);

    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        travel_mode: 'DRIVE',
        vehicle_resource: {
          vehicle_id: 'car_1',
          label: '社用車1',
          max_route_duration_minutes: 60,
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unavailable',
      note: '社用車1 の稼働上限 60分を超えています',
      vehicle_resource: {
        vehicle_id: 'car_1',
        label: '社用車1',
        max_route_duration_minutes: 60,
        stop_count: 1,
        route_duration_minutes: 90,
        constraint_status: 'exceeded',
      },
    });
  });

  it('marks vehicle duration constraints unverified when route duration is unavailable', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'unavailable',
      note: '拠点の座標が未設定のためルート最適化を計算できません',
      travelMode: 'DRIVE',
      origin: null,
      encodedPath: null,
      orderedScheduleIds: ['schedule_1'],
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: [],
    });

    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'normal',
        scheduled_date: new Date('2026-03-28T00:00:00.000Z'),
        site: {
          id: 'site_1',
          name: '本店',
          lat: null,
          lng: null,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);

    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        travel_mode: 'DRIVE',
        vehicle_resource: {
          vehicle_id: 'car_1',
          label: '社用車1',
          max_route_duration_minutes: 60,
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unavailable',
      note: expect.stringContaining('社用車1 の稼働上限は経路時間未計算のため未確認です'),
      vehicle_resource: {
        vehicle_id: 'car_1',
        label: '社用車1',
        max_route_duration_minutes: 60,
        route_duration_minutes: null,
        constraint_status: 'unverified',
      },
    });
  });

  it('computes routes that include open proposals', async () => {
    computeOptimizedVisitRouteMock.mockResolvedValue({
      status: 'ok',
      note: null,
      travelMode: 'DRIVE',
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      encodedPath: 'proposal-path',
      orderedScheduleIds: ['schedule_1', 'proposal:proposal_1'],
      totalDistanceMeters: 1800,
      totalDurationSeconds: 900,
      stopSummaries: [],
    });
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        priority: 'urgent',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '山田 太郎',
            residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      },
    ]);
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        priority: 'emergency',
        site: {
          id: 'site_1',
          name: '本店',
          lat: 35.0,
          lng: 139.0,
        },
        case_: {
          patient: {
            name: '候補患者',
            residences: [{ address: '東京都港区1-1-3', lat: 35.3, lng: 139.3 }],
          },
        },
      },
    ]);
    mockRouteContext();

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1'],
        proposal_ids: ['proposal_1'],
        travel_mode: 'DRIVE',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(computeOptimizedVisitRouteMock).toHaveBeenCalledWith({
      origin: { lat: 35.0, lng: 139.0, label: '本店' },
      travelMode: 'DRIVE',
      waypoints: [
        expect.objectContaining({ scheduleId: 'schedule_1', priority: 'urgent' }),
        expect.objectContaining({ scheduleId: 'proposal:proposal_1', priority: 'emergency' }),
      ],
    });
  });
});
