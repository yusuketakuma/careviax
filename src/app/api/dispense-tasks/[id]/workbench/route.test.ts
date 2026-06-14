import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
  workflowExceptionCreateMock,
  createAuditLogEntryMock,
  buildMedicationCycleAssignmentWhereMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authCtx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' as MemberRole },
  withOrgContextMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  buildMedicationCycleAssignmentWhereMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: MemberRole },
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { ...authCtx }, routeContext),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      findFirst: dispenseTaskFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildMedicationCycleAssignmentWhere: buildMedicationCycleAssignmentWhereMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createInterruptRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/workbench', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/dispense-tasks/[id]/workbench POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCtx.orgId = 'org_1';
    authCtx.userId = 'user_1';
    authCtx.role = 'pharmacist';
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
      cycle: { patient_id: 'patient_1' },
    });
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });
    createAuditLogEntryMock.mockResolvedValue(undefined);
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        workflowException: {
          create: workflowExceptionCreateMock,
        },
      }),
    );
  });

  it('returns 403 when the role lacks dispense permission', async () => {
    authCtx.role = 'clerk';

    const response = await POST(createInterruptRequest({ action: 'interrupt', reason: '在庫切れ' }), {
      params: Promise.resolve({ id: 'task_1' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '調剤の中断権限がありません',
    });
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('records an interrupt audit log entry on success', async () => {
    const response = await POST(
      createInterruptRequest({ action: 'interrupt', reason: '麻薬数量の再確認待ち' }),
      { params: Promise.resolve({ id: 'task_1' }) },
    );

    expect(response.status).toBe(201);
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          exception_type: 'dispense_interrupted',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'dispense_task_interrupted',
        targetType: 'DispenseTask',
        targetId: 'task_1',
        changes: expect.objectContaining({
          reason: '麻薬数量の再確認待ち',
          exception_id: 'exception_1',
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'dispense_tasks_update', task_id: 'task_1', interrupted: true },
    });
  });
});
