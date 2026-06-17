import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
  prescriptionLineRootFindManyMock,
  prescriptionLineUpdateManyMock,
  prescriptionLineFindFirstMock,
  createAuditLogEntryMock,
  buildMedicationCycleAssignmentWhereMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authCtx: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist' as MemberRole,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  },
  withOrgContextMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  prescriptionLineRootFindManyMock: vi.fn(),
  prescriptionLineUpdateManyMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  buildMedicationCycleAssignmentWhereMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: typeof authCtx,
        routeContext: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) =>
    (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { ...authCtx }, routeContext),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: { findFirst: dispenseTaskFindFirstMock },
    prescriptionLine: { findMany: prescriptionLineRootFindManyMock },
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

import { PATCH } from './route';

const routeContext = { params: Promise.resolve({ id: 'task_1' }) };

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/lines', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.orgId = 'org_1';
  authCtx.userId = 'user_1';
  authCtx.role = 'pharmacist';
  buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
  dispenseTaskFindFirstMock.mockResolvedValue({ cycle_id: 'cycle_1' });
  createAuditLogEntryMock.mockResolvedValue(undefined);
  notifyWorkflowMutationMock.mockResolvedValue(undefined);
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      prescriptionLine: {
        updateMany: prescriptionLineUpdateManyMock,
        findFirst: prescriptionLineFindFirstMock,
      },
    }),
  );
});

describe('/api/dispense-tasks/[id]/lines PATCH', () => {
  it('returns 403 when the role lacks dispense permission', async () => {
    authCtx.role = 'clerk';

    const response = await PATCH(
      createPatchRequest({
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            days: 14,
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(403);
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('updates multiple line periods atomically and records per-line audit evidence', async () => {
    prescriptionLineRootFindManyMock.mockResolvedValue([
      {
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-17T00:00:00.000Z'),
        end_date: new Date('2026-06-23T00:00:00.000Z'),
        days: 7,
        updated_at: new Date('2026-06-18T00:00:00.000Z'),
      },
      {
        id: 'line_2',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-17T00:00:00.000Z'),
        end_date: new Date('2026-06-23T00:00:00.000Z'),
        days: 7,
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
      },
    ]);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce({
        id: 'line_1',
        start_date: new Date('2026-06-20T00:00:00.000Z'),
        end_date: new Date('2026-07-03T00:00:00.000Z'),
        days: 14,
        updated_at: new Date('2026-06-18T01:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'line_2',
        start_date: new Date('2026-06-20T00:00:00.000Z'),
        end_date: new Date('2026-07-03T00:00:00.000Z'),
        days: 14,
        updated_at: new Date('2026-06-18T01:01:00.000Z'),
      });

    const response = await PATCH(
      createPatchRequest({
        client_action_id: 'group-period:test',
        packaging_group_id: 'packaging_group_1',
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
            days: 14,
          },
          {
            line_id: 'line_2',
            expected_updated_at: '2026-06-18T00:01:00.000Z',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
            days: 14,
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        updated: [
          {
            id: 'line_1',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
            days: 14,
            updated_at: '2026-06-18T01:00:00.000Z',
          },
          {
            id: 'line_2',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
            days: 14,
            updated_at: '2026-06-18T01:01:00.000Z',
          },
        ],
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(createAuditLogEntryMock).toHaveBeenCalledTimes(2);
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'prescription_line.batch_update',
        targetType: 'PrescriptionLine',
        targetId: 'line_1',
        changes: expect.objectContaining({
          task_id: 'task_1',
          cycle_id: 'cycle_1',
          client_action_id: 'group-period:test',
          packaging_group_id: 'packaging_group_1',
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'dispense_tasks_update', task_id: 'task_1' },
    });
  });

  it('returns 409 before writes when any line has a stale expected_updated_at', async () => {
    prescriptionLineRootFindManyMock.mockResolvedValue([
      {
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: null,
        end_date: null,
        days: 7,
        updated_at: new Date('2026-06-18T00:05:00.000Z'),
      },
    ]);

    const response = await PATCH(
      createPatchRequest({
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            start_date: '2026-06-20',
            end_date: '2026-07-03',
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).toContain('line_1');
    expect(bodyText).toContain('2026-06-18T00:05:00.000Z');
    expect(bodyText).not.toContain('山田');
    expect(bodyText).not.toContain('アムロジピン');
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 400 and performs no writes when the computed period would be invalid', async () => {
    prescriptionLineRootFindManyMock.mockResolvedValue([
      {
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-17T00:00:00.000Z'),
        end_date: new Date('2026-06-23T00:00:00.000Z'),
        days: 7,
        updated_at: new Date('2026-06-18T00:00:00.000Z'),
      },
    ]);

    const response = await PATCH(
      createPatchRequest({
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            start_date: '2026-07-01',
            end_date: '2026-06-30',
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { end_date: ['終了日は開始日以降にしてください'] },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate line ids before opening the transaction', async () => {
    const response = await PATCH(
      createPatchRequest({
        lines: [
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            days: 14,
          },
          {
            line_id: 'line_1',
            expected_updated_at: '2026-06-18T00:00:00.000Z',
            days: 14,
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(prescriptionLineRootFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
