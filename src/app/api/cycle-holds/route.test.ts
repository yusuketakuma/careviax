import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        });
    },
  ),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { POST as rawPOST, PATCH as rawPATCH } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);
const PATCH = (req: NextRequest) => rawPATCH(req, emptyRouteContext);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cycle-holds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/cycle-holds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"cycle_id":',
  } satisfies NextRequestInit);
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cycle-holds', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

describe('/api/cycle-holds POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-object payloads before transaction or notification side effects', async () => {
    const response = await POST(createPostRequest([]));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads', async () => {
    const response = await POST(createMalformedJsonRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown hold reason', async () => {
    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        phase: 'dispense',
        scope: 'cycle',
        reason: 'not_a_real_reason',
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('requires line_id when scope is line', async () => {
    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        phase: 'dispense',
        scope: 'line',
        reason: 'stock_shortage',
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { details?: { line_id?: string[] } };
    expect(payload.details?.line_id).toBeDefined();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the cycle is not found', async () => {
    const cycleFindFirstMock = vi.fn().mockResolvedValue(null);
    const cycleHoldCreateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: { findFirst: cycleFindFirstMock },
        cycleHold: { create: cycleHoldCreateMock },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'missing_cycle',
        phase: 'dispense',
        scope: 'cycle',
        reason: 'doctor_confirm_wait',
      }),
    );

    expect(response.status).toBe(404);
    expect(cycleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'missing_cycle', org_id: 'org_1' },
      }),
    );
    expect(cycleHoldCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('creates a structured hold, writes an audit log, and notifies workflow', async () => {
    const cycleHoldCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'hold_1', cycle_id: 'cycle_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', patient_id: 'patient_1' }),
        },
        cycleHold: { create: cycleHoldCreateMock },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        phase: 'dispense',
        scope: 'cycle',
        reason: 'prescription_change_wait',
        reason_detail: '用量変更の疑義照会中',
        due_at: '2026-06-20T09:00:00.000Z',
        assigned_to: 'pharmacist_2',
        note: '医師回答待ち',
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'hold_1', cycle_id: 'cycle_1' },
    });
    expect(cycleHoldCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        phase: 'dispense',
        scope: 'cycle',
        reason: 'prescription_change_wait',
        reason_detail: '用量変更の疑義照会中',
        assigned_to: 'pharmacist_2',
        note: '医師回答待ち',
        due_at: new Date('2026-06-20T09:00:00.000Z'),
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'cycle_hold.create',
        targetType: 'CycleHold',
        targetId: 'hold_1',
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'cycle_transition',
        payload: expect.objectContaining({ source: 'cycle_holds_create', hold_id: 'hold_1' }),
      }),
    );
  });
});

describe('/api/cycle-holds PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires an id', async () => {
    const response = await PATCH(createPatchRequest({ note: 'done' }));

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the hold does not exist', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        cycleHold: {
          findFirst: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn(),
        },
      }),
    );

    const response = await PATCH(createPatchRequest({ id: 'missing_hold' }));

    expect(response.status).toBe(404);
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the hold is already resolved', async () => {
    const updateManyMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        cycleHold: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'hold_1',
            cycle_id: 'cycle_1',
            resolved_at: new Date('2026-06-10T00:00:00.000Z'),
            note: null,
          }),
          updateMany: updateManyMock,
        },
      }),
    );

    const response = await PATCH(createPatchRequest({ id: 'hold_1' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent resolve already won', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        cycleHold: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'hold_1',
            cycle_id: 'cycle_1',
            resolved_at: null,
            note: null,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    const response = await PATCH(createPatchRequest({ id: 'hold_1' }));

    expect(response.status).toBe(409);
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('resolves a hold append-only, audits it, and notifies workflow', async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        cycleHold: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'hold_1',
            cycle_id: 'cycle_1',
            resolved_at: null,
            note: '医師回答待ち',
          }),
          updateMany: updateManyMock,
        },
      }),
    );

    const response = await PATCH(
      createPatchRequest({ id: 'hold_1', note: '回答受領、再開' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'hold_1', resolved: true },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'hold_1', org_id: 'org_1', resolved_at: null },
      data: expect.objectContaining({
        resolved_by: 'user_1',
        note: '医師回答待ち\n回答受領、再開',
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'cycle_hold.resolve',
        targetType: 'CycleHold',
        targetId: 'hold_1',
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ source: 'cycle_holds_resolve', hold_id: 'hold_1' }),
      }),
    );
  });
});
