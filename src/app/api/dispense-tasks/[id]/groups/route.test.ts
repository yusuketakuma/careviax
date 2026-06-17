import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma, type MemberRole } from '@prisma/client';

const {
  authCtx,
  withOrgContextMock,
  dispenseTaskFindFirstMock,
  packagingGroupCreateMock,
  packagingGroupRootFindFirstMock,
  packagingGroupFindFirstMock,
  packagingGroupFindManyMock,
  packagingGroupUpdateManyMock,
  prescriptionLineFindManyMock,
  prescriptionLineFindFirstMock,
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
  packagingGroupRootFindFirstMock: vi.fn(),
  packagingGroupFindFirstMock: vi.fn(),
  packagingGroupFindManyMock: vi.fn(),
  packagingGroupUpdateManyMock: vi.fn(),
  prescriptionLineFindManyMock: vi.fn(),
  prescriptionLineFindFirstMock: vi.fn(),
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
    packagingGroup: {
      findFirst: packagingGroupRootFindFirstMock,
      findMany: packagingGroupFindManyMock,
    },
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

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authCtx.orgId = 'org_1';
  authCtx.userId = 'user_1';
  authCtx.role = 'pharmacist';
  buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
  dispenseTaskFindFirstMock.mockResolvedValue({ cycle_id: 'cycle_1' });
  packagingGroupRootFindFirstMock.mockResolvedValue(null);
  packagingGroupFindFirstMock.mockResolvedValue(null);
  createAuditLogEntryMock.mockResolvedValue(undefined);
  notifyWorkflowMutationMock.mockResolvedValue(undefined);
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      packagingGroup: {
        findFirst: packagingGroupFindFirstMock,
        create: packagingGroupCreateMock,
        updateMany: packagingGroupUpdateManyMock,
      },
      prescriptionLine: {
        findFirst: prescriptionLineFindFirstMock,
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
      payload: {
        source: 'dispense_tasks_update',
        task_id: 'task_1',
        packaging_group_id: 'group_1',
      },
    });
  });

  it('returns an existing group for the same group_key without duplicate create side effects', async () => {
    packagingGroupFindFirstMock.mockResolvedValue({
      id: 'group_existing',
      cycle_id: 'cycle_1',
      group_key: 'morning',
      label: '朝食後',
      method: 'unit_dose',
      slot: 'morning',
      sort_order: 1,
      version: 3,
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'group_existing', version: 3, created: false },
    });
    expect(packagingGroupCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the same group_key already exists with different create fields', async () => {
    packagingGroupFindFirstMock.mockResolvedValue({
      id: 'group_existing',
      cycle_id: 'cycle_1',
      group_key: 'morning',
      label: '朝食後',
      method: 'unit_dose',
      slot: 'morning',
      sort_order: 1,
      version: 3,
    });

    const response = await POST(
      createPostRequest({
        group_key: 'morning',
        label: '夕食後',
        method: 'unit_dose',
        slot: 'evening',
        sort_order: 2,
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        packaging_group_id: 'group_existing',
        group_key: 'morning',
      },
    });
    expect(packagingGroupCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('recovers a duplicate group create race by returning the winning existing group', async () => {
    packagingGroupFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'group_winner',
      cycle_id: 'cycle_1',
      group_key: 'morning',
      label: '朝食後',
      method: 'unit_dose',
      slot: 'morning',
      sort_order: 1,
      version: 0,
    });
    packagingGroupCreateMock.mockRejectedValue(createUniqueConstraintError());

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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'group_winner', version: 0, created: false },
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(packagingGroupRootFindFirstMock).not.toHaveBeenCalled();
    expect(packagingGroupCreateMock).toHaveBeenCalledTimes(1);
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
      createPatchRequest({
        groups: [{ id: 'group_1', label: '朝・昼食後', sort_order: 2, version: 0 }],
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { updated: [{ id: 'group_1', version: 1 }] },
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
      createPatchRequest({ groups: [{ id: 'group_x', label: 'X', version: 0 }] }),
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

  it('returns 400 when group update omits version', async () => {
    const response = await PATCH(
      createPatchRequest({ groups: [{ id: 'group_1', label: '朝・昼食後' }] }),
      routeContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});

describe('/api/dispense-tasks/[id]/groups PATCH (line assignment)', () => {
  it('assigns lines to a group and records audit entries', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([{ id: 'line_1', packaging_group_id: null }]);
    packagingGroupFindManyMock.mockResolvedValue([{ id: 'group_1' }]);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      createPatchRequest({
        assignments: [
          {
            line_id: 'line_1',
            packaging_group_id: 'group_1',
            expected_packaging_group_id: null,
          },
        ],
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
          packaging_group_id: null,
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
      createPatchRequest({
        assignments: [
          {
            line_id: 'line_1',
            packaging_group_id: null,
            expected_packaging_group_id: 'group_1',
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    // null 解除時はグループ存在検証をスキップする
    expect(packagingGroupFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ packaging_group_id: 'group_1' }),
        data: { packaging_group_id: null },
      }),
    );
  });

  it('returns 404 when a target line is outside the cycle', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([]);

    const response = await PATCH(
      createPatchRequest({
        assignments: [
          {
            line_id: 'line_x',
            packaging_group_id: 'group_1',
            expected_packaging_group_id: null,
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the target group is outside the cycle', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([{ id: 'line_1', packaging_group_id: null }]);
    packagingGroupFindManyMock.mockResolvedValue([]);

    const response = await PATCH(
      createPatchRequest({
        assignments: [
          {
            line_id: 'line_1',
            packaging_group_id: 'group_1',
            expected_packaging_group_id: null,
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the current line assignment no longer matches the expected group', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      { id: 'line_1', packaging_group_id: 'group_1' },
    ]);
    packagingGroupFindManyMock.mockResolvedValue([{ id: 'group_2' }]);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 0 });
    prescriptionLineFindFirstMock.mockResolvedValue({ packaging_group_id: 'group_3' });

    const response = await PATCH(
      createPatchRequest({
        assignments: [
          {
            line_id: 'line_1',
            packaging_group_id: 'group_2',
            expected_packaging_group_id: 'group_1',
          },
        ],
      }),
      routeContext,
    );

    expect(response.status).toBe(409);
    const payloadText = await response.clone().text();
    expect(payloadText).not.toContain('アムロジピン');
    expect(payloadText).not.toContain('計画 花子');
    expect(payloadText).not.toContain('朝食後');
    expect(payloadText).not.toContain('5mg');
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: {
        line_id: 'line_1',
        expected_packaging_group_id: 'group_1',
        current_packaging_group_id: 'group_3',
      },
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body matches neither groups nor assignments', async () => {
    const response = await PATCH(createPatchRequest({ foo: 'bar' }), routeContext);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 400 when assignment omits expected_packaging_group_id', async () => {
    const response = await PATCH(
      createPatchRequest({
        assignments: [{ line_id: 'line_1', packaging_group_id: 'group_1' }],
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });
});
