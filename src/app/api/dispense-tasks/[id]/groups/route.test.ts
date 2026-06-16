import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
  packagingGroupCreateMock,
  packagingGroupFindManyMock,
  packagingGroupUpdateManyMock,
  prescriptionLineFindManyMock,
  prescriptionLineUpdateManyMock,
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
  packagingGroupCreateMock: vi.fn(),
  packagingGroupFindManyMock: vi.fn(),
  packagingGroupUpdateManyMock: vi.fn(),
  prescriptionLineFindManyMock: vi.fn(),
  prescriptionLineUpdateManyMock: vi.fn(),
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
    packagingGroup: { findMany: packagingGroupFindManyMock },
    prescriptionLine: { findMany: prescriptionLineFindManyMock },
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

import { PATCH, POST } from './route';

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks/task_1/groups', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ id: 'task_1' }) };

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
      packagingGroup: {
        create: packagingGroupCreateMock,
        updateMany: packagingGroupUpdateManyMock,
      },
      prescriptionLine: {
        updateMany: prescriptionLineUpdateManyMock,
      },
    }),
  );
});

describe('/api/dispense-tasks/[id]/groups POST', () => {
  it('returns 403 when the role lacks dispense permission', async () => {
    authCtx.role = 'clerk';

    const response = await POST(
      createPostRequest({ group_key: 'morning', label: '朝食後', method: 'unit_dose' }),
      routeContext,
    );

    expect(response.status).toBe(403);
    expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const response = await POST(createPostRequest({ label: '朝食後' }), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the task is not found or not assigned', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({ group_key: 'morning', label: '朝食後', method: 'unit_dose' }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('creates a packaging group and records an audit log entry', async () => {
    packagingGroupCreateMock.mockResolvedValue({
      id: 'group_1',
      cycle_id: 'cycle_1',
      group_key: 'morning',
      label: '朝食後',
      method: 'unit_dose',
      slot: 'morning',
      sort_order: 1,
    });

    const response = await POST(
      createPostRequest({
        group_key: 'morning',
        label: '朝食後',
        method: 'unit_dose',
        slot: 'morning',
        sort_order: 1,
      }),
      routeContext,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'group_1' } });
    expect(packagingGroupCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          group_key: 'morning',
          label: '朝食後',
          method: 'unit_dose',
          slot: 'morning',
          sort_order: 1,
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'packaging_group.create',
        targetType: 'PackagingGroup',
        targetId: 'group_1',
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'dispense_tasks_update', task_id: 'task_1', packaging_group_id: 'group_1' },
    });
  });

  it('defaults sort_order to 0 when omitted', async () => {
    packagingGroupCreateMock.mockResolvedValue({
      id: 'group_1',
      cycle_id: 'cycle_1',
      group_key: 'morning',
      label: '朝食後',
      method: 'unit_dose',
      slot: null,
      sort_order: 0,
    });

    const response = await POST(
      createPostRequest({ group_key: 'morning', label: '朝食後', method: 'unit_dose' }),
      routeContext,
    );

    expect(response.status).toBe(201);
    expect(packagingGroupCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slot: null, sort_order: 0 }),
      }),
    );
  });
});

describe('/api/dispense-tasks/[id]/groups PATCH (groups update)', () => {
  it('updates groups and records audit entries with before/after', async () => {
    packagingGroupFindManyMock.mockResolvedValue([
      {
        id: 'group_1',
        label: '朝食後',
        method: 'unit_dose',
        slot: 'morning',
        sort_order: 1,
        version: 0,
      },
    ]);
    packagingGroupUpdateManyMock.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      createPatchRequest({ groups: [{ id: 'group_1', label: '朝・昼食後', sort_order: 2 }] }),
      routeContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { updated: [{ id: 'group_1' }] },
    });
    expect(packagingGroupUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'group_1', org_id: 'org_1', cycle_id: 'cycle_1' }),
        data: expect.objectContaining({
          label: '朝・昼食後',
          sort_order: 2,
          version: { increment: 1 },
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1' }),
      expect.objectContaining({
        action: 'packaging_group.update',
        targetType: 'PackagingGroup',
        targetId: 'group_1',
        changes: expect.objectContaining({
          before: expect.objectContaining({ label: '朝食後' }),
          after: expect.objectContaining({ label: '朝・昼食後', sort_order: 2 }),
        }),
      }),
    );
  });

  it('returns 404 when a target group is outside the cycle', async () => {
    packagingGroupFindManyMock.mockResolvedValue([]);

    const response = await PATCH(
      createPatchRequest({ groups: [{ id: 'group_x', label: 'X' }] }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 409 on optimistic-lock version conflict', async () => {
    packagingGroupFindManyMock.mockResolvedValue([
      {
        id: 'group_1',
        label: '朝食後',
        method: 'unit_dose',
        slot: 'morning',
        sort_order: 1,
        version: 3,
      },
    ]);
    packagingGroupUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await PATCH(
      createPatchRequest({ groups: [{ id: 'group_1', label: '朝・昼食後', version: 2 }] }),
      routeContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { packaging_group_id: 'group_1' },
    });
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});

describe('/api/dispense-tasks/[id]/groups PATCH (line assignment)', () => {
  it('assigns lines to a group and records audit entries', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      { id: 'line_1', packaging_group_id: null },
    ]);
    packagingGroupFindManyMock.mockResolvedValue([{ id: 'group_1' }]);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      createPatchRequest({
        assignments: [{ line_id: 'line_1', packaging_group_id: 'group_1' }],
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { assigned: [{ line_id: 'line_1' }] },
    });
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'line_1',
          org_id: 'org_1',
          intake: { cycle_id: 'cycle_1' },
        }),
        data: { packaging_group_id: 'group_1' },
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1' }),
      expect.objectContaining({
        action: 'packaging_group.assign',
        targetType: 'PrescriptionLine',
        targetId: 'line_1',
        changes: {
          before: { packaging_group_id: null },
          after: { packaging_group_id: 'group_1' },
        },
      }),
    );
  });

  it('allows clearing assignment with null group', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      { id: 'line_1', packaging_group_id: 'group_1' },
    ]);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      createPatchRequest({ assignments: [{ line_id: 'line_1', packaging_group_id: null }] }),
      routeContext,
    );

    expect(response.status).toBe(200);
    // null 解除時はグループ存在検証をスキップする
    expect(packagingGroupFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { packaging_group_id: null } }),
    );
  });

  it('returns 404 when a target line is outside the cycle', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([]);

    const response = await PATCH(
      createPatchRequest({ assignments: [{ line_id: 'line_x', packaging_group_id: 'group_1' }] }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the target group is outside the cycle', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      { id: 'line_1', packaging_group_id: null },
    ]);
    packagingGroupFindManyMock.mockResolvedValue([]);

    const response = await PATCH(
      createPatchRequest({ assignments: [{ line_id: 'line_1', packaging_group_id: 'group_1' }] }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body matches neither groups nor assignments', async () => {
    const response = await PATCH(createPatchRequest({ foo: 'bar' }), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
