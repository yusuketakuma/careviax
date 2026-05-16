import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { patientLabObservationFindFirstMock, patientLabObservationUpdateMock } = vi.hoisted(() => ({
  patientLabObservationFindFirstMock: vi.fn(),
  patientLabObservationUpdateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: vi.fn(async () => ({
    ctx: {
      orgId: 'org_1',
      userId: 'pharmacist_1',
      role: 'pharmacist',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    },
  })),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      patientLabObservation: {
        update: patientLabObservationUpdateMock,
      },
    }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientLabObservation: {
      findFirst: patientLabObservationFindFirstMock,
    },
  },
}));

import { PATCH } from './route';

function createPatchRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
  } as NextRequest;
}

describe('/api/patients/[id]/labs/[labId] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientLabObservationFindFirstMock.mockResolvedValue({
      id: 'lab_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
    });
    patientLabObservationUpdateMock.mockResolvedValue({
      id: 'lab_1',
      note: '再確認済み',
    });
  });

  it('folds assignment-scope into the lab resource lookup before updating', async () => {
    const response = (await PATCH(createPatchRequest({ note: '再確認済み' }), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(patientLabObservationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'lab_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        patient: {
          cases: {
            some: {
              OR: [
                { primary_pharmacist_id: 'pharmacist_1' },
                { backup_pharmacist_id: 'pharmacist_1' },
                { visit_schedules: { some: { pharmacist_id: 'pharmacist_1' } } },
              ],
            },
          },
        },
      },
    });
    expect(patientLabObservationUpdateMock).toHaveBeenCalledWith({
      where: { id: 'lab_1' },
      data: { note: '再確認済み' },
    });
  });

  it('does not update when the lab is outside the assigned patient scope', async () => {
    patientLabObservationFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(createPatchRequest({ note: '再確認済み' }), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_foreign' }),
    }))!;

    expect(response.status).toBe(404);
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });
});
