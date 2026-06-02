import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  notificationCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { PATCH } from './route';

describe('/api/medication-cycles/[id]/transition', () => {
  const createPatchRequest = (body: unknown) =>
    new NextRequest('http://localhost/api/medication-cycles/cycle_1/transition', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });

  const createMalformedJsonPatchRequest = () =>
    new NextRequest('http://localhost/api/medication-cycles/cycle_1/transition', {
      method: 'PATCH',
      body: '{"to":',
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'ready_to_dispense',
      version: 2,
      patient_id: 'patient_1',
      case_id: 'case_1',
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        notification: {
          create: notificationCreateMock,
        },
      }),
    );
  });

  it('rejects transition requests with a stale version', async () => {
    const response = (await PATCH(
      createPatchRequest({
        to: 'dispensing',
        version: 1,
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank cycle ids before parsing or loading the cycle', async () => {
    const response = (await PATCH(
      createPatchRequest({
        to: 'dispensing',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '服薬サイクルIDが不正です',
    });
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object transition payloads before loading the cycle', async () => {
    const response = (await PATCH(createPatchRequest(['dispensing']), {
      params: Promise.resolve({ id: 'cycle_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON transition payloads before loading the cycle', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'cycle_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('transitions the cycle and creates a notification best-effort', async () => {
    const response = (await PATCH(
      createPatchRequest({
        to: 'dispensing',
        version: 2,
        note: '調剤開始',
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 2 },
      data: expect.objectContaining({
        overall_status: 'dispensing',
        version: { increment: 1 },
      }),
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        from_status: 'ready_to_dispense',
        to_status: 'dispensing',
        actor_id: 'user_1',
        note: '調剤開始',
      }),
    });
    expect(notificationCreateMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'medication_cycles_transition' },
    });
    const notifyPayload = notifyWorkflowMutationMock.mock.calls[0]?.[0]?.payload;
    expect(notifyPayload).not.toHaveProperty('cycleId');
    expect(notifyPayload).not.toHaveProperty('from');
    expect(notifyPayload).not.toHaveProperty('to');
  });

  it('rejects dispense audit transitions when a trainee lacks audit permission', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist_trainee',
      },
    });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'audit_pending',
      version: 2,
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        to: 'audited',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects set audit transitions when a trainee lacks set audit permission', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist_trainee',
      },
    });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'setting',
      version: 2,
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        to: 'set_audited',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows a report role to transition completed visits to reported', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'clerk',
      },
    });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'visit_completed',
      version: 2,
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        to: 'reported',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 2 },
      data: expect.objectContaining({
        overall_status: 'reported',
        version: { increment: 1 },
      }),
    });
  });

  it('does not transition an unassigned cycle', async () => {
    medicationCycleFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        to: 'dispensing',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'cycle_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
