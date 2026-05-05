import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  notificationCreateMock,
  withOrgContextMock,
  broadcastStatusUpdateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
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

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import { PATCH } from './route';

describe('/api/medication-cycles/[id]/transition', () => {
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
      {
        json: async () => ({
          to: 'dispensing',
          version: 1,
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'cycle_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('transitions the cycle and creates a notification best-effort', async () => {
    const response = (await PATCH(
      {
        json: async () => ({
          to: 'dispensing',
          version: 2,
          note: '調剤開始',
        }),
      } as NextRequest,
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
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith(
      'org:org_1',
      expect.objectContaining({
        type: 'cycle_transition',
      }),
    );
  });

  it('does not transition an unassigned cycle', async () => {
    medicationCycleFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      {
        json: async () => ({
          to: 'dispensing',
          version: 2,
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'cycle_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });
});
