import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  handoffBoardFindFirstMock,
  userFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  handoffBoardFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findFirst: membershipFindFirstMock },
    handoffBoard: { findFirst: handoffBoardFindFirstMock },
    user: { findFirst: userFindFirstMock },
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/handoff-board/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    userFindFirstMock.mockResolvedValue({ id: 'user_2' });
  });

  it('returns 201 on valid transfer creation', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const created = { id: 'item_1', board_id: 'board_1', content: 'Test item' };
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: { create: vi.fn().mockResolvedValue(created) },
        auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit_1' }) },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'Test item',
      priority: 'normal',
      recipient_label: '鈴木さん(事務)',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
      deadline: '2026-06-11T08:00:00.000Z',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);
    expectSensitiveNoStore(res!);
    const json = await res!.json();
    expect(json.data.id).toBe('item_1');
  });

  it('returns a sanitized no-store 500 when handoff item creation fails unexpectedly', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    withOrgContextMock.mockRejectedValueOnce(
      new Error('鈴木 一郎 14時の鈴木様 raw handoff create failure'),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      kind: 'message',
      content: '14時の鈴木様、保冷剤の準備お願いします',
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
    });
    const res = await POST(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const body = await res!.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('鈴木 一郎');
    expect(bodyText).not.toContain('14時の鈴木様');
    expect(bodyText).not.toContain('raw handoff create failure');
  });

  it('returns 404 when board not found', async () => {
    handoffBoardFindFirstMock.mockResolvedValue(null);

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'missing_board',
      content: 'Test item',
      recipient_label: '鈴木さん(事務)',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
      deadline: '2026-06-11T08:00:00.000Z',
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
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
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
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
      scope: '数量セットまで。最終確認は薬剤師',
      rationale: '判断WIP 18/目安12 — 余白では捌けないため',
      deadline: '2026-06-11T08:00:00.000Z',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);
    const json = await res!.json();
    expect(json.data.id).toBe('item_transfer');

    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'user_2', org_id: 'org_1', is_active: true },
      select: { id: true },
    });
    expect(itemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_user_id: 'user_2',
          recipient_label: '鈴木 一郎(事務スタッフ)',
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
          changes: expect.objectContaining({
            recipient_user_id: 'user_2',
            recipient_label: '鈴木 一郎(事務スタッフ)',
          }),
        }),
      }),
    );
  });

  it('rejects a recipient user id outside the current org before transaction side effects', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    userFindFirstMock.mockResolvedValueOnce(null);

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_user_id: 'user_other_org',
      recipient_label: '別組織ユーザー',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
      deadline: '2026-06-11T08:00:00.000Z',
    });
    const res = await POST(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(400);
    await expect(res!.json()).resolves.toMatchObject({
      message: '宛先ユーザーが見つかりません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects an inactive recipient user before transaction side effects', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    userFindFirstMock.mockResolvedValueOnce(null);

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_user_id: 'inactive_user',
      recipient_label: '退職済みユーザー',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
      deadline: '2026-06-11T08:00:00.000Z',
    });
    const res = await POST(req, { params: Promise.resolve({}) });

    expect(res!.status).toBe(400);
    await expect(res!.json()).resolves.toMatchObject({
      message: '宛先ユーザーが見つかりません',
    });
    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'inactive_user', org_id: 'org_1', is_active: true },
      select: { id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects content-only handoff notes instead of creating legacy items', async () => {
    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      content: '引き継ぎメモ',
      priority: 'high',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.details).toMatchObject({
      recipient_label: expect.arrayContaining([expect.stringContaining('責任移転')]),
    });
    expect(handoffBoardFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates a free-form message (kind=message) without the 3-point set', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const created = {
      id: 'item_message',
      board_id: 'board_1',
      content: '14時の鈴木様、保冷剤の準備お願いします',
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
      lifecycle_status: null,
      consult_status: null,
    };
    const itemCreateMock = vi.fn().mockResolvedValue(created);
    const auditCreateMock = vi.fn().mockResolvedValue({ id: 'audit_msg' });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: { create: itemCreateMock },
        auditLog: { create: auditCreateMock },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      kind: 'message',
      content: '14時の鈴木様、保冷剤の準備お願いします',
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);

    // 伝言は3点セット・相談状態・lifecycle を持たない(全 null)。
    expect(itemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_user_id: 'user_2',
          lifecycle_status: null,
          consult_status: null,
          scope: null,
          rationale: null,
          deadline: null,
        }),
      }),
    );
    // 監査既定方針: 伝言も軽量に記録する。
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'handoff_message_created',
          target_type: 'handoff_item',
          target_id: 'item_message',
        }),
      }),
    );
  });

  it('rejects a message (kind=message) without a recipient', async () => {
    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      kind: 'message',
      content: '宛先のない連絡',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.details).toMatchObject({
      recipient_label: expect.arrayContaining([expect.stringContaining('連絡の宛先')]),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates a consult (consult_status=open) and records a handoff_consult_created audit log', async () => {
    handoffBoardFindFirstMock.mockResolvedValue({ id: 'board_1' });
    const created = {
      id: 'item_consult',
      board_id: 'board_1',
      content: '同成分薬の重複疑い。用法妥当か確認お願いします',
      recipient_user_id: 'user_2',
      recipient_label: '山田 太郎(薬剤師)',
      lifecycle_status: null,
      consult_status: 'open',
    };
    const itemCreateMock = vi.fn().mockResolvedValue(created);
    const auditCreateMock = vi.fn().mockResolvedValue({ id: 'audit_consult' });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: { create: itemCreateMock },
        auditLog: { create: auditCreateMock },
      }),
    );

    const req = createRequest('http://localhost/api/handoff-board/items', {
      board_id: 'board_1',
      consult_status: 'open',
      content: '同成分薬の重複疑い。用法妥当か確認お願いします',
      recipient_user_id: 'user_2',
      recipient_label: '山田 太郎(薬剤師)',
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res!.status).toBe(201);

    // 相談は lifecycle を持たず consult_status='open' で作成される。
    expect(itemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consult_status: 'open',
          lifecycle_status: null,
        }),
      }),
    );
    // 起票も監査に残す(対応 handoff_consult_resolved と対称)。
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'handoff_consult_created',
          target_type: 'handoff_item',
          target_id: 'item_consult',
        }),
      }),
    );
  });
});
