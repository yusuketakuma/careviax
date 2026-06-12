import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthContextMock, medicationCycleFindFirstMock, checkDispenseAlertsMock } = vi.hoisted(
  () => ({
    withAuthContextMock: vi.fn((handler) => {
      return (req: NextRequest, routeContext = { params: Promise.resolve({}) }) =>
        handler(
          req,
          {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
            ipAddress: '127.0.0.1',
            userAgent: 'vitest',
          },
          routeContext,
        );
    }),
    medicationCycleFindFirstMock: vi.fn(),
    checkDispenseAlertsMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
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

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cds/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/cds/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
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
      }),
      emptyRouteContext,
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

  it('rejects non-object CDS payloads before loading the cycle', async () => {
    const response = await POST(createRequest([]), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the cycle', async () => {
    const response = await POST(createMalformedJsonRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });
});
