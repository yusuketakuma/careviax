import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  pharmacistShiftFindManyMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  pharmacistShiftUpsertMock,
} = vi.hoisted(() => ({
  pharmacistShiftFindManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  pharmacistShiftUpsertMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string; role: string }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/pharmacist-shifts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacistShiftFindManyMock.mockResolvedValue([]);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistShiftUpsertMock.mockResolvedValue({ id: 'shift_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShift: {
          upsert: pharmacistShiftUpsertMock,
        },
      }),
    );
  });

  it('filters shifts by month range and related ids', async () => {
    const response = (await GET({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      url: 'http://localhost/api/pharmacist-shifts?month=2026-04-01&user_id=user_2&site_id=site_1',
    } as unknown as NextRequest & { orgId: string; userId: string; role: string }))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: {
          gte: new Date(2026, 3, 1),
          lte: new Date(2026, 4, 0),
        },
        user_id: 'user_2',
        site_id: 'site_1',
      },
      orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
        site: { select: { id: true, name: true } },
      },
    });
  });

  it('upserts shifts and updates site_id on existing rows', async () => {
    const response = (await POST({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      json: async () => ({
        site_id: 'site_2',
        user_id: 'user_2',
        date: '2026-04-15',
        available: false,
        available_from: '09:00:00',
        available_to: '12:00:00',
        note: '午前のみ',
      }),
    } as unknown as NextRequest & { orgId: string; userId: string; role: string }))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: 'site_2',
      pharmacist_id: 'user_2',
    });
    expect(pharmacistShiftUpsertMock).toHaveBeenCalledWith({
      where: {
        user_id_date: {
          user_id: 'user_2',
          date: new Date('2026-04-15'),
        },
      },
      create: {
        org_id: 'org_1',
        site_id: 'site_2',
        user_id: 'user_2',
        date: new Date('2026-04-15'),
        available: false,
        available_from: new Date('1970-01-01T09:00:00'),
        available_to: new Date('1970-01-01T12:00:00'),
        note: '午前のみ',
      },
      update: {
        site_id: 'site_2',
        available_from: new Date('1970-01-01T09:00:00'),
        available_to: new Date('1970-01-01T12:00:00'),
        available: false,
        note: '午前のみ',
      },
    });
  });
});
