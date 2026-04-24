import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { patientFindFirstMock, prescriptionIntakeFindManyMock } = vi.hoisted(() => ({
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
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_2',
        cycle_id: 'cycle_2',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [],
      },
      {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [],
      },
    ]);

    const response = (await GET(
      {
        url: 'http://localhost/api/patients/patient_1/prescriptions?limit=1',
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      patient: expect.objectContaining({ id: 'patient_1' }),
      data: [{ id: 'intake_2', cycle_id: 'cycle_2' }],
      hasMore: true,
      nextCursor: expect.any(String),
    });
  });

  it('uses keyset cursor conditions after the first page', async () => {
    const keysetCursor = Buffer.from(
      JSON.stringify({
        prescribed_date: '2026-04-20T00:00:00.000Z',
        created_at: '2026-04-20T10:00:00.000Z',
        id: 'intake_2',
      }),
      'utf8',
    ).toString('base64url');

    const response = (await GET(
      {
        url: `http://localhost/api/patients/patient_1/prescriptions?limit=20&cursor=${keysetCursor}`,
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { prescribed_date: { lt: new Date('2026-04-20T00:00:00.000Z') } },
            {
              prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
              created_at: { lt: new Date('2026-04-20T10:00:00.000Z') },
            },
            {
              prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
              created_at: new Date('2026-04-20T10:00:00.000Z'),
              id: { lt: 'intake_2' },
            },
          ],
        }),
      }),
    );
  });

  it('ignores legacy numeric cursors instead of offset paging', async () => {
    const response = (await GET(
      {
        url: 'http://localhost/api/patients/patient_1/prescriptions?limit=20&cursor=20',
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs.where).not.toHaveProperty('OR');
  });
});
