import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, userFindManyMock, withOrgContextMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    userFindManyMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
    user: { findMany: userFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
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
  });

  it('returns 200 with existing board', async () => {
    const board = {
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
    };
    mockBoardTx(board, 5);
    userFindManyMock.mockResolvedValue([
      { id: 'user_1', name: 'Taro' },
      { id: 'user_2', name: 'Hanako' },
    ]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.id).toBe('board_1');
    expect(json.data.items[0].created_by_name).toBe('Taro');
    expect(json.data.month_item_count).toBe(5);
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

  it('returns a lightweight badge count without creating a missing board', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      items: [
        { created_by: 'user_1', read_by: ['user_2'], lifecycle_status: 'proposed' },
        { created_by: 'user_2', read_by: [], lifecycle_status: 'proposed' },
        { created_by: 'user_2', read_by: ['user_1'], lifecycle_status: 'proposed' },
        { created_by: 'user_2', read_by: [], lifecycle_status: null, consult_status: null },
      ],
    });
    const create = vi.fn();
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffBoard: {
          findUnique,
          create,
        },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01&badge=1');
    const res = await GET(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(200);
    await expect(res!.json()).resolves.toEqual({ data: { count: 2 } });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          items: {
            select: {
              created_by: true,
              read_by: true,
              lifecycle_status: true,
              consult_status: true,
            },
          },
        },
      }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
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
  });
});
