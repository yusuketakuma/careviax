import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  facilityUnitFindManyMock,
  facilityUnitCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  facilityUnitFindManyMock: vi.fn(),
  facilityUnitCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    facilityUnit: {
      findMany: facilityUnitFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body?: unknown) {
  const init: NextRequestInit = {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/admin/facilities/facility_1/units', init);
}

describe('/api/admin/facilities/[id]/units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({ id: 'facility_1' });
    facilityUnitFindManyMock.mockResolvedValue([
      {
        id: 'unit_1',
        name: '2F 東',
        floor: '2F',
        unit_type: 'wing',
        capacity: 24,
        notes: null,
        display_order: 1,
        _count: { residences: 3 },
      },
    ]);
    facilityUnitCreateMock.mockResolvedValue({
      id: 'unit_2',
      name: '3F 西',
      floor: '3F',
      unit_type: 'wing',
      capacity: 18,
      notes: null,
      display_order: 2,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facilityUnit: {
          create: facilityUnitCreateMock,
        },
      }),
    );
  });

  it('lists facility units', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'unit_1', name: '2F 東', patient_count: 3 }],
    });
  });

  it('creates a facility unit', async () => {
    const response = (await POST(
      createRequest({
        name: '3F 西',
        floor: '3F',
        unit_type: 'wing',
        capacity: 18,
        display_order: 2,
      }),
      {
        params: Promise.resolve({ id: 'facility_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(facilityUnitCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        facility_id: 'facility_1',
        name: '3F 西',
        floor: '3F',
        unit_type: 'wing',
      }),
    });
  });
});
