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
  VisitHandoffSupervisionRequestUnavailableErrorMock,
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
  VisitHandoffSupervisionRequestUnavailableErrorMock: class VisitHandoffSupervisionRequestUnavailableError extends Error {},
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
  VisitHandoffSupervisionRequestUnavailableError:
    VisitHandoffSupervisionRequestUnavailableErrorMock,
  VisitHandoffSupervisionTaskUnavailableError: VisitHandoffSupervisionTaskUnavailableErrorMock,
  VisitHandoffStaleRecordError: VisitHandoffStaleRecordErrorMock,
}));

import { POST } from './route';
import {
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffSupervisionRequestUnavailableError,
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

const handoffResult = {
  next_check_items: ['血圧確認'],
  ongoing_monitoring: ['残薬管理'],
  decision_rationale: '確認済み',
  confirmed_by: 'supervisor_1',
  confirmed_at: '2026-04-01T00:00:00.000Z',
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

function validVisitRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr_1',
    version: 2,
    schedule_id: 'schedule_1',
    schedule: {
      pharmacist_id: 'trainee_1',
      case_: {
        primary_pharmacist_id: 'supervisor_1',
        backup_pharmacist_id: null,
      },
    },
    ...overrides,
  };
}

function validSupervisionTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_supervision_1',
    task_type: 'handoff_supervision_review',
    status: 'pending',
    assigned_to: 'supervisor_1',
    dedupe_key: 'handoff_supervision_vr_1_trainee_1',
    metadata: {
      visit_record_id: 'vr_1',
      visit_record_version: 2,
      schedule_id: 'schedule_1',
      trainee_user_id: 'trainee_1',
      supervisor_user_id: 'supervisor_1',
      request_note_present: true,
      request_note_length: 32,
      request_note_redacted: true,
    },
    ...overrides,
  };
}

describe('/api/visit-records/[id]/handoff/supervision-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    visitRecordFindFirstMock.mockResolvedValue(validVisitRecord());
    membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
    taskFindFirstMock.mockResolvedValue(validSupervisionTask());
    confirmHandoffMock.mockResolvedValue(handoffResult);
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
          task_type: {
            in: ['handoff_supervision_review', 'core.handoff_supervision_review'],
          },
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
      confirmationWhere: {
        schedule_id: 'schedule_1',
        schedule: {
          pharmacist_id: 'trainee_1',
          case_: {
            primary_pharmacist_id: 'supervisor_1',
            backup_pharmacist_id: null,
          },
        },
      },
      confirmationBasis: 'supervision_task_assignee',
      supervisionReview: {
        taskId: 'task_supervision_1',
        taskType: 'handoff_supervision_review',
        traineeUserId: 'trainee_1',
        supervisorUserId: 'supervisor_1',
        requestedVisitRecordVersion: 2,
      },
    });
    const payload = await res!.json();
    expect(payload).toEqual({ data: handoffResult });
    const bodyText = JSON.stringify(payload);
    expect(bodyText).not.toContain('request_note');
    expect(bodyText).not.toContain('田中太郎');
    expect(bodyText).not.toContain('token=secret');
  });

  it('confirms an existing canonical supervision task through the same dedicated flow', async () => {
    taskFindFirstMock.mockResolvedValueOnce(
      validSupervisionTask({ task_type: 'core.handoff_supervision_review' }),
    );

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(200);
    expect(confirmHandoffMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        supervisionReview: expect.objectContaining({
          taskId: 'task_supervision_1',
          taskType: 'core.handoff_supervision_review',
        }),
      }),
    );
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
      visitRecordFindFirstMock.mockResolvedValue(validVisitRecord());
      membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
      taskFindFirstMock.mockResolvedValue(validSupervisionTask(task));

      const res = await POST(createRequest(validBody()), {
        params: Promise.resolve({ id: 'vr_1' }),
      });

      expect(res!.status).toBe(403);
      expectSensitiveNoStore(res!);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    }
  });

  it('rejects metadata mismatches so the task cannot be reused across visits or users', async () => {
    taskFindFirstMock.mockResolvedValue(
      validSupervisionTask({
        metadata: {
          visit_record_id: 'other_visit',
          visit_record_version: 2,
          schedule_id: 'schedule_1',
          trainee_user_id: 'trainee_1',
          supervisor_user_id: 'supervisor_1',
        },
      }),
    );

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('keeps missing supervision-request provenance as a forbidden response', async () => {
    confirmHandoffMock.mockRejectedValueOnce(
      new VisitHandoffSupervisionRequestUnavailableError('vr_1'),
    );

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(confirmHandoffMock).toHaveBeenCalledOnce();
  });

  it('rejects tasks when the trainee is no longer assigned to the current schedule', async () => {
    visitRecordFindFirstMock.mockResolvedValueOnce(
      validVisitRecord({
        schedule: {
          pharmacist_id: 'other_pharmacist',
          case_: {
            primary_pharmacist_id: 'supervisor_1',
            backup_pharmacist_id: null,
          },
        },
      }),
    );

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it('rejects tasks when the caller is no longer the selected current supervisor', async () => {
    visitRecordFindFirstMock.mockResolvedValueOnce(
      validVisitRecord({
        schedule: {
          pharmacist_id: 'trainee_1',
          case_: {
            primary_pharmacist_id: 'other_supervisor',
            backup_pharmacist_id: 'supervisor_1',
          },
        },
      }),
    );

    const res = await POST(createRequest(validBody()), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expect(confirmHandoffMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'schedule metadata',
      { metadata: { ...validSupervisionTask().metadata, schedule_id: 'other' } },
    ],
    ['dedupe key', { dedupe_key: 'forged_dedupe_key' }],
  ])(
    'rejects a task with mismatched %s before service confirmation',
    async (_label, taskOverrides) => {
      taskFindFirstMock.mockResolvedValueOnce(validSupervisionTask(taskOverrides));

      const res = await POST(createRequest(validBody()), {
        params: Promise.resolve({ id: 'vr_1' }),
      });

      expect(res!.status).toBe(403);
      expect(confirmHandoffMock).not.toHaveBeenCalled();
    },
  );

  it('returns stale version conflicts before final confirmation', async () => {
    visitRecordFindFirstMock.mockResolvedValue(validVisitRecord({ version: 3 }));

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
      visitRecordFindFirstMock.mockResolvedValue(validVisitRecord());
      membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1', role: 'pharmacist' });
      taskFindFirstMock.mockResolvedValue(validSupervisionTask());
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
