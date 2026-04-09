import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  computeOptimizedVisitRouteMock,
  scheduleFindManyMock,
  proposalFindManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    },
  ),
  withOrgContextMock: vi.fn(),
  computeOptimizedVisitRouteMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
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
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/visit-routes POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFindManyMock.mockResolvedValue([]);
    proposalFindManyMock.mockResolvedValue([]);
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

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
        },
      }),
    );

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
        expect.objectContaining({ scheduleId: 'schedule_1' }),
        expect.objectContaining({ scheduleId: 'schedule_2' }),
      ],
    });
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

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
        },
      }),
    );

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

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
        },
      }),
    );

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
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
        },
      }),
    );

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
        expect.objectContaining({ scheduleId: 'schedule_1' }),
        expect.objectContaining({ scheduleId: 'proposal:proposal_1' }),
      ],
    });
  });
});
