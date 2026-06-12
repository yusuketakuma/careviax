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

function createReopenRequest(body: unknown, headers: Record<string, string> = { 'x-org-id': 'org_1' }) {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1/reopen', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
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
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1', org_id: 'org_1', version: 1 },
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
    await expect(response.json()).resolves.toMatchObject({
      message: '取消済みの訪問予定のみ再開できます',
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('requires a known reason code', async () => {
    const response = await POST(createReopenRequest({ reason_code: 'whatever' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 403 when a trainee reopens a schedule they are not assigned to', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      pharmacist_id: 'user_other',
      version: 1,
      schedule_status: 'cancelled',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns conflict when reopen loses a version race', async () => {
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(createReopenRequest({ reason_code: 'other' }), {
      params: Promise.resolve({ id: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
