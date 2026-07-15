import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { bulkCompleteTasksResponseSchema } from '@/lib/tasks/bulk-completion-contract';

const {
  requireAuthContextMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  patientFindFirstMock,
  membershipFindManyMock,
  taskFindManyMock,
  taskUpdateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>, options?: unknown) =>
    async (req: unknown, routeContext?: unknown) => {
      const authResult = await requireAuthContextMock(req, options);
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, routeContext);
    },
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
    membership: {
      findMany: membershipFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tasks/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/tasks/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  });
}

describe('/api/tasks/bulk', () => {
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
    membershipFindManyMock.mockResolvedValue([{ role: 'pharmacist', can_audit_dispense: true }]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'patient_self_report_followup',
        status: 'pending',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
      },
      {
        id: 'task_2',
        task_type: 'general',
        status: 'in_progress',
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      },
    ]);
    taskUpdateManyMock.mockReset();
    taskUpdateManyMock.mockResolvedValue({ count: 2 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          updateMany: taskUpdateManyMock,
        },
      }),
    );
  });

  it('returns the authorization response before parsing or resolving task scope', async () => {
    const deniedResponse = Response.json(
      { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
      { status: 403 },
    );
    requireAuthContextMock.mockResolvedValueOnce({ response: deniedResponse });

    const response = await POST(createMalformedPostRequest());

    expect(response).toBe(deniedResponse);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('completes inline tasks with one scoped updateMany call', async () => {
    const response = await POST(createPostRequest({ ids: ['task_1', 'task_2'] }));

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        permission: 'canManageOperationalTasks',
        message: '運用タスクの更新権限がありません',
      }),
    );
    const body = await response.json();
    expect(bulkCompleteTasksResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      data: {
        total: 2,
        completed: 2,
        failed: 0,
        failures: [],
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['task_1', 'task_2'] },
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
      select: {
        id: true,
        task_type: true,
        status: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledOnce();
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['task_1', 'task_2'] },
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
      data: {
        status: 'completed',
        completed_at: expect.any(Date),
      },
    });
  });

  it('lets a clerk complete general work but rejects visit and audit work', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { orgId: 'org_1', userId: 'clerk_1', role: 'clerk' },
    });
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_general',
        task_type: 'staff_work_request_general',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
      {
        id: 'task_visit',
        task_type: 'staff_work_request_visit',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
      {
        id: 'task_audit',
        task_type: 'staff_work_request_audit',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
    ]);
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    membershipFindManyMock.mockResolvedValueOnce([{ role: 'clerk', can_audit_dispense: false }]);

    const response = await POST(
      createPostRequest({ ids: ['task_general', 'task_visit', 'task_audit'] }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        total: 3,
        completed: 1,
        failed: 2,
        failures: [
          {
            id: 'task_visit',
            code: 'task_permission_denied',
            message: 'このタスク種別を更新する権限がありません',
          },
          {
            id: 'task_audit',
            code: 'task_permission_denied',
            message: 'このタスク種別を更新する権限がありません',
          },
        ],
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['task_general'] } }) }),
    );
  });

  it.each([
    ['pharmacist', false, 0],
    ['pharmacist', true, 1],
    ['admin', false, 1],
  ] as const)(
    'enforces actor audit membership for %s (flag=%s)',
    async (role, canAuditDispense, expectedCompleted) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { orgId: 'org_1', userId: 'actor_1', role },
      });
      membershipFindManyMock.mockResolvedValueOnce([
        { role, can_audit_dispense: canAuditDispense },
      ]);
      taskFindManyMock.mockResolvedValueOnce([
        {
          id: 'task_audit',
          task_type: 'staff_work_request_audit',
          status: 'pending',
          related_entity_type: null,
          related_entity_id: null,
        },
      ]);
      taskUpdateManyMock.mockResolvedValueOnce({ count: expectedCompleted });

      const response = await POST(createPostRequest({ ids: ['task_audit'] }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.completed).toBe(expectedCompleted);
      if (expectedCompleted === 0) {
        expect(body.data.failures).toEqual([
          {
            id: 'task_audit',
            code: 'task_permission_denied',
            message: 'このタスク種別を更新する権限がありません',
          },
        ]);
        expect(taskUpdateManyMock).not.toHaveBeenCalled();
      } else {
        expect(body.data.failures).toEqual([]);
        expect(taskUpdateManyMock).toHaveBeenCalledOnce();
      }
    },
  );

  it('returns a stale-state conflict when fewer eligible tasks are updated than selected', async () => {
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(createPostRequest({ ids: ['task_1', 'task_2'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 2,
        completed: 1,
        failed: 1,
        failures: [
          {
            id: null,
            code: 'conflict',
            message: '1件のタスクはすでに完了または取り消されています。再読み込みしてください',
          },
        ],
      },
    });
  });

  it('deduplicates requested ids before querying and updating', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'general',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
    ]);
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(createPostRequest({ ids: ['task_1', 'task_1'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        completed: 1,
        failed: 0,
      },
    });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
  });

  it('returns partial failures for inaccessible and dedicated-flow tasks', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_1',
        task_type: 'general',
        status: 'pending',
        related_entity_type: null,
        related_entity_id: null,
      },
      {
        id: 'task_2',
        task_type: 'handoff_confirmation',
        status: 'pending',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      },
      {
        id: 'task_3',
        task_type: 'handoff_supervision_review',
        status: 'pending',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      },
      {
        id: 'task_4',
        task_type: 'risk_billing',
        status: 'pending',
        related_entity_type: 'billing_evidence',
        related_entity_id: 'bill_1',
      },
    ]);
    taskUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await POST(
      createPostRequest({ ids: ['task_1', 'task_2', 'task_3', 'task_4', 'task_missing'] }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 5,
        completed: 1,
        failed: 4,
        failures: [
          {
            id: 'task_2',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_3',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_4',
            code: 'dedicated_completion_required',
            message: 'このタスクは専用画面で完了してください',
          },
          {
            id: 'task_missing',
            code: 'not_found',
            message: 'タスクが見つかりません',
          },
        ],
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['task_1'] },
        }),
      }),
    );
  });

  it('rejects canonical supervision tasks from generic bulk completion', async () => {
    taskFindManyMock.mockResolvedValueOnce([
      {
        id: 'task_canonical_supervision',
        task_type: 'core.handoff_supervision_review',
        status: 'pending',
        related_entity_type: 'visit_record',
        related_entity_id: 'visit_record_1',
      },
    ]);

    const response = await POST(createPostRequest({ ids: ['task_canonical_supervision'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        completed: 0,
        failed: 1,
        failures: [
          {
            id: 'task_canonical_supervision',
            code: 'dedicated_completion_required',
          },
        ],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects archived related patients before updating operational tasks', async () => {
    patientFindFirstMock.mockResolvedValueOnce({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(createPostRequest({ ids: ['task_1'] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total: 1,
        completed: 0,
        failed: 1,
        failures: [
          {
            id: 'task_1',
            code: 'conflict',
            message: 'アーカイブ中の患者は復元するまで更新できません',
          },
        ],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object and malformed payloads before resolving assignment scope', async () => {
    const arrayResponse = await POST(createPostRequest([]));
    const malformedResponse = await POST(createMalformedPostRequest());

    expect(arrayResponse.status).toBe(400);
    expect(malformedResponse.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});
