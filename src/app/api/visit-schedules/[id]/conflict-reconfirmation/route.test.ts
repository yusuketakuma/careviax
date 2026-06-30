import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  taskCreateMock,
  taskFindFirstMock,
  auditLogCreateMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: auditLogCreateMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest(
    'http://localhost/api/visit-schedules/schedule_1/conflict-reconfirmation',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify(body),
    },
  );
}

function routeContext(id = 'schedule_1') {
  return { params: Promise.resolve({ id }) };
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/visit-schedules/[id]/conflict-reconfirmation POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      pharmacist_id: 'pharmacist_1',
      scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
      schedule_status: 'planned',
      confirmed_at: null,
    });
    taskCreateMock.mockResolvedValue({
      id: 'task_1',
      task_type: 'staff_work_request_visit',
      dedupe_key: 'schedule-conflict-reconfirmation:schedule_1:2026-04-09',
    });
    taskFindFirstMock.mockResolvedValue(null);
    auditLogCreateMock.mockResolvedValue(undefined);
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: { findFirst: visitScheduleFindFirstMock },
        task: {
          create: taskCreateMock,
          findFirst: taskFindFirstMock,
        },
      }),
    );
  });

  it('creates a PHI-minimized reconfirmation task for a validated visit schedule', async () => {
    const response = await POST(
      createRequest({ target_date: '2026-04-09', plan_id: 'plan_b' }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'schedule_1',
      },
      select: {
        id: true,
        case_id: true,
        pharmacist_id: true,
        scheduled_date: true,
        schedule_status: true,
        confirmed_at: true,
      },
    });
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        task_type: 'staff_work_request_visit',
        title: '訪問予定の患者再確認',
        description: '予定の重なり解消に伴う患者再確認依頼です。',
        priority: 'high',
        assigned_to: 'pharmacist_1',
        dedupe_key: 'schedule-conflict-reconfirmation:schedule_1:2026-04-09',
        related_entity_type: 'case',
        related_entity_id: 'case_1',
        metadata: {
          source: 'schedule_conflict_resolution',
          plan_id: 'plan_b',
          confirmed_at_present: false,
        },
      }),
    });
    const taskInput = taskCreateMock.mock.calls[0]?.[0].data;
    expect(JSON.stringify(taskInput)).not.toContain('患者A');
    expect(JSON.stringify(taskInput)).not.toContain('住所');
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitSchedule: expect.any(Object),
        task: expect.any(Object),
      }),
      expect.objectContaining({ orgId: 'org_1' }),
      expect.objectContaining({
        action: 'visit_schedule_conflict_reconfirmation_task_created',
        targetType: 'VisitSchedule',
        targetId: 'schedule_1',
        changes: {
          task_id: 'task_1',
          task_type: 'staff_work_request_visit',
          result: 'created',
        },
      }),
    );
    const auditChanges = auditLogCreateMock.mock.calls[0]?.[2].changes;
    expect(JSON.stringify(auditChanges)).not.toContain('dedupe');
    expect(JSON.stringify(auditChanges)).not.toContain('metadata');
    expect(JSON.stringify(auditChanges)).not.toContain('scheduled_date');
    await expect(response.json()).resolves.toEqual({
      data: {
        task_id: 'task_1',
        status: 'created',
      },
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedule_conflict_reconfirmation', case_id: 'case_1' },
    });
  });

  it('returns the existing task when the reconfirmation task was already created', async () => {
    taskCreateMock.mockRejectedValueOnce({ code: 'P2002' });
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_existing',
      dedupe_key: 'schedule-conflict-reconfirmation:schedule_1:2026-04-09',
    });

    const response = await POST(createRequest({ target_date: '2026-04-09' }), routeContext());

    expect(response.status).toBe(200);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        dedupe_key: 'schedule-conflict-reconfirmation:schedule_1:2026-04-09',
      },
      select: { id: true },
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        task_id: 'task_existing',
        status: 'existing',
      },
    });
    expect(JSON.stringify(body)).not.toContain('dedupe');
    expect(JSON.stringify(body)).not.toContain('metadata');
    expect(JSON.stringify(body)).not.toContain('related_entity_id');
    expect(JSON.stringify(body)).not.toContain('org_id');
  });

  it('rejects schedules outside the requested target date', async () => {
    const response = await POST(createRequest({ target_date: '2026-04-10' }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '対象日の訪問予定ではありません',
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it('rejects locked visit schedule statuses before creating tasks', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      pharmacist_id: 'pharmacist_1',
      scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
      schedule_status: 'cancelled',
      confirmed_at: null,
    });

    const response = await POST(createRequest({ target_date: '2026-04-09' }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '完了済みまたは中止済みの訪問予定には再確認依頼を作成できません',
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });
});
