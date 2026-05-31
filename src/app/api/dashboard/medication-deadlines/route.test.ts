import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindManyMock,
} = vi.hoisted(() => ({
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

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/dashboard/medication-deadlines?within_days=7', {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/dashboard/medication-deadlines', () => {
  beforeEach(() => {
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

  it('splits medication deadlines into critical and warning buckets', async () => {
    const response = (await GET(createRequest()))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 2,
      critical: { count: 1 },
      warning: { count: 1 },
    });
  });
});
