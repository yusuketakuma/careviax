import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityUnitFindFirstMock,
  facilityUnitUpdateMock,
  facilityUnitDeleteMock,
  residenceFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityUnitFindFirstMock: vi.fn(),
  facilityUnitUpdateMock: vi.fn(),
  facilityUnitDeleteMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (
      req: NextRequest,
      routeContext: { params: Promise<{ id: string; unitId: string }> },
    ) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilityUnit: {
      findFirst: facilityUnitFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PATCH } from './route';

describe('/api/admin/facilities/[id]/units/[unitId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityUnitFindFirstMock.mockResolvedValue({ id: 'unit_1' });
    facilityUnitUpdateMock.mockResolvedValue({
      id: 'unit_1',
      name: '2F 東',
      floor: '2F',
      unit_type: 'wing',
      capacity: 30,
      notes: '更新',
      display_order: 1,
      _count: { residences: 4 },
    });
    residenceFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityUnit: {
          update: facilityUnitUpdateMock,
          delete: facilityUnitDeleteMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
        },
      }),
    );
  });

  it('updates a facility unit', async () => {
    const response = (await PATCH({
      json: async () => ({
        capacity: 30,
        notes: '更新',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(facilityUnitUpdateMock).toHaveBeenCalledWith({
      where: { id: 'unit_1' },
      data: {
        capacity: 30,
        notes: '更新',
      },
      include: {
        _count: {
          select: {
            residences: { where: { is_primary: true } },
          },
        },
      },
    });
  });

  it('blocks deleting a unit that still has residents', async () => {
    residenceFindFirstMock.mockResolvedValue({ id: 'residence_1' });

    const response = (await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'facility_1', unitId: 'unit_1' }),
    }))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者が在籍中のユニットは削除できません',
    });
  });
});
