import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, handoffBoardFindFirstMock, withOrgContextMock } =
  vi.hoisted(() => ({
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

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{bad json',
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
      fn({ handoffItem: { create: vi.fn().mockResolvedValue(created) } }),
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

  it('rejects non-object create payloads before loading the board', async () => {
    const req = createRequest('http://localhost/api/handoff-board/items', []);
    const res = await POST(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(400);
    expect(handoffBoardFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before loading the board', async () => {
    const req = createMalformedJsonRequest('http://localhost/api/handoff-board/items');
    const res = await POST(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(400);
    await expect(res!.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(handoffBoardFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects a transfer (recipient set) when the 3-point set is incomplete', async () => {
    // ハンドオフの3点セット: ①何を ②なぜ ③いつまで が揃わないと送信できない
    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_label: '鈴木さん(事務)',
      scope: '数量セットまで',
      // rationale / deadline 欠落
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.details).toMatchObject({
      rationale: expect.arrayContaining([expect.stringContaining('②なぜ(根拠)')]),
      deadline: expect.arrayContaining([expect.stringContaining('③いつまで(期限)')]),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates a transfer with the full 3-point set and records an audit log', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const created = {
      id: 'item_transfer',
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_user_id: null,
      recipient_label: '鈴木さん(事務)',
      lifecycle_status: 'proposed',
      scope: '数量セットまで。最終確認は薬剤師',
      rationale: '判断WIP 18/目安12 — 余白では捌けないため',
      deadline: new Date('2026-06-11T08:00:00.000Z'),
    };
    const itemCreateMock = vi.fn().mockResolvedValue(created);
    const auditCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: { create: itemCreateMock },
        auditLog: { create: auditCreateMock },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_label: '鈴木さん(事務)',
      scope: '数量セットまで。最終確認は薬剤師',
      rationale: '判断WIP 18/目安12 — 余白では捌けないため',
      deadline: '2026-06-11T08:00:00.000Z',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);
    const json = await res!.json();
    expect(json.data.id).toBe('item_transfer');

    expect(itemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_label: '鈴木さん(事務)',
          lifecycle_status: 'proposed',
          scope: '数量セットまで。最終確認は薬剤師',
          rationale: '判断WIP 18/目安12 — 余白では捌けないため',
          deadline: new Date('2026-06-11T08:00:00.000Z'),
        }),
      }),
    );
    // 責任の移転は監査ログに必ず記録される
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'handoff_transfer_created',
          target_type: 'handoff_item',
          target_id: 'item_transfer',
        }),
      }),
    );
  });

  it('keeps accepting legacy notes (content + priority only) without audit logging', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const itemCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'item_legacy', board_id: 'board_1', content: '引き継ぎメモ' });
    const auditCreateMock = vi.fn();
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: { create: itemCreateMock },
        auditLog: { create: auditCreateMock },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: '引き継ぎメモ',
      priority: 'high',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);
    expect(auditCreateMock).not.toHaveBeenCalled();
  });
});
