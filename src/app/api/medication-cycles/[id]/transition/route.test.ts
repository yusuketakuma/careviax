import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateMock,
  notificationCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    medicationCycleUpdateMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 3,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          update: medicationCycleUpdateMock,
        },
        notification: {
          create: notificationCreateMock,
        },
      }),
    );
  });

  it('rejects transition requests with a stale version', async () => {
    const response = (await PATCH({
      json: async () => ({
        to: 'dispensing',
        version: 1,
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'cycle_1' }),
    }))!;

    expect(response.status).toBe(409);
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
  });

  it('transitions the cycle and creates a notification best-effort', async () => {
    const response = (await PATCH({
      json: async () => ({
        to: 'dispensing',
        version: 2,
        note: '調剤開始',
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'cycle_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 2 },
      data: {
        overall_status: 'dispensing',
        version: { increment: 1 },
      },
    });
    expect(notificationCreateMock).toHaveBeenCalled();
  });
});
