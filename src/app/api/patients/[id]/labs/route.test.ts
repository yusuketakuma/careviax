import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  patientLabObservationCreateMock,
  patientLabObservationFindManyMock,
  visitRecordFindFirstMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  patientLabObservationCreateMock: vi.fn(),
  patientLabObservationFindManyMock: vi.fn(),
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
        create: patientLabObservationCreateMock,
      },
    }),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientLabObservation: {
      create: patientLabObservationCreateMock,
      findMany: patientLabObservationFindManyMock,
    },
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
  },
}));

import { POST } from './route';

const baseLabBody = {
  analyte_code: 'egfr',
  measured_at: '2026-05-16T00:00:00.000Z',
  value_numeric: 48,
  unit: 'mL/min/1.73m2',
};

const expectedVisitRecordAssignmentWhere = {
  schedule: {
    OR: [
      { pharmacist_id: 'pharmacist_1' },
      { case_: { primary_pharmacist_id: 'pharmacist_1' } },
      { case_: { backup_pharmacist_id: 'pharmacist_1' } },
    ],
  },
};

function createPostRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    url: 'http://localhost/api/patients/patient_1/labs',
  } as NextRequest;
}

describe('/api/patients/[id]/labs POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    visitRecordFindFirstMock.mockResolvedValue({ id: 'visit_1' });
    patientLabObservationCreateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'lab_1',
        ...args.data,
      }),
    );
  });

  it('validates same-org same-patient assigned visit-record provenance before creating', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_1',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(201);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        AND: [expectedVisitRecordAssignmentWhere],
      },
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        source_type: 'visit_record',
        source_visit_record_id: 'visit_1',
      }),
    });
  });

  it('rejects visit-record labs without a source visit record before creating', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record belongs to another patient', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_wrong_patient',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_wrong_patient',
        patient_id: 'patient_1',
      }),
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record belongs to another org', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_wrong_org',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_wrong_org',
        org_id: 'org_1',
      }),
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('denies before write when the source visit record is not assigned to the pharmacist', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'visit_record',
        source_visit_record_id: 'visit_unassigned',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'visit_unassigned',
        AND: [expectedVisitRecordAssignmentWhere],
      }),
      select: { id: true },
    });
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('clears inconsistent visit record IDs for non-visit lab sources', async () => {
    const response = (await POST(
      createPostRequest({
        ...baseLabBody,
        source_type: 'manual',
        source_visit_record_id: 'visit_stale',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    ))!;

    expect(response.status).toBe(201);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_type: 'manual',
        source_visit_record_id: null,
      }),
    });
  });
});
