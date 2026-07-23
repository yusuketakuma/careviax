import { expect, it } from 'vitest';
import {
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
} from '@/lib/patient/archive-summary';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';
import { getTasksRouteTestSupport } from './route.test-support';
import {
  createMalformedJsonRequest,
  createRequest,
  expectTaskWriteNotStarted,
  POST,
} from '../route.test-helpers';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  membershipFindManyMock,
  taskFindFirstMock,
  taskCreateMock,
  withOrgContextMock,
  allocateDisplayIdMock,
} = getTasksRouteTestSupport();

export function registerTasksRoutePostCases() {
  it('creates an operational task', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        description: '折返し対応',
        priority: 'high',
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: { source: 'self_report', severity: 'high' },
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canManageOperationalTasks' }),
    );
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: { in: ['user_1'] },
        is_active: true,
        user: { is_active: true, account_status: 'active' },
      },
      select: { user_id: true, role: true, can_audit_dispense: true },
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ task: expect.objectContaining({ create: taskCreateMock }) }),
      'Task',
      'org_1',
    );
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        display_id: 't0000000001',
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: { source: 'self_report', severity: 'high' },
      }),
    });
  });

  it.each(['staff_work_request_audit', 'pharmacy.staff_work_request_audit'])(
    'creates %s with a complete allowed related-entity tuple',
    async (taskType) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
      });
      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          task_type: taskType,
          title: '調剤監査を依頼',
          related_entity_type: 'dispense_task',
          related_entity_id: 'dispense_1',
        }),
      );
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(201);
      expectSensitiveNoStore(response);
      expect(taskCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_type: taskType,
          related_entity_type: 'dispense_task',
          related_entity_id: 'dispense_1',
        }),
      });
    },
  );

  it.each(['handoff_supervision_review', 'core.handoff_supervision_review'])(
    'rejects generic creation of protected supervision tasks before scope resolution or writes (%s)',
    async (taskType) => {
      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          task_type: taskType,
          title: '申し送り上長確認',
          priority: 'high',
          assigned_to: 'user_1',
          related_entity_type: 'visit_record',
          related_entity_id: 'visit_record_1',
          metadata: {
            visit_record_id: 'visit_record_1',
            visit_record_version: 2,
            trainee_user_id: 'trainee_1',
            supervisor_user_id: 'user_1',
          },
        }),
      );
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: 'このタスクは専用フローから作成してください',
        details: { task_type: ['専用の上長確認依頼を使用してください'] },
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(allocateDisplayIdMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskCreateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'legacy disallowed type',
      {
        task_type: 'staff_work_request_audit',
        related_entity_type: 'visit_schedule',
        related_entity_id: 'visit_1',
      },
      { related_entity_type: ['このタスク種別では指定できない関連リソースです'] },
    ],
    [
      'canonical disallowed type',
      {
        task_type: 'pharmacy.staff_work_request_audit',
        assigned_to: 'assignee_1',
        related_entity_type: 'visit_schedule',
        related_entity_id: 'visit_1',
      },
      { related_entity_type: ['このタスク種別では指定できない関連リソースです'] },
    ],
    [
      'missing id',
      {
        task_type: 'staff_work_request_audit',
        related_entity_type: 'dispense_task',
      },
      { related_entity_id: ['関連リソース種別とIDは同時に指定してください'] },
    ],
    [
      'missing type',
      {
        task_type: 'staff_work_request_audit',
        related_entity_id: 'dispense_1',
      },
      { related_entity_type: ['関連リソース種別とIDは同時に指定してください'] },
    ],
    [
      'blank type',
      {
        task_type: 'staff_work_request_audit',
        related_entity_type: '   ',
        related_entity_id: 'dispense_1',
      },
      { related_entity_type: ['関連リソース種別を指定してください'] },
    ],
    [
      'blank id',
      {
        task_type: 'staff_work_request_audit',
        related_entity_type: 'dispense_task',
        related_entity_id: '   ',
      },
      { related_entity_id: ['関連リソースIDを指定してください'] },
    ],
  ] as const)(
    'rejects an invalid related-entity contract before scope resolution or writes (%s)',
    async (_label, relatedEntityInput, expectedDetails) => {
      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          title: '不正な関連リソースを拒否',
          ...relatedEntityInput,
        }),
      );
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '関連リソースの指定が不正です',
        details: expectedDetails,
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(allocateDisplayIdMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskCreateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['staff_work_request_visit', 'clerk'],
    ['staff_work_request_audit', 'pharmacist'],
    ['staff_work_request_audit', 'pharmacist_trainee'],
    ['staff_work_request_general', 'driver'],
    ['patient_self_report_followup', 'external_viewer'],
  ] as const)(
    'rejects %s assignment to an ineligible %s before creating a task',
    async (taskType, assigneeRole) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
      });
      membershipFindManyMock.mockResolvedValueOnce([
        { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
        { user_id: 'assignee_1', role: assigneeRole, can_audit_dispense: false },
      ]);

      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          task_type: taskType,
          title: '担当資格を確認する依頼',
          priority: 'normal',
          assigned_to: 'assignee_1',
        }),
      );
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '依頼先スタッフはこのタスク種別を担当できません',
        details: {
          reason: 'task_assignee_ineligible',
          assigned_to: ['このタスク種別を担当できるスタッフを選択してください'],
        },
      });
      expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
    },
  );

  it.each(['', '   '])(
    'rejects a blank assigned_to value before assignment scope or writes (%j)',
    async (assignedTo) => {
      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          task_type: 'staff_work_request_general',
          title: '空の担当者を拒否',
          assigned_to: assignedTo,
        }),
      );
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
        details: { assigned_to: ['assigned_to は空にできません'] },
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(membershipFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(taskCreateMock).not.toHaveBeenCalled();
    },
  );

  it('keeps personal-scope callers limited to self-assignment before membership lookup', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'staff_work_request_general',
        title: '他スタッフへの依頼',
        priority: 'normal',
        assigned_to: 'user_2',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: 'このユーザーへのタスク割り当て権限がありません',
      details: {
        reason: 'task_assignee_ineligible',
        assigned_to: ['担当できるスタッフを選択してください'],
      },
    });
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: { in: ['user_1', 'user_2'] } }),
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('allows an owner to create a task for another active eligible staff member', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
      { user_id: 'pharmacist_2', role: 'pharmacist', can_audit_dispense: true },
    ]);

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'staff_work_request_audit',
        title: '監査依頼',
        priority: 'normal',
        assigned_to: 'pharmacist_2',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(201);
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        task_type: 'staff_work_request_audit',
        assigned_to: 'pharmacist_2',
      }),
    });
  });

  it('fails closed when the actor or assignee has mixed active roles', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
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

    for (const [title, expected] of [
      [
        'actor role ambiguity',
        {
          status: 403,
          code: 'AUTH_FORBIDDEN',
          message: 'このユーザーへのタスク割り当て権限がありません',
        },
      ],
      [
        'assignee role ambiguity',
        {
          status: 400,
          code: 'VALIDATION_ERROR',
          message: '依頼先スタッフはこのタスク種別を担当できません',
        },
      ],
    ] as const) {
      const response = await POST(
        createRequest('http://localhost/api/tasks', {
          task_type: 'staff_work_request_general',
          title,
          assigned_to: 'pharmacist_2',
        }),
      );
      if (!response) throw new Error('response is undefined');
      expect(response.status).toBe(expected.status);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: expected.code,
        message: expected.message,
      });
    }

    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('keeps patient-scoped follow-up tasks unassigned when the caller omits assigned_to', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'report_response_followup',
        title: '返信内容を次回確認',
        priority: 'normal',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(201);
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        task_type: 'report_response_followup',
        assigned_to: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    });
  });

  it('rejects an unassigned patient follow-up outside the personal scope before writes', async () => {
    careCaseFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'report_response_followup',
        title: '返信内容を次回確認',
        priority: 'normal',
        related_entity_type: 'patient',
        related_entity_id: 'patient_unassigned',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '担当外リソースのタスクは作成できません',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('returns the existing task when a duplicate dedupe key create races', async () => {
    taskCreateMock.mockRejectedValueOnce({ code: 'P2002' });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_existing',
      org_id: 'org_1',
      dedupe_key: 'share-reply-task:response_1',
      title: '返信内容を次回確認',
    });

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'care_report_followup',
        title: '返信内容を次回確認',
        priority: 'normal',
        assigned_to: 'user_1',
        dedupe_key: 'share-reply-task:response_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        dedupe_key: 'share-reply-task:response_1',
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'task_existing',
        dedupe_key: 'share-reply-task:response_1',
      },
    });
  });

  it('returns a sanitized no-store internal error when duplicate lookup fails', async () => {
    const rawMessage = 'duplicate lookup leaked patient sentinel';
    taskCreateMock.mockRejectedValueOnce({ code: 'P2002' });
    taskFindFirstMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'care_report_followup',
        title: '返信内容を次回確認',
        priority: 'normal',
        assigned_to: 'user_1',
        dedupe_key: 'share-reply-task:response_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain(rawMessage);
  });

  it('rejects archived related patients before creating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
      message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
    });
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('rejects archived patients resolved from related cases before creating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'staff_work_request_general',
        title: 'ケースA: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
      message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
    });
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: { patient_id: true },
    });
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('rejects inactive, non-active-account, cross-org, or unknown assignees', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'owner_1', role: 'owner' },
    });
    membershipFindManyMock.mockResolvedValueOnce([
      { user_id: 'owner_1', role: 'owner', can_audit_dispense: true },
    ]);

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        assigned_to: 'unavailable_user',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
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
        user_id: { in: ['owner_1', 'unavailable_user'] },
        is_active: true,
        user: { is_active: true, account_status: 'active' },
      },
      select: { user_id: true, role: true, can_audit_dispense: true },
    });
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before resolving assignment scope', async () => {
    const response = await POST(createRequest('http://localhost/api/tasks', []));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('rejects unregistered task types before related-entity validation or assignment scope', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'unknown_task_type',
        title: '未登録種別',
        related_entity_type: 'patient',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '未登録のタスク種別です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('rejects malformed JSON create payloads before resolving assignment scope', async () => {
    const response = await POST(createMalformedJsonRequest('http://localhost/api/tasks'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('rejects creation for an unassigned related patient before write', async () => {
    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者B: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'patient',
        related_entity_id: 'patient_unassigned',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('adds sensitive no-store headers to POST auth failures', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ message: '運用タスクの作成権限がありません' }), {
        status: 403,
      }),
    });

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expectTaskWriteNotStarted(withOrgContextMock, allocateDisplayIdMock, taskCreateMock);
  });

  it('returns a sanitized no-store internal error when task creation throws', async () => {
    const rawMessage = 'database exploded with patient sentinel';
    taskCreateMock.mockRejectedValueOnce(new Error(rawMessage));

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain(rawMessage);
  });
}
