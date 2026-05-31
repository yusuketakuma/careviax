import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  userFindManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

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
        { id: 'item_1', content: 'test', created_by: 'user_1' },
      ],
    };
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffBoard: {
          findUnique: vi.fn().mockResolvedValue(board),
          create: vi.fn(),
        },
      })
    );
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: 'Taro' }]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.id).toBe('board_1');
    expect(json.data.items[0].created_by_name).toBe('Taro');
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
      })
    );
    userFindManyMock.mockResolvedValue([]);

    const req = createRequest('http://localhost/api/handoff-board?date=2026-04-01');
    const res = await GET(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(200);
    const json = await res!.json();
    expect(json.data.id).toBe('board_new');
  });
});
