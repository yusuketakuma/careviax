import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  membershipFindFirstMock,
  taskFindFirstMock,
  confirmHandoffMock,
  VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataErrorMock,
  VisitHandoffSupervisionTaskUnavailableErrorMock,
  VisitHandoffStaleRecordErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  confirmHandoffMock: vi.fn(),
  VisitHandoffAlreadyConfirmedErrorMock: class VisitHandoffAlreadyConfirmedError extends Error {},
  VisitHandoffInvalidDataErrorMock: class VisitHandoffInvalidDataError extends Error {},
  VisitHandoffMissingDataErrorMock: class VisitHandoffMissingDataError extends Error {},
  VisitHandoffSupervisionTaskUnavailableErrorMock: class VisitHandoffSupervisionTaskUnavailableError extends Error {},
  VisitHandoffStaleRecordErrorMock: class VisitHandoffStaleRecordError extends Error {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    membership: { findFirst: membershipFindFirstMock },
    task: { findFirst: taskFindFirstMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  confirmHandoff: confirmHandoffMock,
  VisitHandoffAlreadyConfirmedError: VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataError: VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataError: VisitHandoffMissingDataErrorMock,
  VisitHandoffSupervisionTaskUnavailableError: VisitHandoffSupervisionTaskUnavailableErrorMock,
  VisitHandoffStaleRecordError: VisitHandoffStaleRecordErrorMock,
}));

import { POST } from './route';
import {
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffSupervisionTaskUnavailableError,
  VisitHandoffStaleRecordError,
} from '@/server/services/visit-handoff';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const authCtx = {
  ctx: {
    orgId: 'org_1',
    userId: 'supervisor_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/visit-records/vr_1/handoff/supervision-confirm', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    confirmed: true,
    task_id: 'task_supervision_1',
    expected_visit_record_version: 2,
    ...overrides,
  };
}

describe('/api/visit-records/[id]/handoff/supervision-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1', version: 2 });
    membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
    taskFindFirstMock.mockResolvedValue({
      id: 'task_supervision_1',
      status: 'pending',
      assigned_to: 'supervisor_1',
      metadata: {
        visit_record_id: 'vr_1',
        visit_record_version: 2,
        trainee_user_id: 'trainee_1',
        supervisor_user_id: 'supervisor_1',
        request_note_present: true,
        request_note_length: 32,
        request_note_redacted: true,
      },
    });
    confirmHandoffMock.mockResolvedValue({
      next_check_items: ['血圧確認'],
      ongoing_monitoring: ['残薬管理'],
      decision_rationale: '確認済み',
      confirmed_by: 'supervisor_1',
      confirmed_at: '2026-04-01T00:00:00.000Z',
    });
  });

  it('confirms a handoff through the assigned supervision task without raw request-note metadata', async () => {
    const res = await POST(
      createRequest({
        ...validBody(),
        edits: { decision_rationale: '上長が確認済み' },
      }),
      { params: Promise.resolve({ id: 'vr_1' }) },
    );

    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'task_supervision_1',
          org_id: 'org_1',
          task_type: 'handoff_supervision_review',
          related_entity_type: 'visit_record',
          related_entity_id: 'vr_1',
        },
        select: expect.not.objectContaining({
          title: true,
          description: true,
        }),
      }),
    );
    expect(confirmHandoffMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      visitRecordId: 'vr_1',
      confirmedBy: 'supervisor_1',
      expectedVersion: 2,
      edits: { decision_rationale: '上長が確認済み' },
      requestContext: authCtx.ctx,
      confirmationBasis: 'supervision_task_assignee',
      supervisionReview: {
        taskId: 'task_supervision_1',
        traineeUserId: 'trainee_1',
        supervisorUserId: 'supervisor_1',
        requestedVisitRecordVersion: 2,
      },
    });
    const bodyText = await res!.text();
    expect(bodyText).not.toContain('request_note');
    expect(bodyText).not.toContain('田中太郎');
    expect(bodyText).not.toContain('token=secret');
  });

  it('rejects invalid route ids before DB lookup', async () => {
    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: ' .. ' }),
    });

    expect(res!.status).toBe(400);
    expectSensitiveNoStore(res!);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('rejects non-supervisor roles before loading the supervision task', async () => {
    membershipFindFirstMock.mockResolvedValue(null);

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('rejects non-assigned or completed supervision tasks before final confirmation', async () => {
    for (const task of [
      { assigned_to: 'other_user', status: 'pending' },
      { assigned_to: 'supervisor_1', status: 'completed' },
    ]) {
      vi.clearAllMocks();
      requireAuthContextMock.mockResolvedValue(authCtx);
      visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1', version: 2 });
      membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
      taskFindFirstMock.mockResolvedValue({
        id: 'task_supervision_1',
        metadata: {
          visit_record_id: 'vr_1',
          visit_record_version: 2,
          trainee_user_id: 'trainee_1',
          supervisor_user_id: 'supervisor_1',
        },
        ...task,
      });

      const res = await POST(createRequest(validBody()), {
        params: Promise.resolve({ id: 'vr_1' }),
      });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    }
  });

  it('rejects metadata mismatches so the task cannot be reused across visits or users', async () => {
    taskFindFirstMock.mockResolvedValue({
      id: 'task_supervision_1',
      status: 'pending',
      assigned_to: 'supervisor_1',
      metadata: {
        visit_record_id: 'other_visit',
        visit_record_version: 2,
        trainee_user_id: 'trainee_1',
        supervisor_user_id: 'supervisor_1',
      },
    });

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('returns stale version conflicts before final confirmation', async () => {
    visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1', version: 3 });

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(409);
    expectSensitiveNoStore(res!);
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('maps typed service errors to sanitized no-store responses', async () => {
    for (const [cause, status] of [
      [new VisitHandoffMissingDataError('vr_1 patient=田中太郎'), 404],
      [new VisitHandoffInvalidDataError('vr_1 token=secret'), 409],
      [new VisitHandoffStaleRecordError('vr_1'), 409],
      [new VisitHandoffAlreadyConfirmedError('vr_1'), 409],
      [new VisitHandoffSupervisionTaskUnavailableError('task_supervision_1'), 409],
    ] as const) {
      vi.clearAllMocks();
      requireAuthContextMock.mockResolvedValue(authCtx);
      visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1', version: 2 });
      membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
      taskFindFirstMock.mockResolvedValue({
        id: 'task_supervision_1',
        status: 'pending',
        assigned_to: 'supervisor_1',
        metadata: {
          visit_record_id: 'vr_1',
          visit_record_version: 2,
          trainee_user_id: 'trainee_1',
          supervisor_user_id: 'supervisor_1',
        },
      });
      confirmHandoffMock.mockRejectedValueOnce(cause);

      const res = await POST(createRequest(validBody()), {
        params: Promise.resolve({ id: 'vr_1' }),
      });

      expect(res!.status).toBe(status);
      expectSensitiveNoStore(res!);
      const bodyText = await res!.text();
      expect(bodyText).not.toContain('田中太郎');
      expect(bodyText).not.toContain('token=secret');
      expect(bodyText).not.toContain('vr_1 patient');
    }
  });

  it('returns a sanitized no-store 500 for unexpected failures', async () => {
    confirmHandoffMock.mockRejectedValueOnce(new Error('raw patient=田中太郎 token=secret'));

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(500);
    expectSensitiveNoStore(res!);
    const bodyText = await res!.text();
    expect(bodyText).not.toContain('田中太郎');
    expect(bodyText).not.toContain('token=secret');
  });
});
