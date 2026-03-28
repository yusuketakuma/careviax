import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  prescriptionIntakeFindManyMock,
  prescriptionLineCountMock,
  pharmacistShiftFindManyMock,
  visitRecordCountMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  prescriptionLineCountMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  visitRecordCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    prescriptionLine: {
      count: prescriptionLineCountMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    visitRecord: {
      count: visitRecordCountMock,
    },
  },
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/admin/metrics GET', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T09:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns computed metrics for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    prescriptionIntakeFindManyMock.mockResolvedValue([
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'Aクリニック' },
      { prescriber_institution: 'B医院' },
      { prescriber_institution: 'B医院' },
      { prescriber_institution: 'B医院' },
      { prescriber_institution: 'B医院' },
    ]);
    prescriptionLineCountMock
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(15);
    pharmacistShiftFindManyMock.mockResolvedValue([
      { pharmacist_id: 'user_1' },
      { pharmacist_id: 'user_2' },
    ]);
    visitRecordCountMock.mockResolvedValue(30);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        prescription_concentration_rate: 60,
        generic_dispensing_rate: 75,
        prescriptions_per_pharmacist: 0.3,
        home_visit_count_ytd: 30,
        monthly_prescription_count: 10,
        reference_month: '2026-03',
        active_pharmacist_count: 2,
        business_days_elapsed: 20,
      },
    });
  });
});
