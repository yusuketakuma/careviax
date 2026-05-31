import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  handoffBoardFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  handoffBoardFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
    handoffBoard: { findFirst: handoffBoardFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/handoff-board/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
  });

  it('returns 201 on valid item creation', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const created = { id: 'item_1', board_id: 'board_1', content: 'Test item' };
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({ handoffItem: { create: vi.fn().mockResolvedValue(created) } })
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'Test item',
      priority: 'normal',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);
    const json = await res!.json();
    expect(json.data.id).toBe('item_1');
  });

  it('returns 404 when board not found', async () => {
    handoffBoardFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'missing_board',
      content: 'Test item',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(404);
  });

  it('returns 400 on invalid body', async () => {
    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: '',
      content: '',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
  });
});
