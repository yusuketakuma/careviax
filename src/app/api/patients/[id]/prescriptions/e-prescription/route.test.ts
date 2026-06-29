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
  createPrescriptionIntakeMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  const fetchPrescriptionMock = vi.fn();
  const createEPrescriptionAdapterMock = vi.fn(() => ({
    fetchPrescription: fetchPrescriptionMock,
  }));
  const createPrescriptionIntakeMock = vi.fn();

  return {
    requireAuthContextMock: vi.fn(),
    prismaMock: {
      patient: { findFirst: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      medicationCycle: { findMany: vi.fn() },
      prescriptionIntake: { create: vi.fn(), findFirst: vi.fn() },
    },
    listAccessiblePatientCaseIdsMock: vi.fn(),
    createEPrescriptionAdapterMock,
    fetchPrescriptionMock,
    createPrescriptionIntakeMock,
    loggerErrorMock: vi.fn(),
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
    retriable: boolean;
    status?: number;
    causeDetail?: unknown;
    constructor(
      message: string,
      code: string,
      retriable = false,
      status?: number,
      causeDetail?: unknown,
    ) {
      super(message);
      this.name = 'EPrescriptionAdapterError';
      this.code = code;
      this.retriable = retriable;
      this.status = status;
      this.causeDetail = causeDetail;
    }
  }
  return {
    createEPrescriptionAdapter: createEPrescriptionAdapterMock,
    EPrescriptionAdapterError,
  };
});

vi.mock('@/server/services/prescription-intake-service', () => ({
  createPrescriptionIntake: createPrescriptionIntakeMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

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

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
    patientExternalId: 'patient_1',
    patientName: '山田太郎',
    prescriberName: '鈴木医師',
    prescriberInstitution: '鈴木クリニック',
    status: 'issued',
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
  expect(txMock.medicationCycle.findMany).not.toHaveBeenCalled();
  expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
  expect(txMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
  expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
}

function expectNoIntakeWrites() {
  expect(txMock.medicationCycle.findMany).not.toHaveBeenCalled();
  expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
  expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
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
    txMock.prescriptionIntake.findFirst.mockResolvedValue(null);
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

  it('rejects archived patients before adapter calls or intake writes', async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(listAccessiblePatientCaseIdsMock).not.toHaveBeenCalled();
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
    expectNoIntakeWrites();
  });

  it('returns 503 and skips fetch/transaction/create when adapter configuration is invalid', async () => {
    mockAccessiblePatient();
    createEPrescriptionAdapterMock.mockImplementationOnce(() => {
      throw new EPrescriptionAdapterError(
        '電子処方箋 API の baseUrl が設定されていません',
        'INVALID_CONFIGURATION',
        false,
      );
    });

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_CONFIGURATION_ERROR',
      message: '電子処方箋連携の設定が不完全です。管理者に確認してください。',
      details: { retriable: false },
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeWrites();
  });

  it('returns a distinct upstream auth error and skips transaction/create', async () => {
    mockAccessiblePatient();
    fetchPrescriptionMock.mockRejectedValue(
      new EPrescriptionAdapterError(
        '電子処方箋 API の認証に失敗しました',
        'UNAUTHORIZED',
        false,
        401,
      ),
    );

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_UPSTREAM_UNAUTHORIZED',
      details: { retriable: false, upstream_status: 401 },
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_abc123');
    expectNoIntakeWrites();
  });

  it('returns 503 and skips transaction/create when the adapter reports a retriable upstream failure', async () => {
    mockAccessiblePatient();
    fetchPrescriptionMock.mockRejectedValue(
      new EPrescriptionAdapterError('電子処方箋取得に失敗しました', 'UPSTREAM_FAILURE', true, 503),
    );

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_UPSTREAM_FAILURE',
      details: { retriable: true, upstream_status: 503 },
    });
    expect(createEPrescriptionAdapterMock).toHaveBeenCalledOnce();
    expect(fetchPrescriptionMock).toHaveBeenCalledWith('rx_abc123');
    expectNoIntakeWrites();
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
    expectNoIntakeWrites();
  });

  it('returns 422 and skips intake create when no active medication cycle exists', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([]);

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
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(txMock.prescriptionIntake.findFirst).toHaveBeenCalledOnce();
    expect(txMock.medicationCycle.findMany).toHaveBeenCalledOnce();
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
  });

  it('rejects electronic prescriptions for a different patient before transaction writes', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    fetchPrescriptionMock.mockResolvedValueOnce({
      prescriptionId: 'rx_other_patient',
      issuedAt: '2026-05-01T09:00:00Z',
      expiresAt: '2026-05-08T23:59:59Z',
      patientExternalId: 'patient_2',
      patientName: '別患者',
      prescriberName: '鈴木医師',
      prescriberInstitution: '鈴木クリニック',
      status: 'issued',
      items: [],
    });

    const response = await POST(createRequest({ prescription_id: 'rx_other_patient' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '電子処方箋の患者IDが選択中の患者と一致しません',
    });
    expectNoIntakeWrites();
  });

  it('rejects cancelled electronic prescriptions before transaction writes', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    fetchPrescriptionMock.mockResolvedValueOnce({
      prescriptionId: 'rx_cancelled',
      issuedAt: '2026-05-01T09:00:00Z',
      expiresAt: '2026-05-08T23:59:59Z',
      patientExternalId: 'patient_1',
      patientName: '山田太郎',
      prescriberName: '鈴木医師',
      prescriberInstitution: '鈴木クリニック',
      status: 'cancelled',
      items: [],
    });

    const response = await POST(createRequest({ prescription_id: 'rx_cancelled' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '受付できない状態の電子処方箋です',
      details: { status: ['cancelled'] },
    });
    expectNoIntakeWrites();
  });

  it('returns 201 with the created intake on happy path when adapter resolves and cycle exists', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([{ id: 'cycle_1', case_id: 'case_1' }]);
    createPrescriptionIntakeMock.mockResolvedValue({
      ok: true,
      intake: {
        id: 'intake_1',
        rx_number: 'RX-20260501-intake_1',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: '1149037F1024',
            dose: '5mg',
            frequency: '1日1回朝食後',
          },
        ],
      },
      cycle: { id: 'cycle_1', patient_id: 'patient_1' },
      medicationChanges: [],
      profileSyncResult: null,
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
        prescribed_date: '2026-05-01',
        external_prescription_id: 'rx_abc123',
      },
      e_prescription_id: 'rx_abc123',
      idempotent: false,
    });
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
        external_prescription_id: 'rx_abc123',
        prescribed_date: '2026-05-01',
        prescription_expiry_date: '2026-05-08',
        lines: [
          expect.objectContaining({
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '1149037F1024',
          }),
        ],
      }),
      'org_1',
      'user_1',
      { accessContext: { userId: 'user_1', role: 'admin' } },
    );
    expect(txMock.medicationCycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_1', 'case_2'] },
          overall_status: {
            in: [
              'intake_received',
              'structuring',
              'inquiry_pending',
              'inquiry_resolved',
              'ready_to_dispense',
            ],
          },
        }),
      }),
    );
  });

  it('requires case_id when multiple active cycles are eligible for the patient', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([
      { id: 'cycle_2', case_id: 'case_2' },
      { id: 'cycle_1', case_id: 'case_1' },
    ]);

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AMBIGUOUS_ACTIVE_CYCLE',
      details: { case_ids: ['case_2', 'case_1'] },
    });
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
  });

  it('uses the requested accessible case_id to select the active cycle', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([{ id: 'cycle_2', case_id: 'case_2' }]);
    createPrescriptionIntakeMock.mockResolvedValue({
      ok: true,
      intake: {
        id: 'intake_2',
        rx_number: 'RX-20260501-intake_2',
        lines: [],
      },
      cycle: { id: 'cycle_2', patient_id: 'patient_1' },
      medicationChanges: [],
      profileSyncResult: null,
    });

    const response = await POST(
      createRequest({ prescription_id: 'rx_abc123', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'intake_2', cycle_id: 'cycle_2' },
    });
    expect(txMock.medicationCycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ case_id: 'case_2' }),
      }),
    );
    expect(createPrescriptionIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({ cycle_id: 'cycle_2' }),
      'org_1',
      'user_1',
      { accessContext: { userId: 'user_1', role: 'admin' } },
    );
  });

  it('requires cycle cleanup when requested case_id still has multiple eligible cycles', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([
      { id: 'cycle_new', case_id: 'case_1' },
      { id: 'cycle_old', case_id: 'case_1' },
    ]);

    const response = await POST(
      createRequest({ prescription_id: 'rx_abc123', case_id: 'case_1' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AMBIGUOUS_ACTIVE_CYCLE',
      details: { case_ids: ['case_1'] },
    });
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
  });

  it('rejects inaccessible case_id before adapter calls or intake writes', async () => {
    mockAccessiblePatient();

    const response = await POST(
      createRequest({ prescription_id: 'rx_abc123', case_id: 'case_other' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CASE_NOT_ACCESSIBLE',
    });
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
    expectNoIntakeSideEffects();
  });

  it('returns the existing intake without creating when the external prescription id was already accepted', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.prescriptionIntake.findFirst.mockResolvedValue({
      id: 'intake_existing',
      cycle_id: 'cycle_1',
      prescribed_date: new Date('2026-05-01T00:00:00.000Z'),
      source_type: 'e_prescription',
      external_prescription_id: 'rx_abc123',
      cycle: { case_id: 'case_1' },
    });

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'intake_existing',
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
        prescribed_date: '2026-05-01',
        external_prescription_id: 'rx_abc123',
      },
      e_prescription_id: 'rx_abc123',
      idempotent: true,
    });
    expect(txMock.medicationCycle.findMany).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
    expect(createEPrescriptionAdapterMock).not.toHaveBeenCalled();
    expect(fetchPrescriptionMock).not.toHaveBeenCalled();
  });

  it('does not replay an existing e-prescription intake when requested case_id differs', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.prescriptionIntake.findFirst.mockResolvedValue({
      id: 'intake_existing',
      cycle_id: 'cycle_1',
      prescribed_date: new Date('2026-05-01T00:00:00.000Z'),
      source_type: 'e_prescription',
      external_prescription_id: 'rx_abc123',
      cycle: { case_id: 'case_1' },
    });

    const response = await POST(
      createRequest({ prescription_id: 'rx_abc123', case_id: 'case_2' }),
      {
        params: Promise.resolve({ id: 'patient_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EPRESCRIPTION_CASE_CONFLICT',
      details: { existing_case_id: 'case_1' },
    });
    expect(txMock.medicationCycle.findMany).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeMock).not.toHaveBeenCalled();
  });

  it('converges a unique conflict from a concurrent retry to the existing intake', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([{ id: 'cycle_1', case_id: 'case_1' }]);
    txMock.prescriptionIntake.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'intake_existing',
      cycle_id: 'cycle_1',
      prescribed_date: new Date('2026-05-01T00:00:00.000Z'),
      source_type: 'e_prescription',
      external_prescription_id: 'rx_abc123',
      cycle: { case_id: 'case_1' },
    });
    createPrescriptionIntakeMock.mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'intake_existing',
        cycle_id: 'cycle_1',
        source_type: 'e_prescription',
        prescribed_date: '2026-05-01',
        external_prescription_id: 'rx_abc123',
      },
      e_prescription_id: 'rx_abc123',
      idempotent: true,
    });
    expect(createPrescriptionIntakeMock).toHaveBeenCalledOnce();
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 without leaking unexpected electronic prescription intake failures', async () => {
    mockAccessiblePatient();
    mockEPrescription();
    txMock.medicationCycle.findMany.mockResolvedValue([{ id: 'cycle_1', case_id: 'case_1' }]);
    const unsafeError = new Error('raw e-prescription secret rx_abc123');
    unsafeError.name = 'UnsafeElectronicPrescriptionFailure';
    createPrescriptionIntakeMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createRequest({ prescription_id: 'rx_abc123' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw e-prescription secret');
    expect(bodyText).not.toContain('rx_abc123');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'patient_eprescription_post_unhandled_error',
      undefined,
      {
        event: 'patient_eprescription_post_unhandled_error',
        route: '/api/patients/[id]/prescriptions/e-prescription',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      },
    );
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(logged).not.toContain('raw e-prescription secret');
    expect(logged).not.toContain('rx_abc123');
    expect(txMock.prescriptionIntake.create).not.toHaveBeenCalled();
  });
});
