import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { withAuthMock, medicationCycleFindFirstMock, checkDispenseAlertsMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler(
          Object.assign(req, {
            orgId: 'org_1',
            userId: 'user_1',
          }),
        );
    },
  ),
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
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before loading the cycle', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(checkDispenseAlertsMock).not.toHaveBeenCalled();
  });
});
