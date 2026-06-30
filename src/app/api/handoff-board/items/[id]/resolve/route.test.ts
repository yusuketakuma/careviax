import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  handoffItemFindFirstMock,
  handoffItemUpdateManyMock,
  handoffItemTxFindFirstMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  handoffItemFindFirstMock: vi.fn(),
  handoffItemUpdateManyMock: vi.fn(),
  handoffItemTxFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/handoff-board/items/item_1/resolve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/handoff-board/items/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    handoffItemFindFirstMock.mockResolvedValue({
      id: 'item_1',
      consult_status: 'open',
      board: { org_id: 'org_1' },
    });
    handoffItemUpdateManyMock.mockResolvedValue({ count: 1 });
    handoffItemTxFindFirstMock.mockResolvedValue({
      id: 'item_1',
      consult_status: 'checking',
      resolution_action: 'acknowledged',
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId: string, fn: (tx: unknown) => unknown) =>
      fn({
        handoffItem: {
          updateMany: handoffItemUpdateManyMock,
          findFirst: handoffItemTxFindFirstMock,
        },
        auditLog: { create: auditLogCreateMock },
      }),
    );
  });

  it('claims the unresolved consult before recording the pharmacist response', async () => {
    const response = await POST(
      createRequest({
        resolution_action: 'acknowledged',
      }),
      { params: Promise.resolve({ id: 'item_1' }) },
    );

    expect(response!.status).toBe(200);
    expectSensitiveNoStore(response!);
    expect(handoffItemUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'item_1',
        consult_status: 'open',
        resolution_action: null,
        resolved_at: null,
      },
      data: expect.objectContaining({
        consult_status: 'checking',
        resolution_action: 'acknowledged',
        resolved_by: 'user_1',
        resolved_at: expect.any(Date),
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'handoff_consult_resolved',
          target_type: 'handoff_item',
          target_id: 'item_1',
        }),
      }),
    );
  });

  it('returns a sanitized no-store 500 when consult resolution fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('鈴木 一郎 処方元へ確認 raw consult resolve failure'),
    );

    const response = await POST(
      createRequest({
        resolution_action: 'returned_to_clerk',
        resolution_note: '処方元へ確認してから再提出してください',
      }),
      { params: Promise.resolve({ id: 'item_1' }) },
    );

    expect(response!.status).toBe(500);
    expectSensitiveNoStore(response!);
    const body = await response!.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('鈴木 一郎');
    expect(bodyText).not.toContain('処方元へ確認');
    expect(bodyText).not.toContain('raw consult resolve failure');
    expect(handoffItemUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without audit when another user resolved the consult first', async () => {
    handoffItemUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({
        resolution_action: 'returned_to_clerk',
        resolution_note: '処方元へ確認してから再提出してください',
      }),
      { params: Promise.resolve({ id: 'item_1' }) },
    );

    expect(response!.status).toBe(409);
    await expect(response!.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'この相談は他のユーザーによって更新されています。再読み込みしてください',
    });
    expect(handoffItemTxFindFirstMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-consult handoff items before transaction side effects', async () => {
    handoffItemFindFirstMock.mockResolvedValueOnce({
      id: 'item_1',
      consult_status: null,
      board: { org_id: 'org_1' },
    });

    const response = await POST(
      createRequest({
        resolution_action: 'acknowledged',
      }),
      { params: Promise.resolve({ id: 'item_1' }) },
    );

    expect(response!.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(handoffItemUpdateManyMock).not.toHaveBeenCalled();
  });

  it('forbids clerks from recording a pharmacist consult response (canAuthorReport gate)', async () => {
    // 相談の対応は薬剤師の臨床判断。事務(clerk, canAuthorReport=false)は 403。
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await POST(
      createRequest({
        resolution_action: 'acknowledged',
      }),
      { params: Promise.resolve({ id: 'item_1' }) },
    );

    expect(response!.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(handoffItemUpdateManyMock).not.toHaveBeenCalled();
  });
});
