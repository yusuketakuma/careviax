import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { facilityFindFirstMock, residenceFindManyMock } = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
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

describe('/api/facilities/[id]/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      name: 'あおば苑',
    });
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_1',
        address: '東京都千代田区1-1-1',
        unit_name: '203',
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          phone: '03-1111-2222',
          cases: [
            {
              id: 'case_1',
              status: 'active',
            },
          ],
        },
      },
    ]);
  });

  it('returns patients assigned to the facility', async () => {
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
      orderBy: [{ unit_name: 'asc' }, { created_at: 'asc' }],
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        facility_id: 'facility_1',
        facility_name: 'あおば苑',
        patients: [
          expect.objectContaining({
            patient_id: 'patient_1',
            patient_name: '山田 太郎',
            case_status: 'active',
          }),
        ],
      },
    });
  });
});
