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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
    // 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
    // WHERE は org-only になり、cycle の担当割当 OR 句は付与されない。
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: { in: ['pending', 'in_progress'] },
        },
      }),
    );
  });

  it('returns a sanitized no-store 500 when queue lookup fails unexpectedly', async () => {
    dispenseTaskFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田花子 東京都千代田区1-1-1 raw dispense queue drug inquiry'),
    );

    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区1-1-1');
    expect(JSON.stringify(body)).not.toContain('raw dispense queue drug inquiry');
  });
});
