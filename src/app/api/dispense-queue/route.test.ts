import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  dispenseTaskFindManyMock,
} = vi.hoisted(() => ({
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
    const response = (await GET({
      url: 'http://localhost/api/dispense-queue',
      method: 'GET',
      headers: {
        get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
      },
      nextUrl: new URL('http://localhost/api/dispense-queue'),
    } as NextRequest))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'task_1',
          facility_label: 'facility_1',
        }),
      ],
    });
  });
});
