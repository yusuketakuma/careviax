import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  patientFindFirstMock,
  patientInsuranceFindFirstMock,
  createQualificationCheckAdapterMock,
  checkInsuranceMock,
  getCapabilitiesMock,
  notifyWebhookEventForOrgMock,
  QualificationCheckAdapterErrorMock,
  loggerErrorMock,
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
    withOrgContextMock: vi.fn(),
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
    loggerErrorMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/adapters/qualification-check', () => ({
  createQualificationCheckAdapter: createQualificationCheckAdapterMock,
  QualificationCheckAdapterError: QualificationCheckAdapterErrorMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  applyPatientAssignmentWhere: (base: unknown) => base,
}));

import { POST } from './route';

const SENSITIVE_NO_STORE = 'private, no-store, max-age=0';

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/qualification-check', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe(SENSITIVE_NO_STORE);
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/qualification-check POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      medical_insurance_number: '12345678',
      care_insurance_number: '87654321',
    });
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: patientFindFirstMock,
        },
        patientInsurance: {
          findFirst: patientInsuranceFindFirstMock,
        },
      }),
    );
    checkInsuranceMock.mockResolvedValue({
      valid: true,
      patientName: '山田 太郎',
      payerName: '協会けんぽ',
      payerType: 'medical',
      copayRatio: 0.3,
      coverage: { startDate: '2026-01-01', endDate: null },
      warnings: [],
      raw: {
        patient_name: '山田 太郎',
        insurance_number: '12345678',
        token: 'secret',
      },
    });
    getCapabilitiesMock.mockReturnValue({
      supportsOnlineLookup: false,
      supportsBenefitHistory: false,
      supportsCareInsurance: false,
    });
    notifyWebhookEventForOrgMock.mockResolvedValue(undefined);
  });

  it('rejects blank patient ids before loading the patient or calling external adapters', async () => {
    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: {
        id: true,
        name: true,
        name_kana: true,
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
        identityMatch: 'matched',
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        valid: true,
        identityMatch: 'matched',
        payerName: '協会けんぽ',
        payerType: 'medical',
        copayRatio: 0.3,
        coverage: { startDate: '2026-01-01', endDate: null },
        warnings: [],
      },
      capabilities: {
        supportsOnlineLookup: false,
        supportsBenefitHistory: false,
        supportsCareInsurance: false,
      },
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('raw');
    expect(serializedBody).not.toContain('patientName');
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('12345678');
    expect(serializedBody).not.toContain('secret');
  });

  it('rejects archived patients before insurance resolution, external checks, or webhooks', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(createQualificationCheckAdapterMock).not.toHaveBeenCalled();
    expect(checkInsuranceMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('prefers active structured medical PatientInsurance over legacy patient columns', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
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
    expectSensitiveNoStore(response);
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

  it('marks valid provider results as identity mismatches without returning provider or local names', async () => {
    checkInsuranceMock.mockResolvedValueOnce({
      valid: true,
      patientName: '佐藤 花子',
      payerName: '協会けんぽ',
      payerType: 'medical',
      copayRatio: 0.3,
      coverage: { startDate: '2026-01-01', endDate: null },
      warnings: [],
      raw: {
        patient_name: '佐藤 花子',
        insurance_number: '12345678',
        token: 'secret',
      },
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        valid: false,
        identityMatch: 'mismatch',
        warnings: expect.arrayContaining(['資格確認結果の氏名が患者情報と一致しません']),
      },
    });
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'qualification.checked',
      expect.objectContaining({
        patientId: 'patient_1',
        insuranceNumberPresent: true,
        identityMatch: 'mismatch',
      }),
    );

    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('佐藤 花子');
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('12345678');
    expect(serializedBody).not.toContain('token');
    expect(serializedBody).not.toContain('raw');
    expect(serializedBody).not.toContain('patientName');
  });

  it('does not mark provider-valid results valid when identity cannot be compared', async () => {
    checkInsuranceMock.mockResolvedValueOnce({
      valid: true,
      patientName: null,
      payerName: '協会けんぽ',
      payerType: 'medical',
      copayRatio: 0.3,
      coverage: { startDate: '2026-01-01', endDate: null },
      warnings: [],
      raw: {
        patient_name: null,
        insurance_number: '12345678',
        token: 'secret',
      },
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        valid: false,
        identityMatch: 'unknown',
        warnings: expect.arrayContaining(['資格確認結果の氏名を患者情報と照合できません']),
      },
    });
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'qualification.checked',
      expect.objectContaining({
        patientId: 'patient_1',
        insuranceNumberPresent: true,
        identityMatch: 'unknown',
      }),
    );

    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('12345678');
    expect(serializedBody).not.toContain('token');
    expect(serializedBody).not.toContain('raw');
    expect(serializedBody).not.toContain('patientName');
  });

  it('returns auth rejections with sensitive no-store headers before patient lookups', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(createQualificationCheckAdapterMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('returns fixed no-store provider setup failures without exposing configuration details', async () => {
    createQualificationCheckAdapterMock.mockImplementationOnce(() => {
      throw new QualificationCheckAdapterErrorMock(
        '資格確認 API の baseUrl が設定されていません patient 山田 太郎 token secret',
        'INVALID_CONFIGURATION',
      );
    });

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'OQC_UPSTREAM_FAILURE',
      message: 'オンライン資格確認の設定に問題があります',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('baseUrl');
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('token secret');
    expect(checkInsuranceMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('returns fixed no-store upstream failures without echoing provider messages', async () => {
    checkInsuranceMock.mockRejectedValueOnce(
      new QualificationCheckAdapterErrorMock(
        'upstream failed for insurance 12345678 patient 山田 太郎 token secret',
        'UPSTREAM_FAILURE',
      ),
    );

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(502);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'OQC_UPSTREAM_FAILURE',
      message: 'オンライン資格確認サービスの呼び出しに失敗しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('12345678');
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('token secret');
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('keeps not-enabled provider responses no-store and fixed', async () => {
    checkInsuranceMock.mockRejectedValueOnce(
      new QualificationCheckAdapterErrorMock(
        'stub provider disabled with insurance 12345678 token secret',
        'NOT_IMPLEMENTED',
      ),
    );

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(501);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'OQC_NOT_ENABLED',
      message: 'オンライン資格確認はまだ有効化されていません',
    });
    expect(JSON.stringify(body)).not.toContain('12345678');
    expect(JSON.stringify(body)).not.toContain('token secret');
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 when webhook notification fails without exposing PHI', async () => {
    const unsafeError = new Error(
      'webhook failed for patient 山田 太郎 insurance 12345678 token secret',
    );
    notifyWebhookEventForOrgMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('12345678');
    expect(serializedBody).not.toContain('token secret');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'qualification_check_post_unhandled_error',
      route: '/api/patients/:id/qualification-check',
      method: 'POST',
      status: 500,
      code: 'Error',
    });
    const [logContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(typeof logContext).not.toBe('string');
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(JSON.stringify(logContext)).not.toContain('山田 太郎');
    expect(JSON.stringify(logContext)).not.toContain('12345678');
    expect(JSON.stringify(logContext)).not.toContain('token secret');
    expect(logged).not.toContain('山田 太郎');
    expect(logged).not.toContain('12345678');
    expect(logged).not.toContain('token secret');
    expect(logged).not.toContain('webhook failed');
  });

  it('returns a fixed no-store 500 when auth plumbing fails before route params', async () => {
    const unsafeError = new Error(
      'auth plumbing failed for qualification patient 山田 太郎 token secret',
    );
    requireAuthContextMock.mockRejectedValueOnce(unsafeError);

    const response = await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('山田 太郎');
    expect(serializedBody).not.toContain('token secret');
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(createQualificationCheckAdapterMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'qualification_check_post_unhandled_error',
      route: '/api/patients/:id/qualification-check',
      method: 'POST',
      status: 500,
      code: 'Error',
    });
    const [logContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(typeof logContext).not.toBe('string');
    expect(loggerErrorMock.mock.calls[0]).not.toContain(unsafeError);
    expect(loggerErrorMock.mock.calls[0]?.[1]).toBeUndefined();
    const logged = JSON.stringify(loggerErrorMock.mock.calls);
    expect(JSON.stringify(logContext)).not.toContain('山田 太郎');
    expect(JSON.stringify(logContext)).not.toContain('token secret');
    expect(logged).not.toContain('山田 太郎');
    expect(logged).not.toContain('token secret');
    expect(logged).not.toContain('auth plumbing failed');
  });
});
