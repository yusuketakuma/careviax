import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  prescriptionIntakeGroupByMock,
  prescriptionLineCountMock,
  pharmacistShiftFindManyMock,
  visitRecordCountMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  prescriptionIntakeGroupByMock: vi.fn(),
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
      groupBy: prescriptionIntakeGroupByMock,
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

const emptyRouteContext = { params: Promise.resolve({}) };

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/metrics', { headers });
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
    prescriptionIntakeGroupByMock.mockResolvedValue([
      { prescriber_institution: 'Aクリニック', _count: { id: 6 } },
      { prescriber_institution: 'B医院', _count: { id: 4 } },
    ]);
    prescriptionLineCountMock.mockResolvedValueOnce(20).mockResolvedValueOnce(15);
    pharmacistShiftFindManyMock.mockResolvedValue([
      { pharmacist_id: 'user_1' },
      { pharmacist_id: 'user_2' },
    ]);
    visitRecordCountMock.mockResolvedValue(30);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

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
    expect(prescriptionIntakeGroupByMock).toHaveBeenCalledWith({
      by: ['prescriber_institution'],
      where: {
        org_id: 'org_1',
        prescribed_date: {
          gte: new Date('2026-02-28T15:00:00.000Z'),
          lte: new Date('2026-03-28T09:00:00.000Z'),
        },
      },
      _count: { id: true },
    });
  });

  it('preserves unknown institution grouping for null and blank prescribers', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    prescriptionIntakeGroupByMock.mockResolvedValue([
      { prescriber_institution: null, _count: { id: 2 } },
      { prescriber_institution: '   ', _count: { id: 3 } },
      { prescriber_institution: 'Aクリニック', _count: { id: 5 } },
    ]);
    prescriptionLineCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    visitRecordCountMock.mockResolvedValue(0);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        prescription_concentration_rate: 50,
        generic_dispensing_rate: 0,
        prescriptions_per_pharmacist: 0,
        monthly_prescription_count: 10,
      },
    });
  });
});
