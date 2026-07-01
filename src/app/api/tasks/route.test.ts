import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  taskFindManyMock,
  userFindManyMock,
  membershipFindFirstMock,
  taskFindFirstMock,
  taskCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskCreateMock: vi.fn(),
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
      findMany: taskFindManyMock,
      findFirst: taskFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/tasks', () => {
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
    taskFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
    membershipFindFirstMock.mockResolvedValue({ user_id: 'user_1' });
    taskFindFirstMock.mockResolvedValue(null);
    taskCreateMock.mockResolvedValue({ id: 'task_1', title: '折返し対応' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          create: taskCreateMock,
        },
      }),
    );
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
      'padded assigned_to',
      'http://localhost/api/tasks?assigned_to=%20user_1',
      { assigned_to: ['担当者IDの形式が不正です'] },
    ],
    [
      'blank related_entity_type',
      'http://localhost/api/tasks?related_entity_type=',
      { related_entity_type: ['関連リソース種別を指定してください'] },
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
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'task_1',
          assigned_to: 'user_2',
          assigned_to_name: '佐藤 薬剤師',
          can_complete_inline: true,
        },
      ],
      hasMore: false,
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
      hasMore: true,
      nextCursor: 'task_1',
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
          can_complete_inline: true,
        },
      ],
      hasMore: false,
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
    expect(membershipFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: 'user_1',
        is_active: true,
        user: { is_active: true },
      },
      select: { user_id: true },
    });
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
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
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients resolved from related cases before creating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: 'ケースA: 服薬の困りごと',
        priority: 'high',
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
      },
      select: { patient_id: true },
    });
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects create payloads assigned to inactive or unknown staff', async () => {
    membershipFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest('http://localhost/api/tasks', {
        task_type: 'patient_self_report_followup',
        title: '患者A: 服薬の困りごと',
        priority: 'high',
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      }),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '依頼先スタッフが見つかりません',
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before resolving assignment scope', async () => {
    const response = await POST(createRequest('http://localhost/api/tasks', []));
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
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
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
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
