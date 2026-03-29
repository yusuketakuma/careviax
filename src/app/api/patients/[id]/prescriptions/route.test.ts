import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  prescriptionIntakeFindManyMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/patients/[id]/prescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    prescriptionIntakeFindManyMock.mockResolvedValue([
      { id: 'intake_1', cycle_id: 'cycle_1', lines: [] },
    ]);
  });

  it('returns patient prescriptions with pagination metadata', async () => {
    const response = (await GET({
      url: 'http://localhost/api/patients/patient_1/prescriptions?limit=20',
    } as NextRequest, {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      patient: expect.objectContaining({ id: 'patient_1' }),
      data: [{ id: 'intake_1', cycle_id: 'cycle_1' }],
      hasMore: false,
    });
  });
});
