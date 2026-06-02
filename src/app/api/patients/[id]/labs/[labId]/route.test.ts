import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  patientLabObservationFindFirstMock,
  patientLabObservationUpdateMock,
  visitRecordFindFirstMock,
} = vi.hoisted(() => ({
  patientLabObservationFindFirstMock: vi.fn(),
  patientLabObservationUpdateMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
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
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

import { PATCH } from './route';

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/labs/lab_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/labs/lab_1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"note":',
  });
}

const expectedVisitRecordAssignmentWhere = {
  schedule: {
    OR: [
      { pharmacist_id: 'pharmacist_1' },
      { case_: { primary_pharmacist_id: 'pharmacist_1' } },
      { case_: { backup_pharmacist_id: 'pharmacist_1' } },
    ],
  },
};

describe('/api/patients/[id]/labs/[labId] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientLabObservationFindFirstMock.mockResolvedValue({
      id: 'lab_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      source_type: 'manual',
      source_visit_record_id: null,
    });
    patientLabObservationUpdateMock.mockResolvedValue({
      id: 'lab_1',
      note: '再確認済み',
    });
    visitRecordFindFirstMock.mockResolvedValue({ id: 'visit_1' });
  });

  it('rejects non-object patch payloads before loading the lab observation', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientLabObservationFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing patch payloads or loading lab observations', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: '   ', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientLabObservationFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank lab ids before parsing patch payloads or loading lab observations', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'patient_1', labId: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '検査値IDが不正です',
    });
    expect(patientLabObservationFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the lab observation', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientLabObservationFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
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

  it('does not update a visit-record sourced lab when the source visit is inaccessible', async () => {
    patientLabObservationFindFirstMock.mockResolvedValue({
      id: 'lab_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      source_type: 'visit_record',
      source_visit_record_id: 'visit_unassigned',
    });
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(createPatchRequest({ note: '再確認済み' }), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_unassigned',
        org_id: 'org_1',
        patient_id: 'patient_1',
        AND: [expectedVisitRecordAssignmentWhere],
      },
      select: { id: true },
    });
    expect(patientLabObservationUpdateMock).not.toHaveBeenCalled();
  });

  it('clears inconsistent visit record IDs from non-visit sourced labs during updates', async () => {
    patientLabObservationFindFirstMock.mockResolvedValue({
      id: 'lab_1',
      org_id: 'org_1',
      patient_id: 'patient_1',
      source_type: 'manual',
      source_visit_record_id: 'visit_stale',
    });

    const response = (await PATCH(createPatchRequest({ note: '再確認済み' }), {
      params: Promise.resolve({ id: 'patient_1', labId: 'lab_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationUpdateMock).toHaveBeenCalledWith({
      where: { id: 'lab_1' },
      data: { note: '再確認済み', source_visit_record_id: null },
    });
  });
});
