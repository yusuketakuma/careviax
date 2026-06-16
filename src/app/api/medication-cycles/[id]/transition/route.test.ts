import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  notificationUpsertMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  notificationUpsertMock: vi.fn(),
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
          upsert: notificationUpsertMock,
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
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
    expect(notificationUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_user_id_dedupe_key: {
          org_id: 'org_1',
          user_id: 'user_1',
          dedupe_key: 'cycle-transition:cycle_1:ready_to_dispense:dispensing:2',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        user_id: 'user_1',
        event_type: 'status_changed',
        type: 'system',
        title: 'ステータス変更',
        message: '調剤開始',
        link: '/workflow',
        metadata: { cycle_id: 'cycle_1', from: 'ready_to_dispense', to: 'dispensing' },
        dedupe_key: 'cycle-transition:cycle_1:ready_to_dispense:dispensing:2',
      }),
      update: expect.objectContaining({
        event_type: 'status_changed',
        type: 'system',
        title: 'ステータス変更',
        message: '調剤開始',
        link: '/workflow',
        metadata: { cycle_id: 'cycle_1', from: 'ready_to_dispense', to: 'dispensing' },
        is_read: false,
        read_at: null,
      }),
    });
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

  it('keeps transition success when status notification upsert fails', async () => {
    notificationUpsertMock.mockRejectedValueOnce(new Error('notification write failed'));

    const response = (await PATCH(
      createPatchRequest({
        to: 'dispensing',
        version: 2,
      }),
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationCycleUpdateManyMock).toHaveBeenCalled();
    expect(notificationUpsertMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'medication_cycles_transition' },
    });
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
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
    expect(notificationUpsertMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
