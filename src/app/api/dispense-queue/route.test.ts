import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, dispenseTaskFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    dispenseTask: {
      findMany: dispenseTaskFindManyMock,
    },
  },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest() {
  return new NextRequest('http://localhost/api/dispense-queue', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/dispense-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseTaskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        priority: 'urgent',
        due_date: null,
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
    ]);
  });

  it('returns a sorted dispense queue with facility labels', async () => {
    dispenseTaskFindManyMock.mockResolvedValue([
      {
        id: 'task_2',
        priority: 'normal',
        due_date: new Date('2026-03-30T10:00:00.000Z'),
        created_at: new Date('2026-03-29T12:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_2', address: '施設B' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
      {
        id: 'task_1',
        priority: 'urgent',
        due_date: new Date('2026-03-29T08:00:00.000Z'),
        created_at: new Date('2026-03-29T00:00:00.000Z'),
        results: [],
        cycle: {
          case_: {
            patient: {
              residences: [{ building_id: 'facility_1', address: '施設A' }],
            },
          },
          inquiries: [],
          prescription_intakes: [],
        },
      },
    ]);

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'task_1',
          facility_label: 'facility_1',
          is_overdue: true,
        }),
        expect.objectContaining({
          id: 'task_2',
          facility_label: 'facility_2',
        }),
      ],
    });
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: expect.objectContaining({
            case_: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ primary_pharmacist_id: 'user_1' }),
              ]),
            }),
          }),
        }),
      }),
    );
  });
});
