import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  medicationCycleFindFirstMock,
  checkDispenseAlertsMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  medicationCycleFindFirstMock: vi.fn(),
  checkDispenseAlertsMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
  },
}));

vi.mock('@/server/cds/checker', () => ({
  checkDispenseAlerts: checkDispenseAlertsMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/cds/check POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
    });
    checkDispenseAlertsMock.mockResolvedValue([
      {
        type: 'high_risk',
        severity: 'warning',
        message: 'ハイリスク薬です',
      },
    ]);
  });

  it('accepts requests with cycleId only and resolves patient scope from the cycle', async () => {
    const response = await POST(
      createRequest({
        cycleId: 'cycle_1',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1' },
      select: { id: true, patient_id: true },
    });
    expect(checkDispenseAlertsMock).toHaveBeenCalledWith('org_1', 'cycle_1', 'patient_1');
    await expect(response.json()).resolves.toMatchObject({
      alerts: [
        expect.objectContaining({
          type: 'high_risk',
        }),
      ],
    });
  });
});
