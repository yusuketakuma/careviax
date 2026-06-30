import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  membershipFindManyMock,
  userFindManyMock,
  withOrgContextMock,
  countHandoffBadgeMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  countHandoffBadgeMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock, findMany: membershipFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/nav-badges', () => ({
  countHandoffBadge: countHandoffBadgeMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function mockBoardTx(board: unknown, monthItemCount = 0) {
  withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({
      handoffBoard: {
        findUnique: vi.fn().mockResolvedValue(board),
        create: vi.fn(),
      },
      handoffItem: {
        count: vi.fn().mockResolvedValue(monthItemCount),
      },
    }),
  );
}

describe('/api/handoff-board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    membershipFindManyMock.mockResolvedValue([]);
    countHandoffBadgeMock.mockResolvedValue(2);
  });

  it('returns 200 with existing board', async () => {
    const findUniqueMock = vi.fn().mockResolvedValue({
      id: 'board_1',
      org_id: 'org_1',
      shift_date: '2026-04-01',
      items: [
        {
          id: 'item_1',
          content: 'test',
          created_by: 'user_1',
          recipient_user_id: 'user_2',
          lifecycle_status: 'proposed',
          consult_status: null,
        },
      ],
    });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffBoard: {
          findUnique: findUniqueMock,
          create: vi.fn(),
        },
        handoffItem: {
          count: vi.fn().mockResolvedValue(5),
        },
      }),
    );
    userFindManyMock.mockResolvedValue([
      { id: 'user_1', name: 'Taro' },
      { id: 'user_2', name: 'Hanako' },
    ]);
    membershipFindManyMock.mockResolvedValue([
      {
        role: 'clerk',
        user: {
          id: 'user_2',
          name: 'Hanako',
          email: 'hanako@example.test',
          phone: '090-0000-0000',
        },
      },
    ]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    expectNoStore(res!);
    const json = await res!.json();
    expect(json.data.id).toBe('board_1');
    expect(json.data.items[0].created_by_name).toBe('Taro');
    expect(json.data.month_item_count).toBe(5);
    expect(json.data.recipient_options).toEqual([
      { id: 'user_2', name: 'Hanako', role: 'clerk', role_label: '事務スタッフ' },
    ]);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      maxWaitMs: 10_000,
      timeoutMs: 20_000,
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(JSON.stringify(json.data.recipient_options)).not.toContain('hanako@example.test');
    expect(JSON.stringify(json.data.recipient_options)).not.toContain('090-0000-0000');
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        is_active: true,
        role: {
          in: ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk', 'driver'],
        },
        user: { is_active: true, id: { not: 'user_1' } },
      },
      orderBy: [{ user: { name_kana: 'asc' } }, { user: { name: 'asc' } }],
      select: {
        role: true,
        user: { select: { id: true, name: true } },
      },
    });
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          items: {
            where: {
              OR: [
                { lifecycle_status: { not: null } },
                { consult_status: { not: null } },
                { recipient_user_id: { not: null } },
              ],
            },
            orderBy: { created_at: 'asc' },
          },
        },
      }),
    );
  });

  it('returns 200 creating a new board when none exists', async () => {
    const newBoard = {
      id: 'board_new',
      org_id: 'org_1',
      shift_date: '2026-04-01',
      items: [],
    };
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffBoard: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(newBoard),
        },
        handoffItem: {
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );
    userFindManyMock.mockResolvedValue([]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.id).toBe('board_new');
    expect(json.data.summary).toEqual({ outgoing_count: 0, incoming_count: 0 });
  });

  it('defaults omitted date to the current Japan business day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z'));

    try {
      const newBoard = {
        id: 'board_today',
        org_id: 'org_1',
        shift_date: new Date('2026-07-01T00:00:00.000Z'),
        items: [],
      };
      const findUniqueMock = vi.fn().mockResolvedValue(null);
      const createMock = vi.fn().mockResolvedValue(newBoard);
      const countMock = vi.fn().mockResolvedValue(0);
      withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
        fn({
          handoffBoard: {
            findUnique: findUniqueMock,
            create: createMock,
          },
          handoffItem: {
            count: countMock,
          },
        }),
      );
      userFindManyMock.mockResolvedValue([]);

      const req = createRequest('http://localhost/api/handoff-board');
      const res = await GET(req, { params: Promise.resolve({}) });
      expect(res!.status).toBe(200);
      expect(findUniqueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_shift_date: {
              org_id: 'org_1',
              shift_date: new Date('2026-07-01T00:00:00.000Z'),
            },
          },
        }),
      );
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            org_id: 'org_1',
            shift_date: new Date('2026-07-01T00:00:00.000Z'),
            created_by: 'user_1',
          },
        }),
      );
      expect(countMock).toHaveBeenCalledWith({
        where: {
          board: {
            org_id: 'org_1',
            shift_date: {
              gte: new Date('2026-07-01T00:00:00.000Z'),
              lt: new Date('2026-08-01T00:00:00.000Z'),
            },
          },
        },
      });
      await expect(res!.json()).resolves.toMatchObject({
        data: { id: 'board_today' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads a concurrently created board after a unique constraint race', async () => {
    const raceWinner = {
      id: 'board_race_winner',
      org_id: 'org_1',
      shift_date: '2026-04-01',
      items: [],
    };
    const findUniqueMock = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(raceWinner);
    const createMock = vi.fn().mockRejectedValueOnce({ code: 'P2002' });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffBoard: {
          findUnique: findUniqueMock,
          create: createMock,
        },
        handoffItem: {
          count: vi.fn().mockResolvedValue(0),
        },
      }),
    );
    userFindManyMock.mockResolvedValue([]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.id).toBe('board_race_winner');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it('returns a lightweight badge count without creating a missing board', async () => {
    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01&badge=1');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(200);
    expectNoStore(res!);
    await expect(res!.json()).resolves.toEqual({ data: { count: 2 } });
    expect(countHandoffBadgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it('splits current items into outgoing/incoming and omits legacy content-only rows', async () => {
    const board = {
      id: 'board_1',
      org_id: 'org_1',
      shift_date: '2026-06-11',
      items: [
        // 自分が渡した(transfer)
        {
          id: 'item_out',
          content: 'セット先行準備(施設GH)',
          created_by: 'user_1',
          recipient_user_id: 'user_2',
          recipient_label: '鈴木さん(事務)',
          lifecycle_status: 'in_progress',
          read_by: [],
        },
        // 自分宛に来た(transfer)
        {
          id: 'item_in',
          content: '疑義照会の判断をお願いします',
          created_by: 'user_2',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: 'proposed',
          read_by: [],
        },
        // 宛先/lifecycle/consult がない旧申し送りは現行ボードには出さない
        {
          id: 'item_legacy',
          content: '冷蔵庫の温度ログ確認お願いします',
          created_by: 'user_2',
          recipient_user_id: null,
          lifecycle_status: null,
          consult_status: null,
          read_by: [],
        },
      ],
    };
    mockBoardTx(board, 31);
    userFindManyMock.mockResolvedValue([
      { id: 'user_1', name: '山田 花子' },
      { id: 'user_2', name: '鈴木 一郎' },
    ]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-06-11');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();

    const directions = Object.fromEntries(
      json.data.items.map((item: { id: string; direction: string }) => [item.id, item.direction]),
    );
    expect(directions).toEqual({
      item_out: 'outgoing',
      item_in: 'incoming',
    });
    expect(json.data.items.some((item: { id: string }) => item.id === 'item_legacy')).toBe(false);
    expect(json.data.summary).toEqual({ outgoing_count: 1, incoming_count: 1 });
    expect(json.data.month_item_count).toBe(31);
    const outgoing = json.data.items.find((item: { id: string }) => item.id === 'item_out');
    expect(outgoing.recipient_name).toBe('鈴木 一郎');
  });

  it('returns 400 on invalid date format', async () => {
    const req = createRequest('http://localhost/api/handoff-board?date=2026-6-1');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expectNoStore(res!);
  });

  it('returns 400 on non-existent calendar dates', async () => {
    const req = createRequest('http://localhost/api/handoff-board?date=2026-02-31');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    expectNoStore(res!);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when board lookup fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(new Error('raw handoff patient content secret'));

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(500);
    expectNoStore(res!);
    const body = await res!.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient content secret');
  });
});
