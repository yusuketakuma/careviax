import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { visitScheduleFindManyMock } = vi.hoisted(() => ({
  visitScheduleFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        } as const),
      );
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

const ORIGINAL_TZ = process.env.TZ;

describe('/api/visit-schedules/today', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleFindManyMock.mockResolvedValue([{ id: 'schedule_1' }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists today visit schedules', async () => {
    const response = (await GET(
      new NextRequest('http://localhost/api/visit-schedules/today?pharmacist_id=pharm_1'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'schedule_1' }],
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
          AND: [
            {
              OR: [
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('JST 朝(UTC では前日)でも scheduled_date(@db.Date)をローカル日付の UTC レンジで比較する', async () => {
    vi.useFakeTimers();
    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(new NextRequest('http://localhost/api/visit-schedules/today')))!;

    expect(response.status).toBe(200);
    const where = visitScheduleFindManyMock.mock.calls[0][0].where;
    expect(where.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(where.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });
});
