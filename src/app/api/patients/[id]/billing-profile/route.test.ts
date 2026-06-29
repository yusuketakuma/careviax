import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  requireWritablePatientMock,
  upsertOperationalTaskMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { PATCH } from './route';

const SENSITIVE_NO_STORE = 'private, no-store, max-age=0';

function createRequest(body: unknown, patientId = 'patient_1') {
  return new NextRequest(`http://localhost/api/patients/${patientId}/billing-profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: JSON.stringify(body),
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe(SENSITIVE_NO_STORE);
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/billing-profile PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    requireWritablePatientMock.mockResolvedValue({
      patient: { id: 'patient_1', archived_at: null },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1', name: '田中 一郎' }),
        },
        task: {
          upsert: vi.fn(),
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1' });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('saves a patient billing payment profile through the operational task sidecar', async () => {
    const response = await PATCH(
      createRequest({
        payer_type: 'family',
        payer_name: '山田 花子',
        payer_relation: '長女',
        billing_address_mode: 'same_as_patient',
        payment_method: 'bank_transfer',
        collection_timing: 'month_end',
        receipt_issue: 'paper',
        invoice_issue: 'yes',
        unpaid_tolerance: 'one_month',
        note: '月末に長女へ請求',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.anything(), {
      permission: 'canManageBilling',
      message: '支払設定の更新権限がありません',
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'patient_billing_payment_profile',
        status: 'completed',
        dedupeKey: 'patient_billing_payment_profile:patient_1',
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
        metadata: expect.objectContaining({
          payer_type: 'family',
          payer_name: '山田 花子',
          payment_method: 'bank_transfer',
          collection_timing: 'month_end',
          receipt_issue: 'paper',
          invoice_issue: 'yes',
          unpaid_tolerance: 'one_month',
          note: '月末に長女へ請求',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'billing_payment_profile_updated',
        targetType: 'Patient',
        targetId: 'patient_1',
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        profile: {
          payer_type: 'family',
          payer_name: '山田 花子',
          payment_method: 'bank_transfer',
        },
      },
    });
  });

  it('rejects invalid payment profile values before writing', async () => {
    const response = await PATCH(
      createRequest({
        payer_type: 'family',
        payment_method: 'cash',
        collection_timing: 'unknown',
        receipt_issue: 'paper',
        invoice_issue: 'yes',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects family payer profiles without payer name and relation', async () => {
    const response = await PATCH(
      createRequest({
        payer_type: 'family',
        payer_name: ' ',
        payer_relation: '',
        billing_address_mode: 'same_as_patient',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'no',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        payer_name: expect.arrayContaining(['本人以外の支払者では支払者名が必須です']),
        payer_relation: expect.arrayContaining(['家族・代理人・その他の支払者では続柄が必須です']),
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects different billing address mode without a billing address', async () => {
    const response = await PATCH(
      createRequest({
        payer_type: 'self',
        billing_address_mode: 'different',
        billing_address: ' ',
        payment_method: 'bank_transfer',
        collection_timing: 'month_end',
        receipt_issue: 'pdf',
        invoice_issue: 'yes',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        billing_address: expect.arrayContaining(['患者住所と異なる請求先では請求先住所が必須です']),
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects custom unpaid tolerance without a note', async () => {
    const response = await PATCH(
      createRequest({
        payer_type: 'self',
        billing_address_mode: 'same_as_patient',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'no',
        unpaid_tolerance: 'custom',
        note: '',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        note: expect.arrayContaining(['個別の未収許容条件は備考に記録してください']),
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns not found when the patient is outside the caller scope', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        payer_type: 'self',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'no',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns auth rejections with sensitive no-store headers before write checks', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await PATCH(
      createRequest({
        payer_type: 'self',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'no',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(requireWritablePatientMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns sanitized no-store 500 responses for unexpected payment profile failures', async () => {
    const rawErrorMessage =
      'payment profile failed for 患者A payer=山田花子 address=東京都千代田区 token=secret';
    withOrgContextMock.mockRejectedValueOnce(new Error(rawErrorMessage));

    const response = await PATCH(
      createRequest({
        payer_type: 'family',
        payer_name: '山田 花子',
        payer_relation: '長女',
        billing_address_mode: 'same_as_patient',
        payment_method: 'bank_transfer',
        collection_timing: 'month_end',
        receipt_issue: 'paper',
        invoice_issue: 'yes',
        unpaid_tolerance: 'one_month',
        note: '月末に長女へ請求',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain(rawErrorMessage);
    expect(bodyText).not.toContain('山田花子');
    expect(bodyText).not.toContain('東京都千代田区');
    expect(bodyText).not.toContain('secret');
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before writing payment profiles', async () => {
    requireWritablePatientMock.mockResolvedValue({
      response: Response.json(
        { message: 'アーカイブ中の患者は復元するまで更新できません' },
        { status: 409 },
      ),
    });

    const response = await PATCH(
      createRequest({
        payer_type: 'self',
        payment_method: 'cash',
        collection_timing: 'per_visit',
        receipt_issue: 'paper',
        invoice_issue: 'no',
        unpaid_tolerance: 'none',
      }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
