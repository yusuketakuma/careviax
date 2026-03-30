import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityVisitBatchFindManyMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityVisitBatchFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facility: {
      findFirst: facilityFindFirstMock,
    },
    facilityVisitBatch: {
      findMany: facilityVisitBatchFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/admin/facilities/[id]/visit-batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityVisitBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
        pharmacist_id: 'user_1',
        patient_ids: ['patient_1', 'patient_2'],
        estimated_duration: 60,
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        visit_schedules: [
          {
            id: 'schedule_1',
            route_order: 1,
            case_: {
              patient: {
                id: 'patient_1',
                name: '山田 花子',
              },
            },
          },
        ],
      },
    ]);
  });

  it('returns recent facility visit batches with ordered patients', async () => {
    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(facilityVisitBatchFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
      },
      orderBy: [{ scheduled_date: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: {
        id: true,
        scheduled_date: true,
        pharmacist_id: true,
        patient_ids: true,
        estimated_duration: true,
        created_at: true,
        visit_schedules: {
          orderBy: { route_order: 'asc' },
          select: {
            id: true,
            route_order: true,
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'batch_1',
          patient_count: 2,
          visits: [{ schedule_id: 'schedule_1', patient_name: '山田 花子' }],
        },
      ],
    });
  });
});
