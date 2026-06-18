import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, visitScheduleFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
  },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(search = '?within_days=7') {
  return new NextRequest(`http://localhost/api/dashboard/medication-deadlines${search}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function getLastDeadlineWindowDays() {
  const call = visitScheduleFindManyMock.mock.calls.at(-1)?.[0];
  const range = call?.where?.medication_end_date;
  if (!range?.gte || !range?.lte) {
    throw new Error('medication_end_date range was not queried');
  }
  return (range.lte.getTime() - range.gte.getTime()) / (24 * 60 * 60 * 1000);
}

describe('/api/dashboard/medication-deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    const today = new Date();
    const inTwoDays = new Date(today);
    inTwoDays.setDate(today.getDate() + 2);
    const inFiveDays = new Date(today);
    inFiveDays.setDate(today.getDate() + 5);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        medication_end_date: inTwoDays,
      },
      {
        id: 'schedule_2',
        medication_end_date: inFiveDays,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits medication deadlines into critical and warning buckets', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 2,
      critical: { count: 1 },
      warning: { count: 1 },
    });
  });

  it('accepts padded within_days values before querying schedules', async () => {
    const response = (await GET(createRequest('?within_days=%207%20')))!;

    expect(response.status).toBe(200);
    expect(getLastDeadlineWindowDays()).toBe(7);
  });

  it('filters medication deadlines for global search by patient name with a bounded limit', async () => {
    const response = (await GET(createRequest('?within_days=14&q=田中&limit=8')))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_: {
            is: {
              patient: {
                is: {
                  name: {
                    contains: '田中',
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
        }),
        take: 8,
      }),
    );
  });

  it('rejects malformed within_days values before querying schedules', async () => {
    const response = (await GET(createRequest('?within_days=20abc')))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        within_days: ['within_days は整数で指定してください'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range within_days values before querying schedules', async () => {
    const lowerResponse = (await GET(createRequest('?within_days=-5')))!;
    expect(lowerResponse.status).toBe(400);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();

    const upperResponse = (await GET(createRequest('?within_days=9999')))!;
    expect(upperResponse.status).toBe(400);
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });
});
