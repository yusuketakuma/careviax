import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  membershipFindManyMock,
  taskFindFirstMock,
  taskFindUniqueMock,
  taskUpdateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createPatchRequest(taskId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest(taskId: string) {
  return new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    membershipFindManyMock.mockReset();
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist', can_audit_dispense: true },
    ]);
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'patient_self_report_followup',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
    });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindUniqueMock.mockResolvedValue({
      id: 'task_1',
      status: 'completed',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          updateMany: taskUpdateManyMock,
          findUnique: taskFindUniqueMock,
        },
      }),
    );
  });

  it.each(['handoff_supervision_review', 'core.handoff_supervision_review'])(
    'rejects generic non-null assignment for protected supervision tasks (%s)',
    async (taskType) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
      });
      taskFindFirstMock.mockResolvedValueOnce({
        id: 'task_supervision_1',
        task_type: taskType,
        assigned_to: null,
        completed_at: null,
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      });

      const response = (await PATCH(
        createPatchRequest('task_supervision_1', { assigned_to: 'owner_1' }),
        { params: Promise.resolve({ id: 'task_supervision_1' }) },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: 'このタスクの担当者は専用フローで設定してください',
        details: { assigned_to: ['専用の上長確認依頼から担当者を設定してください'] },
      });
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it('allows an authorized owner to clear a protected supervision assignment for remediation', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_supervision_1',
      task_type: 'handoff_supervision_review',
      assigned_to: 'supervisor_1',
      completed_at: null,
      related_entity_type: 'visit_record',
      related_entity_id: 'visit_record_1',
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
    ]);

    const response = (await PATCH(createPatchRequest('task_supervision_1', { assigned_to: null }), {
      params: Promise.resolve({ id: 'task_supervision_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigned_to: null }) }),
    );
  });

  it('does not let a scoped user reassign a PHI-backed task to another user', async () => {
    const response = (await PATCH(
      createPatchRequest('task_1', {
        assigned_to: 'user_2',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '担当者の変更権限がありません',
    });
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it.each(['', '   '])(
    'rejects a blank assigned_to value before scope resolution or writes (%j)',
    async (assignedTo) => {
      const response = (await PATCH(createPatchRequest('task_1', { assigned_to: assignedTo }), {
        params: Promise.resolve({ id: 'task_1' }),
      }))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
        details: { assigned_to: ['assigned_to は空にできません'] },
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(taskFindFirstMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects inactive, cross-org, or unknown assignees before an unrestricted reassignment', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_1',
      task_type: 'staff_work_request_audit',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: null,
      related_entity_id: null,
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
    ]);

    const response = (await PATCH(createPatchRequest('task_1', { assigned_to: 'unknown_user' }), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '依頼先スタッフが見つかりません',
      details: {
        reason: 'task_assignee_ineligible',
        assigned_to: ['有効なスタッフを選択してください'],
      },
    });
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: { in: ['owner_1', 'unknown_user'] },
        is_active: true,
        user: { is_active: true, account_status: 'active' },
      },
      select: { user_id: true, role: true, can_audit_dispense: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects audit reassignment to a trainee before opening the update transaction', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_1',
      task_type: 'staff_work_request_audit',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: null,
      related_entity_id: null,
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
      { user_id: 'trainee_1', role: 'pharmacist_trainee', can_audit_dispense: false },
    ]);

    const response = (await PATCH(createPatchRequest('task_1', { assigned_to: 'trainee_1' }), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '依頼先スタッフはこのタスク種別を担当できません',
      details: {
        reason: 'task_assignee_ineligible',
        assigned_to: ['このタスク種別を担当できるスタッフを選択してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects audit reassignment when a pharmacist lacks the membership audit capability', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_1',
      task_type: 'staff_work_request_audit',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: null,
      related_entity_id: null,
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
      { user_id: 'pharmacist_2', role: 'pharmacist', can_audit_dispense: false },
    ]);

    const response = (await PATCH(createPatchRequest('task_1', { assigned_to: 'pharmacist_2' }), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '依頼先スタッフはこのタスク種別を担当できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('fails closed when actor or assignee roles are mixed across active memberships', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'staff_work_request_general',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: null,
      related_entity_id: null,
    });
    membershipFindManyMock
      .mockResolvedValueOnce([
        { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
        { user_id: 'owner_1', role: 'pharmacist', can_audit_dispense: true },
        { user_id: 'pharmacist_2', role: 'pharmacist', can_audit_dispense: true },
      ])
      .mockResolvedValueOnce([
        { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
        { user_id: 'pharmacist_2', role: 'pharmacist', can_audit_dispense: true },
        { user_id: 'pharmacist_2', role: 'external_viewer', can_audit_dispense: false },
      ]);

    for (const [assignee, expected] of [
      [
        'pharmacist_2',
        {
          status: 403,
          code: 'AUTH_FORBIDDEN',
          message: 'このタスク種別を更新する権限がありません',
        },
      ],
      [
        'pharmacist_2',
        {
          status: 400,
          code: 'VALIDATION_ERROR',
          message: '依頼先スタッフはこのタスク種別を担当できません',
        },
      ],
    ] as const) {
      const response = (await PATCH(createPatchRequest('task_1', { assigned_to: assignee }), {
        params: Promise.resolve({ id: 'task_1' }),
      }))!;
      expect(response.status).toBe(expected.status);
      if (expected.status === 403) expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: expected.code,
        message: expected.message,
      });
    }

    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('allows an unrestricted audit reassignment to an active pharmacist', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_1',
      task_type: 'staff_work_request_audit',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: null,
      related_entity_id: null,
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
      { user_id: 'pharmacist_2', role: 'pharmacist', can_audit_dispense: true },
    ]);

    const response = (await PATCH(createPatchRequest('task_1', { assigned_to: 'pharmacist_2' }), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task_1', org_id: 'org_1' },
        data: expect.objectContaining({ assigned_to: 'pharmacist_2' }),
      }),
    );
  });

  it('rejects blank task ids before parsing or resolving assignment scope', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('task_1'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'タスクIDが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('updates a task and sets completed_at when marking it completed', async () => {
    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canManageOperationalTasks' }),
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'task_1',
        org_id: 'org_1',
        OR: [
          { assigned_to: 'user_1' },
          {
            related_entity_type: 'patient',
            related_entity_id: { in: ['patient_1'] },
          },
          {
            related_entity_type: 'case',
            related_entity_id: { in: ['case_1'] },
          },
        ],
        status: { in: ['pending', 'in_progress'] },
      },
      data: expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(Date),
      }),
    });
    expect(taskFindUniqueMock).toHaveBeenCalledWith({ where: { id: 'task_1' } });
  });

  it.each(['staff_work_request_visit', 'staff_work_request_audit'])(
    'does not let a clerk update pharmacist-only task type %s',
    async (taskType) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { orgId: 'org_1', userId: 'clerk_1', role: 'clerk' },
      });
      taskFindFirstMock.mockResolvedValueOnce({
        id: 'task_restricted_1',
        task_type: taskType,
        assigned_to: 'clerk_1',
        completed_at: null,
        related_entity_type: null,
        related_entity_id: null,
      });
      membershipFindManyMock.mockResolvedValueOnce([
        { user_id: 'clerk_1', role: 'clerk', can_audit_dispense: false },
      ]);

      const response = (await PATCH(
        createPatchRequest('task_restricted_1', { status: 'completed' }),
        { params: Promise.resolve({ id: 'task_restricted_1' }) },
      ))!;

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: 'このタスク種別を更新する権限がありません',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [false, 403],
    [true, 200],
  ] as const)(
    'enforces the actor membership audit flag (can_audit_dispense=%s)',
    async (canAuditDispense, expectedStatus) => {
      taskFindFirstMock.mockResolvedValueOnce({
        id: 'task_audit_1',
        task_type: 'staff_work_request_audit',
        assigned_to: 'user_1',
        completed_at: null,
        related_entity_type: null,
        related_entity_id: null,
      });
      membershipFindManyMock.mockResolvedValueOnce([
        {
          user_id: 'user_1',
          role: 'pharmacist',
          can_audit_dispense: canAuditDispense,
        },
      ]);

      const response = (await PATCH(createPatchRequest('task_audit_1', { status: 'completed' }), {
        params: Promise.resolve({ id: 'task_audit_1' }),
      }))!;

      expect(response.status).toBe(expectedStatus);
      if (canAuditDispense) {
        expect(taskUpdateManyMock).toHaveBeenCalledOnce();
      } else {
        await expect(response.json()).resolves.toMatchObject({
          code: 'AUTH_FORBIDDEN',
          message: 'このタスク種別を更新する権限がありません',
        });
        expect(withOrgContextMock).not.toHaveBeenCalled();
        expect(taskUpdateManyMock).not.toHaveBeenCalled();
      }
    },
  );

  it('returns conflict when a stale status update loses the open-task claim', async () => {
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'visit_contact_followup',
      assigned_to: 'user_1',
      completed_at: new Date('2026-06-18T08:00:00.000Z'),
      related_entity_type: 'visit_schedule_proposal',
      related_entity_id: 'proposal_1',
    });
    taskUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'in_progress',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'タスクはすでに完了または取り消されています。再読み込みしてください',
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'task_1',
          org_id: 'org_1',
          status: { in: ['pending', 'in_progress'] },
        }),
      }),
    );
    expect(taskFindUniqueMock).not.toHaveBeenCalled();
  });

  it.each([
    ['visit_preparation', 'visit_schedule', 'schedule_1'],
    ['visit_contact_followup', 'visit_schedule_proposal', 'proposal_1'],
    ['visit_schedule_override_approval', 'visit_schedule', 'schedule_1'],
    ['handoff_confirmation', 'visit_record', 'visit_record_1'],
    ['handoff_supervision_review', 'visit_record', 'visit_record_1'],
    ['core.handoff_supervision_review', 'visit_record', 'visit_record_1'],
    ['risk_billing', 'billing_evidence', 'bill_1'],
    ['risk_medication', 'case', 'case_1'],
  ])(
    'rejects generic completion for %s tasks that require dedicated flows',
    async (taskType, relatedEntityType, relatedEntityId) => {
      taskFindFirstMock.mockResolvedValue({
        id: 'task_1',
        task_type: taskType,
        assigned_to: 'user_1',
        completed_at: null,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      });

      const response = (await PATCH(
        createPatchRequest('task_1', {
          status: 'completed',
        }),
        {
          params: Promise.resolve({ id: 'task_1' }),
        },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: 'このタスクは専用画面で完了してください',
      });
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects generic cancellation for risk tasks because waiver requires reason and audit', async () => {
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'risk_billing',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: 'billing_evidence',
      related_entity_id: 'bill_1',
    });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'cancelled',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'このタスクは専用画面で完了してください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects archived related patients before updating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients resolved from related cases before updating operational tasks', async () => {
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'general',
      assigned_to: 'user_1',
      completed_at: null,
      related_entity_type: 'case',
      related_entity_id: 'case_1',
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = (await PATCH(
      createPatchRequest('task_1', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: { patient_id: true },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object update payloads before resolving assignment scope', async () => {
    const response = (await PATCH(createPatchRequest('task_1', []), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON update payloads before resolving assignment scope', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest('task_1'), {
      params: Promise.resolve({ id: 'task_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('does not update tasks outside the assignment scope', async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest('task_unassigned', {
        status: 'completed',
      }),
      {
        params: Promise.resolve({ id: 'task_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task_unassigned',
        org_id: 'org_1',
        OR: [
          { assigned_to: 'user_1' },
          {
            related_entity_type: 'patient',
            related_entity_id: { in: ['patient_1'] },
          },
          {
            related_entity_type: 'case',
            related_entity_id: { in: ['case_1'] },
          },
        ],
      },
    });
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});
