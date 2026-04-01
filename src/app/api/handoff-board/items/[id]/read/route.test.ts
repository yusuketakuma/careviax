import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  handoffItemFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  handoffItemFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
    handoffItem: { findFirst: handoffItemFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(url: string) {
  return {
    url,
    method: 'PATCH',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

describe('/api/handoff-board/items/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
  });

  it('returns 200 when marking item as read', async () => {
    handoffItemFindFirstMock.mockResolvedValue({
      id: 'item_1',
      read_by: [],
      board: { org_id: 'org_1' },
    });
    const updated = { id: 'item_1', read_by: ['user_1'] };
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: vi.fn().mockResolvedValue(1),
        handoffItem: { findUniqueOrThrow: vi.fn().mockResolvedValue(updated) },
      })
    );

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });
    expect(res!.status).toBe(200);
  });

  it('returns 200 without update when already read', async () => {
    handoffItemFindFirstMock.mockResolvedValue({
      id: 'item_1',
      read_by: ['user_1'],
      board: { org_id: 'org_1' },
    });

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });
    expect(res!.status).toBe(200);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when item not found', async () => {
    handoffItemFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/handoff-board/items/missing/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res!.status).toBe(404);
  });
});
