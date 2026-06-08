import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientInsuranceFindFirstMock,
  createQualificationCheckAdapterMock,
  checkInsuranceMock,
  getCapabilitiesMock,
  notifyWebhookEventForOrgMock,
  QualificationCheckAdapterErrorMock,
} = vi.hoisted(() => {
  class QualificationCheckAdapterError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }

  const checkInsuranceMock = vi.fn();
  const getCapabilitiesMock = vi.fn();

  return {
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    patientInsuranceFindFirstMock: vi.fn(),
    createQualificationCheckAdapterMock: vi.fn(() => ({
      checkInsurance: checkInsuranceMock,
      getCapabilities: getCapabilitiesMock,
    })),
    checkInsuranceMock,
    getCapabilitiesMock,
    notifyWebhookEventForOrgMock: vi.fn(),
    QualificationCheckAdapterErrorMock: QualificationCheckAdapterError,
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
  },
}));

vi.mock('@/server/adapters/qualification-check', () => ({
  createQualificationCheckAdapter: createQualificationCheckAdapterMock,
  QualificationCheckAdapterError: QualificationCheckAdapterErrorMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  applyPatientAssignmentWhere: (base: unknown) => base,
}));

import { POST } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/qualification-check', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/patients/[id]/qualification-check POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      medical_insurance_number: '12345678',
      care_insurance_number: '87654321',
    });
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    checkInsuranceMock.mockResolvedValue({ status: 'valid' });
    getCapabilitiesMock.mockReturnValue({ provider: 'stub' });
    notifyWebhookEventForOrgMock.mockResolvedValue(undefined);
  });

  it('rejects blank patient ids before loading the patient or calling external adapters', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(createQualificationCheckAdapterMock).not.toHaveBeenCalled();
    expect(checkInsuranceMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('checks assigned patient insurance and emits a webhook event', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        medical_insurance_number: true,
        care_insurance_number: true,
      },
    });
    expect(checkInsuranceMock).toHaveBeenCalledWith({
      insuranceNumber: '12345678',
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'qualification.checked',
      expect.objectContaining({
        patientId: 'patient_1',
        insuranceNumberPresent: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'valid' },
      capabilities: { provider: 'stub' },
    });
  });

  it('prefers active structured medical PatientInsurance over legacy patient columns', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      medical_insurance_number: null,
      care_insurance_number: null,
    });
    patientInsuranceFindFirstMock.mockResolvedValue({
      id: 'insurance_1',
      number: '87654321',
      insurance_type: 'medical',
      application_status: 'confirmed',
      public_program_code: null,
      previous_care_level: null,
      provisional_care_level: null,
      confirmed_care_level: null,
      is_active: true,
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientInsuranceFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          insurance_type: 'medical',
          is_active: true,
        }),
      }),
    );
    expect(checkInsuranceMock).toHaveBeenCalledWith({
      insuranceNumber: '87654321',
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'qualification.checked',
      expect.objectContaining({
        insuranceNumberPresent: true,
      }),
    );
  });
});
