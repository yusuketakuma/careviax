import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  handoffItemTxFindFirstMock,
  handoffItemFindUniqueOrThrowMock,
  executeRawMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  handoffItemTxFindFirstMock: vi.fn(),
  handoffItemFindUniqueOrThrowMock: vi.fn(),
  executeRawMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(url: string) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/handoff-board/items/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    executeRawMock.mockResolvedValue(1);
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: executeRawMock,
        handoffItem: {
          findFirst: handoffItemTxFindFirstMock,
          findUniqueOrThrow: handoffItemFindUniqueOrThrowMock,
        },
      }),
    );
  });

  it('returns 200 when marking item as read', async () => {
    handoffItemTxFindFirstMock.mockResolvedValue({
      id: 'item_1',
      read_by: [],
      board: { org_id: 'org_1' },
    });
    const updated = { id: 'item_1', read_by: ['user_1'] };
    handoffItemFindUniqueOrThrowMock.mockResolvedValue(updated);

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });

    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(handoffItemTxFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'item_1' },
      include: {
        board: {
          select: { org_id: true },
        },
      },
    });
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    await expect(res!.json()).resolves.toEqual({ data: updated });
  });

  it('returns 200 without update when already read', async () => {
    const alreadyRead = {
      id: 'item_1',
      read_by: ['user_1'],
      board: { org_id: 'org_1' },
    };
    handoffItemTxFindFirstMock.mockResolvedValue(alreadyRead);

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });

    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(handoffItemFindUniqueOrThrowMock).not.toHaveBeenCalled();
    await expect(res!.json()).resolves.toEqual({ data: alreadyRead });
  });

  it('returns 404 when item not found', async () => {
    handoffItemTxFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/handoff-board/items/missing/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });

    expect(res!.status).toBe(404);
    expectSensitiveNoStore(res!);
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(handoffItemFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });

  it('returns 404 without update when the RLS-scoped row belongs to another org', async () => {
    handoffItemTxFindFirstMock.mockResolvedValue({
      id: 'item_1',
      read_by: [],
      board: { org_id: 'org_2' },
    });

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });

    expect(res!.status).toBe(404);
    expectSensitiveNoStore(res!);
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(handoffItemFindUniqueOrThrowMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when marking read fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('鈴木 一郎 申し送り raw handoff read failure'),
    );

    const req = createRequest('http://localhost/api/handoff-board/items/item_1/read');
    const res = await PATCH(req, { params: Promise.resolve({ id: 'item_1' }) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const body = await res!.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('鈴木 一郎');
    expect(bodyText).not.toContain('申し送り');
    expect(bodyText).not.toContain('raw handoff read failure');
  });
});
