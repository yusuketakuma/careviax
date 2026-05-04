import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientLabObservationFindFirstMock,
  patientLabObservationUpdateMock,
  withOrgContextMock,
  buildCareCaseAssignmentWhereMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientLabObservationFindFirstMock: vi.fn(),
  patientLabObservationUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  buildCareCaseAssignmentWhereMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientLabObservation: {
      findFirst: patientLabObservationFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  buildCareCaseAssignmentWhere: buildCareCaseAssignmentWhereMock,
}));

import { PATCH } from './route';

const defaultParams = () => Promise.resolve({ id: 'patient_1', labId: 'lab_1' });

describe('/api/patients/[id]/labs/[labId] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildCareCaseAssignmentWhereMock.mockReturnValue(null);
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientLabObservationFindFirstMock.mockResolvedValue({ id: 'lab_1' });
    const updatedRecord = { id: 'lab_1', value_numeric: 5.2 };
    patientLabObservationUpdateMock.mockResolvedValue(updatedRecord);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientLabObservation: { update: patientLabObservationUpdateMock },
      }),
    );
  });

  it('returns 200 with updated record on happy path', async () => {
    const response = await PATCH(
      { json: async () => ({ value_numeric: 5.2 }) } as NextRequest,
      { params: defaultParams() },
    );
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientLabObservationUpdateMock).toHaveBeenCalledWith({
      where: { id: 'lab_1' },
      data: { value_numeric: 5.2 },
    });
  });

  it('returns 404 when patientLabObservation.findFirst returns null', async () => {
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    const response = await PATCH(
      { json: async () => ({ value_numeric: 5.2 }) } as NextRequest,
      { params: defaultParams() },
    );
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 403 when requireAuthContext returns a forbidden response', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({ code: 'AUTH_FORBIDDEN', message: '検査値の更新権限がありません' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    const response = await PATCH(
      { json: async () => ({ value_numeric: 5.2 }) } as NextRequest,
      { params: defaultParams() },
    );
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expect(patientLabObservationFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns 400 when value_numeric is a string instead of a number', async () => {
    const response = await PATCH(
      { json: async () => ({ value_numeric: 'not-a-number' }) } as NextRequest,
      { params: defaultParams() },
    );
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });
});
