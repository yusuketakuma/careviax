import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { patientFindFirstMock, careCaseFindManyMock, prescriptionIntakeFindManyMock } = vi.hoisted(
  () => ({
    patientFindFirstMock: vi.fn(),
    careCaseFindManyMock: vi.fn(),
    prescriptionIntakeFindManyMock: vi.fn(),
  }),
);

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
    careCase: {
      findMany: careCaseFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
  },
}));

import { GET } from './route';

function createGetRequest(patientId: string, query = '') {
  return new NextRequest(
    `http://localhost/api/patients/${patientId}/prescriptions${query ? `?${query}` : ''}`,
  );
}

describe('/api/patients/[id]/prescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
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

    const response = (await GET(createGetRequest('patient_1', 'limit=1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: { patient_id: 'patient_1', case_id: { in: ['case_1'] } },
        }),
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

  it('rejects blank patient ids before loading prescriptions', async () => {
    const response = (await GET(createGetRequest('%20%20', 'limit=1'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
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

    const response = (await GET(createGetRequest('patient_1', `limit=20&cursor=${keysetCursor}`), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

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
    const response = (await GET(createGetRequest('patient_1', 'limit=20&cursor=20'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs.where).not.toHaveProperty('OR');
  });
});
