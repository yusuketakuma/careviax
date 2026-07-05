import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitScheduleTxFindFirstMock,
  visitScheduleUpdateManyMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleTxFindFirstMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createReopenRequest(
  body: unknown,
  headers: Record<string, string> = { 'x-org-id': 'org_1' },
) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1/reopen', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function expectedReopenClaimWhere() {
  return {
    id: 'schedule_1',
    org_id: 'org_1',
    version: 1,
    schedule_status: 'cancelled',
    OR: [
      { override_request: { is: null } },
      {
        override_request: {
          is: {
            status: { not: 'completed' },
            replacement_schedule_id: null,
          },
        },
      },
    ],
  };
}

describe('/api/visit-schedules/[id]/reopen POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    visitScheduleTxFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      schedule_status: 'planned',
      version: 2,
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleTxFindFirstMock,
          updateMany: visitScheduleUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_1',
      version: 1,
      schedule_status: 'cancelled',
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    });
  });

  it('reopens a cancelled schedule and records the reason in the audit log', async () => {
    const response = await POST(
      createReopenRequest({ reason_code: 'input_error', reason_note: '誤って取消した' }),
      { params: Promise.resolve({ id: 'schedule_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expectedReopenClaimWhere(),
      data: { schedule_status: 'planned', version: { increment: 1 } },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_schedule_reopened',
        target_type: 'VisitSchedule',
        target_id: 'schedule_1',
        changes: expect.objectContaining({
          reason_code: 'input_error',
          reason_label: '入力間違い',
          reason_note: '誤って取消した',
        }),
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_reopen', schedule_id: 'schedule_1' },
    });
  });

  it('rejects reopening a schedule that is not cancelled', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_1',
      version: 1,
      schedule_status: 'scheduled',
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '取消済みの訪問予定のみ再開できます',
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'completed override with replacement schedule',
      override_request: { status: 'completed', replacement_schedule_id: 'schedule_replacement' },
    },
    {
      label: 'completed override without replacement schedule',
      override_request: { status: 'completed', replacement_schedule_id: null },
    },
    {
      label: 'replacement schedule lineage',
      override_request: { status: 'pending', replacement_schedule_id: 'schedule_replacement' },
    },
  ])('rejects reopening a cancelled schedule with $label', async ({ override_request }) => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_1',
      version: 1,
      schedule_status: 'cancelled',
      override_request,
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '確定済みリスケの元訪問予定は再開できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a known reason code', async () => {
    const response = await POST(createReopenRequest({ reason_code: 'whatever' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('denies a trainee before loading or reopening a schedule', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問予定を再開する権限がありません',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when reopen loses a version race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a reschedule override is completed after the precheck', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_1',
      version: 1,
      schedule_status: 'cancelled',
      override_request: { status: 'pending', replacement_schedule_id: null },
      case_: {
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    });
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expectedReopenClaimWhere(),
      data: { schedule_status: 'planned', version: { increment: 1 } },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before body parsing', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw auth schedule reopen patient 山田 花子 token secret'),
    );

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when reopen transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw reopen transaction patient 山田 花子 token secret reason memo'),
    );

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw reopen');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
