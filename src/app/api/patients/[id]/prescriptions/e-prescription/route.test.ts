import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  prismaMock,
  withOrgContextMock,
  txMock,
  listAccessiblePatientCaseIdsMock,
  createEPrescriptionAdapterMock,
  fetchPrescriptionMock,
} = vi.hoisted(() => {
  const fetchPrescriptionMock = vi.fn();
  const createEPrescriptionAdapterMock = vi.fn(() => ({
    fetchPrescription: fetchPrescriptionMock,
  }));

  return {
    requireAuthContextMock: vi.fn(),
    prismaMock: {
      patient: { findFirst: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      medicationCycle: { findFirst: vi.fn() },
      prescriptionIntake: { create: vi.fn() },
    },
    listAccessiblePatientCaseIdsMock: vi.fn(),
    createEPrescriptionAdapterMock,
    fetchPrescriptionMock,
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/patient-access', () => ({
  listAccessiblePatientCaseIds: listAccessiblePatientCaseIdsMock,
}));

vi.mock('@/server/adapters/e-prescription', () => {
  class EPrescriptionAdapterError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'EPrescriptionAdapterError';
      this.code = code;
    }
  }
  return {
    createEPrescriptionAdapter: createEPrescriptionAdapterMock,
    EPrescriptionAdapterError,
  };
});

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  applyPatientAssignmentWhere: (base: unknown) => base,
}));

import { POST } from './route';

function createRequest(body?: unknown) {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const DEFAULT_CTX = { orgId: 'org_1', userId: 'user_1', role: 'admin' };

describe('POST /api/patients/[id]/prescriptions/e-prescription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: DEFAULT_CTX,
      rateLimit: { allowed: true, remaining: 10, resetAt: Number.MAX_SAFE_INTEGER },
    });
    withOrgContextMock.mockImplementation(
      async (_orgId: string, callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
  });

  it('returns 422 with NO_ACCESSIBLE_CASE when listAccessiblePatientCaseIds returns empty array', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient_1', name: '山田太郎' });
    listAccessiblePatientCaseIdsMock.mockResolvedValue([]);

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'NO_ACCESSIBLE_CASE',
    });
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
  });

  it('returns 201 with the created intake on happy path when adapter resolves and cycle exists', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient_1', name: '山田太郎' });
    listAccessiblePatientCaseIdsMock.mockResolvedValue(['case_1', 'case_2']);
    fetchPrescriptionMock.mockResolvedValue({
      prescriptionId: 'rx_abc123',
      issuedAt: '2026-05-01T09:00:00Z',
      expiresAt: '2026-05-08T23:59:59Z',
      prescriberName: '鈴木医師',
      prescriberInstitution: '鈴木クリニック',
      refillRemainingCount: 0,
      items: [
        {
          lineNumber: 1,
          drugName: 'アムロジピン錠5mg',
          drugCode: '1149037F1024',
          dose: '5mg',
          frequency: '1日1回朝食後',
          days: 28,
          quantity: null,
          unit: '錠',
          notes: null,
        },
      ],
    });
    txMock.medicationCycle.findFirst.mockResolvedValue({ id: 'cycle_1' });
    txMock.prescriptionIntake.create.mockResolvedValue({
      id: 'intake_1',
      cycle_id: 'cycle_1',
      prescribed_date: new Date('2026-05-01T09:00:00Z'),
      source_type: 'e_prescription',
    });

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
      },
      e_prescription_id: 'rx_abc123',
    });
    expect(txMock.prescriptionIntake.create).toHaveBeenCalledOnce();
  });
});
