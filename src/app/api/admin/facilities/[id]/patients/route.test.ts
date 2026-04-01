import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  residenceFindManyMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceFindManyMock: vi.fn(),
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
    residence: {
      findMany: residenceFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/admin/facilities/[id]/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_1',
        unit_name: '203号室',
        facility_unit_id: 'unit_203',
        patient: {
          id: 'patient_1',
          name: '山田 花子',
          name_kana: 'ヤマダ ハナコ',
          phone: '090-1111-2222',
          cases: [{ id: 'case_1', status: 'active' }],
        },
      },
    ]);
  });

  it('lists patients linked to the facility via residences', async () => {
    const response = await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(residenceFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
        is_primary: true,
      },
      select: {
        id: true,
        unit_name: true,
        facility_unit_id: true,
        patient: {
          select: {
            id: true,
            name: true,
            name_kana: true,
            phone: true,
            cases: {
              orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
              take: 1,
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          patient_id: 'patient_1',
          patient_name: '山田 花子',
          unit_name: '203号室',
          facility_unit_id: 'unit_203',
          case_status: 'active',
        },
      ],
    });
  });
});
