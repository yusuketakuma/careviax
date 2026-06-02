import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
    constructor(message: string, code: string) {
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

import { EPrescriptionAdapterError } from '@/server/adapters/e-prescription';
import { POST } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/patients/patient_1/prescriptions/e-prescription', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/prescriptions/e-prescription', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{"prescription_id":',
  });
}

const DEFAULT_CTX = { orgId: 'org_1', userId: 'user_1', role: 'admin' };

function mockAccessiblePatient() {
  prismaMock.patient.findFirst.mockResolvedValue({ id: 'patient_1', name: '山田太郎' });
  listAccessiblePatientCaseIdsMock.mockResolvedValue(['case_1', 'case_2']);
}

function mockEPrescription() {
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
}

function expectNoIntakeSideEffects() {
  expect(withOrgContextMock).not.toHaveBeenCalled();
  expect(txMock.medicationCycle.findFirst).not.toHaveBeenCalled();
  expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
}

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

  it('rejects non-object request payloads before patient lookup or adapter calls', async () => {
    const response = await POST(createRequest([]), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(listAccessiblePatientCaseIdsMock).not.toHaveBeenCalled();
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeSideEffects();
  });

  it('rejects malformed JSON request payloads before patient lookup or adapter calls', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(listAccessiblePatientCaseIdsMock).not.toHaveBeenCalled();
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeSideEffects();
  });

  it('rejects blank patient ids before parsing request payloads or adapter calls', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(prismaMock.patient.findFirst).not.toHaveBeenCalled();
    expect(listAccessiblePatientCaseIdsMock).not.toHaveBeenCalled();
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeSideEffects();
  });

  it.each([
    ['missing', {}],
    ['empty', { prescription_id: '' }],
  ])(
    'returns 400 and skips adapter/transaction when prescription_id is %s',
    async (_label, body) => {
      mockAccessiblePatient();

      const response = await POST(createRequest(body), {
        params: Promise.resolve({ id: 'patient_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
      expect(fetchPrescriptionMock).not.toHaveBeenCalled();
      expectNoIntakeSideEffects();
    },
  );

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
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeSideEffects();
  });

  it('returns 501 and skips transaction/create when the adapter is disabled', async () => {
    mockAccessiblePatient();
    fetchPrescriptionMock.mockRejectedValue(
      new EPrescriptionAdapterError(
        '電子処方箋連携はまだ有効化されていません',
        'NOT_IMPLEMENTED',
        false,
      ),
    );

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_NOT_ENABLED',
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_abc123');
    expectNoIntakeSideEffects();
  });

  it('returns 502 and skips transaction/create when the adapter reports an upstream failure', async () => {
    mockAccessiblePatient();
    fetchPrescriptionMock.mockRejectedValue(
      new EPrescriptionAdapterError('電子処方箋取得に失敗しました', 'UPSTREAM_FAILURE', true, 503),
    );

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_UPSTREAM_FAILURE',
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_abc123');
    expectNoIntakeSideEffects();
  });

  it('returns 404 and skips transaction/create when the adapter cannot find the prescription', async () => {
    mockAccessiblePatient();
    fetchPrescriptionMock.mockResolvedValue(null);

    const response = await POST(createRequest({ prescription_id: 'rx_missing' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_missing');
    expectNoIntakeSideEffects();
  });

  it('returns 422 and skips intake create when no active medication cycle exists', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'NO_ACTIVE_CYCLE',
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_abc123');
    expect(withOrgContextMock).toHaveBeenCalledOnce();
    expect(txMock.medicationCycle.findFirst).toHaveBeenCalledOnce();
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
  });

  it('returns 201 with the created intake on happy path when adapter resolves and cycle exists', async () => {
    mockAccessiblePatient();
    mockEPrescription();
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
