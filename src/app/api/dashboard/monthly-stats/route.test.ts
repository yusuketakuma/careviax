import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, patientFindManyMock, visitRecordGroupByMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    patientFindManyMock: vi.fn(),
    visitRecordGroupByMock: vi.fn(),
  }));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    visitRecord: {
      groupBy: visitRecordGroupByMock,
    },
  },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, {
    headers,
  });
}

describe('/api/dashboard/monthly-stats GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns validation error for invalid month format', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026/03', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('rejects out-of-range month values', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-13', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('returns grouped monthly patient stats', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });
    visitRecordGroupByMock.mockResolvedValue([
      {
        patient_id: 'patient_1',
        _count: { _all: 2 },
      },
      {
        patient_id: 'patient_2',
        _count: { _all: 3 },
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        medical_insurance_number: 'M001',
        care_insurance_number: null,
      },
      {
        id: 'patient_2',
        name: '佐藤 花子',
        medical_insurance_number: null,
        care_insurance_number: 'C002',
      },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/dashboard/monthly-stats?month=2026-03', {
        'x-org-id': 'org_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const expectedMonthStart = new Date(2026, 2, 1);
    const expectedMonthEnd = new Date(2026, 2, 31, 23, 59, 59, 999);
    expect(visitRecordGroupByMock).toHaveBeenCalledWith({
      by: ['patient_id'],
      where: {
        org_id: 'org_1',
        visit_date: {
          gte: expectedMonthStart,
          lte: expectedMonthEnd,
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'delivery_only', 'revisit_needed'],
        },
      },
      _count: {
        _all: true,
      },
    });
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['patient_1', 'patient_2'] },
      },
      select: {
        id: true,
        name: true,
        medical_insurance_number: true,
        care_insurance_number: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      month: '2026-03',
      summary: {
        total_patients: 2,
        over_limit_count: 1,
        under_limit_count: 1,
      },
      patient_stats: [
        expect.objectContaining({
          patient_id: 'patient_2',
          insurance_basis: 'care',
          visit_count: 3,
          monthly_limit: 2,
          status: 'over_limit',
        }),
        expect.objectContaining({
          patient_id: 'patient_1',
          insurance_basis: 'medical',
          visit_count: 2,
          monthly_limit: 4,
          status: 'under_limit',
        }),
      ],
    });
  });
});
