import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { facilityFindFirstMock, facilityVisitBatchCountMock, facilityVisitBatchFindManyMock } =
  vi.hoisted(() => ({
    facilityFindFirstMock: vi.fn(),
    facilityVisitBatchCountMock: vi.fn(),
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
      count: facilityVisitBatchCountMock,
      findMany: facilityVisitBatchFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/visit-batches');
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/admin/facilities/[id]/visit-batches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityVisitBatchCountMock.mockResolvedValue(1);
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
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(facilityVisitBatchCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
      },
    });
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
      meta: {
        limit: 20,
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        count_basis: 'facility_visit_batches_for_facility',
        filters_applied: { facility_id: 'facility_1' },
      },
    });
  });

  it('returns count metadata when fixed recent history is truncated', async () => {
    facilityVisitBatchCountMock.mockResolvedValueOnce(25);
    facilityVisitBatchFindManyMock.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, index) => ({
        id: `batch_${index + 1}`,
        scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
        pharmacist_id: 'user_1',
        patient_ids: [],
        estimated_duration: 60,
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        visit_schedules: [],
      })),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id: 'batch_1' })]),
      meta: {
        limit: 20,
        total_count: 25,
        visible_count: 20,
        hidden_count: 5,
        count_basis: 'facility_visit_batches_for_facility',
      },
    });
  });

  it('returns a no-store 404 when the facility does not exist', async () => {
    facilityFindFirstMock.mockResolvedValueOnce(null);

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(facilityVisitBatchCountMock).not.toHaveBeenCalled();
    expect(facilityVisitBatchFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when facility visit history fails to load', async () => {
    facilityVisitBatchFindManyMock.mockRejectedValueOnce(
      new Error('raw facility visit batch patient 山田 花子 phone 090-1111-2222'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('090-1111-2222');
    expect(bodyText).not.toContain('raw facility visit batch');
  });
});
