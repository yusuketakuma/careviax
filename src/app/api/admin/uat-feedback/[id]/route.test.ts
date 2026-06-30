import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  feedbackFindFirstMock,
  feedbackUpdateMock,
  userFindFirstMock,
  withAuthContextMock,
  withOrgContextMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'admin' },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
      async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext),
  ),
  feedbackFindFirstMock: vi.fn(),
  feedbackUpdateMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createTx() {
  return {
    uatFeedback: {
      findFirst: feedbackFindFirstMock,
      update: feedbackUpdateMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
    auditLog: {
      create: vi.fn(),
    },
  };
}

function createPatchRequest(body: unknown, feedbackId = 'feedback_1') {
  return new NextRequest(`http://localhost/api/admin/uat-feedback/${feedbackId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPatchRequest(feedbackId = 'feedback_1') {
  return new NextRequest(`http://localhost/api/admin/uat-feedback/${feedbackId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/admin/uat-feedback/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(createTx()));
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    feedbackFindFirstMock.mockResolvedValue({
      id: 'feedback_1',
      priority: 'medium',
      status: 'open',
      owner_user_id: null,
      linked_work_item: null,
      due_date: null,
      resolved_at: null,
    });
    userFindFirstMock.mockResolvedValue({ id: 'user_2' });
    feedbackUpdateMock.mockResolvedValue({
      id: 'feedback_1',
      org_id: 'org_1',
      submitted_by: 'user_1',
      priority: 'high',
      status: 'resolved',
      owner_user_id: 'user_2',
      feedback: '重要な導線修正',
      checklist_progress: '5/8',
      checked_items: ['flow_patient_to_report'],
      source: 'pilot_pharmacy',
      linked_work_item: 'CVX-102',
      due_date: new Date('2026-04-02T00:00:00.000Z'),
      resolved_at: new Date('2026-03-31T12:00:00.000Z'),
      created_at: new Date('2026-03-30T12:00:00.000Z'),
      updated_at: new Date('2026-03-31T12:00:00.000Z'),
    });
  });

  it('updates triage fields and resolves the feedback', async () => {
    const response = await PATCH(
      createPatchRequest({
        status: 'resolved',
        owner_user_id: 'user_2',
        linked_work_item: 'CVX-102',
        due_date: '2026-04-02T00:00:00.000Z',
      }),
      { params: Promise.resolve({ id: '  feedback_1  ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(feedbackFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'feedback_1', org_id: 'org_1' },
      select: {
        id: true,
        priority: true,
        status: true,
        owner_user_id: true,
        linked_work_item: true,
        due_date: true,
        resolved_at: true,
      },
    });
    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'user_2', org_id: 'org_1' },
      select: { id: true },
    });
    expect(feedbackUpdateMock).toHaveBeenCalledWith({
      where: { id: 'feedback_1' },
      data: expect.objectContaining({
        status: 'resolved',
        owner_user_id: 'user_2',
        linked_work_item: 'CVX-102',
        due_date: new Date('2026-04-02T00:00:00.000Z'),
        resolved_at: expect.any(Date),
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uatFeedback: expect.any(Object),
      }),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      expect.objectContaining({
        action: 'uat_feedback_updated',
        targetType: 'UatFeedback',
        targetId: 'feedback_1',
        changes: expect.objectContaining({
          previous: expect.objectContaining({
            priority: 'medium',
            status: 'open',
            owner_user_id: null,
            linked_work_item: null,
            due_date: null,
            resolved_at: null,
          }),
          current: expect.objectContaining({
            priority: 'high',
            status: 'resolved',
            owner_user_id: 'user_2',
            linked_work_item: 'CVX-102',
            due_date: '2026-04-02T00:00:00.000Z',
            resolved_at: '2026-03-31T12:00:00.000Z',
          }),
        }),
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls[0]?.[2])).not.toContain(
      '重要な導線修正',
    );
  });

  it('rejects blank feedback ids before parsing PATCH payloads', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'UAT フィードバックIDが不正です',
    });
    expect(feedbackFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(feedbackUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects non-object PATCH payloads before feedback lookup or update', async () => {
    const response = await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'feedback_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(feedbackFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(feedbackUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PATCH payloads before feedback lookup or update', async () => {
    const response = await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'feedback_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(feedbackFindFirstMock).not.toHaveBeenCalled();
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(feedbackUpdateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects an owner outside the org', async () => {
    userFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      createPatchRequest({
        owner_user_id: 'user_x',
      }),
      { params: Promise.resolve({ id: 'feedback_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(feedbackFindFirstMock).toHaveBeenCalled();
    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'user_x', org_id: 'org_1' },
      select: { id: true },
    });
    expect(feedbackUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns not found without updating or auditing when feedback is outside the org', async () => {
    feedbackFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(createPatchRequest({ status: 'triaged' }), {
      params: Promise.resolve({ id: 'feedback_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(feedbackUpdateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('preserves the original resolved_at when a resolved item is re-saved', async () => {
    const originalResolvedAt = new Date('2026-03-29T12:00:00.000Z');
    feedbackFindFirstMock.mockResolvedValue({
      id: 'feedback_1',
      priority: 'medium',
      status: 'resolved',
      owner_user_id: null,
      linked_work_item: null,
      due_date: null,
      resolved_at: originalResolvedAt,
    });

    const response = await PATCH(
      createPatchRequest({
        status: 'resolved',
        linked_work_item: 'CVX-103',
      }),
      { params: Promise.resolve({ id: 'feedback_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(feedbackUpdateMock).toHaveBeenCalledWith({
      where: { id: 'feedback_1' },
      data: expect.not.objectContaining({
        resolved_at: expect.anything(),
      }),
    });
  });

  it('returns a sensitive no-store internal error without leaking raw update failures', async () => {
    const rawErrorMessage = 'raw uat feedback update failure';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = await PATCH(createPatchRequest({ status: 'triaged' }), {
      params: Promise.resolve({ id: 'feedback_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.text()).resolves.not.toContain(rawErrorMessage);
  });
});
