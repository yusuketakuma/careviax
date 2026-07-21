import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import {
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
} from '@/lib/patient/archive-summary';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  taskFindManyMock,
  userFindManyMock,
  membershipFindManyMock,
  taskFindFirstMock,
  taskCreateMock,
  withOrgContextMock,
  allocateDisplayIdMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (req: NextRequest, ctx: Record<string, unknown>) => Promise<Response>,
      options?: unknown,
    ) =>
    async (req: NextRequest) =>
      withRoutePerformanceMock(req, async () => {
        const noStore = (response: Response) => {
          response.headers.set('Cache-Control', 'private, no-store, max-age=0');
          response.headers.set('Pragma', 'no-cache');
          return response;
        };
        const authResult = await requireAuthContextMock(req, options);
        if ('response' in authResult) return noStore(authResult.response);
        return runWithRequestAuthContextMock(authResult.ctx, async () => {
          try {
            return noStore(await handler(req, authResult.ctx));
          } catch (error) {
            unstable_rethrow(error);
            loggerErrorMock(
              {
                event: 'route_handler_unhandled_error',
                route: req.nextUrl.pathname,
                method: req.method,
                requestId: authResult.ctx.requestId,
                correlationId: authResult.ctx.correlationId,
              },
              error,
            );
            return noStore(
              Response.json(
                { code: 'INTERNAL_ERROR', message: 'サーバー内部でエラーが発生しました' },
                { status: 500 },
              ),
            );
          }
        });
      }),
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
      findMany: taskFindManyMock,
      findFirst: taskFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  buildDefaultCreatedTask,
  createMalformedJsonRequest,
  createRequest,
  createTaskAuthContext,
  expectTaskWriteNotStarted,
  GET,
  installTaskCreateTransactionMock,
  POST,
} from './route.test-helpers';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

describe('/api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(createTaskAuthContext('pharmacist'));
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ patient_id: 'patient_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    taskFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist', can_audit_dispense: true },
    ]);
    taskFindFirstMock.mockResolvedValue(null);
    taskCreateMock.mockResolvedValue(buildDefaultCreatedTask());
    allocateDisplayIdMock.mockResolvedValue('t0000000001');
    installTaskCreateTransactionMock(withOrgContextMock, taskCreateMock);
  });

  it('filters tasks by related entity fields', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/tasks?task_type=conference_action_item&related_entity_type=conference_note&related_entity_id=note_1',
      ),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: 'canManageOperationalTasks' }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ id: true, task_type: true, title: true }),
        where: expect.objectContaining({
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
          task_type: 'conference_action_item',
          related_entity_type: 'conference_note',
          related_entity_id: 'note_1',
        }),
      }),
    );
    const findManyInput = taskFindManyMock.mock.calls[0]?.[0];
    expect(findManyInput.select).not.toHaveProperty('metadata');
    expect(findManyInput.select).not.toHaveProperty('org_id');
    expect(findManyInput.select).not.toHaveProperty('dedupe_key');
  });

  it('omits optional task filters from the Prisma where clause when not provided', async () => {
    const response = await GET(createRequest('http://localhost/api/tasks'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
        }),
      }),
    );
    const where = taskFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where).not.toHaveProperty('task_type');
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('priority');
    expect(where).not.toHaveProperty('assigned_to');
    expect(where).not.toHaveProperty('related_entity_type');
    expect(where).not.toHaveProperty('related_entity_id');
  });

  it('filters open tasks by multiple task types without weakening assignment scope', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/tasks?status=open&task_types=visit_preparation,visit_contact_followup,visit_schedule_override_approval',
      ),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
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
          task_type: {
            in: ['visit_preparation', 'visit_contact_followup', 'visit_schedule_override_approval'],
          },
        }),
      }),
    );
  });

  it('rejects ambiguous single and multiple task type filters', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/tasks?task_type=visit_preparation&task_types=visit_demand',
      ),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects empty task_types filters before resolving assignment scope', async () => {
    const response = await GET(createRequest('http://localhost/api/tasks?task_types=,,,'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'duplicate task_type',
      'http://localhost/api/tasks?task_type=visit_preparation&task_type=visit_demand',
      { task_type: ['task_type は1つだけ指定してください'] },
    ],
    [
      'blank task_type',
      'http://localhost/api/tasks?task_type=%20%20',
      { task_type: ['タスク種別を指定してください'] },
    ],
    [
      'padded task_type',
      'http://localhost/api/tasks?task_type=%20visit_preparation',
      { task_type: ['タスク種別の形式が不正です'] },
    ],
    [
      'blank task_types',
      'http://localhost/api/tasks?task_types=',
      { task_types: ['task_types には1件以上の種別を指定してください'] },
    ],
    [
      'blank status',
      'http://localhost/api/tasks?status=',
      { status: ['ステータスを指定してください'] },
    ],
    [
      'padded status',
      'http://localhost/api/tasks?status=pending%20',
      { status: ['対応していないステータスです'] },
    ],
    [
      'duplicate priority',
      'http://localhost/api/tasks?priority=urgent&priority=normal',
      { priority: ['priority は1つだけ指定してください'] },
    ],
    [
      'blank priority',
      'http://localhost/api/tasks?priority=%20%20',
      { priority: ['優先度を指定してください'] },
    ],
    [
      'padded priority',
      'http://localhost/api/tasks?priority=%20urgent',
      { priority: ['対応していない優先度です'] },
    ],
    [
      'duplicate assigned_to',
      'http://localhost/api/tasks?assigned_to=user_1&assigned_to=user_2',
      { assigned_to: ['assigned_to は1つだけ指定してください'] },
    ],
    [
      'blank assigned_to',
      'http://localhost/api/tasks?assigned_to=%20%20',
      { assigned_to: ['担当者IDを指定してください'] },
    ],
    [
      'padded assigned_to',
      'http://localhost/api/tasks?assigned_to=%20user_1',
      { assigned_to: ['担当者IDの形式が不正です'] },
    ],
    [
      'duplicate related_entity_type',
      'http://localhost/api/tasks?related_entity_type=patient&related_entity_type=case',
      { related_entity_type: ['related_entity_type は1つだけ指定してください'] },
    ],
    [
      'blank related_entity_type',
      'http://localhost/api/tasks?related_entity_type=',
      { related_entity_type: ['関連リソース種別を指定してください'] },
    ],
    [
      'padded related_entity_type',
      'http://localhost/api/tasks?related_entity_type=patient%20',
      { related_entity_type: ['関連リソース種別の形式が不正です'] },
    ],
    [
      'duplicate related_entity_id',
      'http://localhost/api/tasks?related_entity_id=patient_1&related_entity_id=patient_2',
      { related_entity_id: ['related_entity_id は1つだけ指定してください'] },
    ],
    [
      'blank related_entity_id',
      'http://localhost/api/tasks?related_entity_id=%20%20',
      { related_entity_id: ['関連リソースIDを指定してください'] },
    ],
    [
      'padded related_entity_id',
      'http://localhost/api/tasks?related_entity_id=%20patient_1',
      { related_entity_id: ['関連リソースIDの形式が不正です'] },
    ],
    [
      'too long related_entity_id',
      `http://localhost/api/tasks?related_entity_id=${'x'.repeat(192)}`,
      { related_entity_id: ['関連リソースIDの形式が不正です'] },
    ],
  ])(
    'rejects malformed %s filters before resolving assignment scope',
    async (_name, url, details) => {
      const response = await GET(createRequest(url));
      if (!response) throw new Error('response is undefined');

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '検索条件が不正です',
        details,
      });
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(taskFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('filters tasks by priority and decorates assigned user names', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        title: '患者A: 服薬の困りごと',
        assigned_to: 'user_2',
        priority: 'high',
      },
    ]);
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_2', name: '佐藤 薬剤師' }]);

    const response = await GET(
      createRequest('http://localhost/api/tasks?priority=high&status=pending'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          priority: 'high',
          status: 'pending',
        }),
      }),
    );
    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', id: { in: ['user_2'] } },
      select: { id: true, name: true },
    });
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta']);
    expect(payload).toMatchObject({
      data: [
        {
          id: 'task_1',
          assigned_to: 'user_2',
          assigned_to_name: '佐藤 薬剤師',
          can_complete_inline: true,
        },
      ],
      meta: { has_more: false, next_cursor: null },
    });
  });

  it('adds sensitive no-store headers to auth failures', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' },
        {
          status: 401,
        },
      ),
    });

    const response = await GET(createRequest('http://localhost/api/tasks'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it('does not expose internal task fields in list responses', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        org_id: 'org_1',
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        description: '折返し対応',
        status: 'pending',
        priority: 'high',
        assigned_to: null,
        due_date: null,
        sla_due_at: null,
        completed_at: null,
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        created_at: '2026-06-25T00:00:00.000Z',
        updated_at: '2026-06-25T00:00:00.000Z',
        dedupe_key: 'patient-self-report:report_1',
        metadata: { patient_note: 'free text' },
      },
    ]);

    const response = await GET(createRequest('http://localhost/api/tasks?status=pending'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      id: 'task_1',
      task_type: 'patient_self_report_followup',
      related_entity_id: 'patient_1',
      can_complete_inline: true,
    });
    expect(body.data[0]).not.toHaveProperty('org_id');
    expect(body.data[0]).not.toHaveProperty('dedupe_key');
    expect(body.data[0]).not.toHaveProperty('metadata');
    expect(body.data[0]).not.toHaveProperty('updated_at');
  });

  it('paginates task results and returns the next cursor', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        assigned_to: null,
        priority: 'high',
      },
      {
        id: 'task_2',
        task_type: 'patient_self_report_followup',
        title: '患者B: 服薬の困りごと',
        assigned_to: null,
        priority: 'normal',
      },
    ]);

    const response = await GET(createRequest('http://localhost/api/tasks?limit=1&cursor=task_0'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 'task_0' },
        skip: 1,
        orderBy: [
          { sla_due_at: 'asc' },
          { due_date: 'asc' },
          { created_at: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'task_1',
          can_complete_inline: true,
        },
      ],
      meta: { has_more: true, next_cursor: 'task_1' },
    });
  });

  it('rejects stale task cursors without leaking a server error', async () => {
    taskFindManyMock.mockRejectedValueOnce({ code: 'P2025' });

    const response = await GET(
      createRequest('http://localhost/api/tasks?limit=10&cursor=deleted_task'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(userFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'ページカーソルが不正です',
      details: {
        cursor: ['指定されたカーソルのタスクが見つかりません'],
      },
    });
  });

  it('returns a no-store fixed error without leaking assignment scope failures', async () => {
    careCaseFindManyMock.mockRejectedValueOnce(
      new Error('raw patient assignment scope failure for task list'),
    );

    const response = await GET(createRequest('http://localhost/api/tasks?status=open'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw patient assignment scope failure');
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking task list failures', async () => {
    taskFindManyMock.mockRejectedValueOnce(new Error('raw patient task list failure'));

    const response = await GET(createRequest('http://localhost/api/tasks?status=open'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw patient task list failure');
    expect(userFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking assignee hydration failures', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        assigned_to: 'user_2',
        priority: 'high',
      },
    ]);
    userFindManyMock.mockRejectedValueOnce(new Error('raw patient task assignee failure'));

    const response = await GET(createRequest('http://localhost/api/tasks?status=open'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw patient task assignee failure');
  });

  it('marks tasks that require dedicated workflows as not inline-completable', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'visit_preparation',
        title: '訪問準備',
        assigned_to: null,
        priority: 'high',
      },
      {
        id: 'task_2',
        task_type: 'visit_schedule_override_approval',
        title: '例外変更承認',
        assigned_to: null,
        priority: 'high',
      },
      {
        id: 'task_3',
        task_type: 'handoff_confirmation',
        title: '申し送り確認',
        assigned_to: null,
        priority: 'high',
      },
      {
        id: 'task_4',
        task_type: 'handoff_supervision_review',
        title: '申し送り上長確認',
        assigned_to: null,
        priority: 'high',
      },
      {
        id: 'task_5',
        task_type: 'care_report_followup',
        title: '報告フォロー',
        assigned_to: null,
        priority: 'normal',
      },
    ]);

    const response = await GET(createRequest('http://localhost/api/tasks?status=open'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'task_1',
          can_complete_inline: false,
        },
        {
          id: 'task_2',
          can_complete_inline: false,
        },
        {
          id: 'task_3',
          can_complete_inline: false,
        },
        {
          id: 'task_4',
          can_complete_inline: false,
        },
        {
          id: 'task_5',
          can_complete_inline: true,
        },
      ],
      meta: { has_more: false, next_cursor: null },
    });
  });

  it('rejects unsupported status filters before resolving assignment scope', async () => {
    const response = await GET(createRequest('http://localhost/api/tasks?status=bad_status'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported priority filters before resolving assignment scope', async () => {
    const response = await GET(createRequest('http://localhost/api/tasks?priority=bad_priority'));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
  });

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
});
