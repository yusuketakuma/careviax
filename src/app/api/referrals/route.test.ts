import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createReferralIntakeMock } = vi.hoisted(() => ({
  createReferralIntakeMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
          actorSiteId: 'site_1',
          actorPharmacyId: 'org_1',
        },
        routeContext,
      ),
}));

vi.mock('@/server/services/referral-intake-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/referral-intake-service')>();
  return {
    ...actual,
    createReferralIntake: createReferralIntakeMock,
  };
});

import { POST as rawPOST } from './route';
import { ReferralIntakeTransactionError } from '@/server/services/referral-intake-service';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

const sensitivePayload = {
  name: 'Sensitive Patient',
  name_kana: 'Sensitive Kana',
  birth_date: '1950-01-01',
  gender: 'female',
  phone: '090-0000-0000',
  medical_insurance_number: 'medical-secret-123',
  care_insurance_number: 'care-secret-456',
  address: 'Sensitive Address 1-2-3',
  referral_type: 'physician',
  referral_source: 'Sensitive Clinic',
  referral_date: '2026-06-23',
  referral_notes: 'Sensitive referral note',
  doc_physician_order: true,
  doc_consent: false,
  doc_health_insurance: true,
  doc_care_insurance: false,
};

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/referrals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/referrals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createReferralIntakeMock.mockResolvedValue({
      status: 'created',
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [],
      metadata: { duplicate_count: 0 },
    });
  });

  it('returns a minimal PHI-free success payload', async () => {
    const response = await POST(createRequest(sensitivePayload));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [],
      metadata: { duplicate_count: 0 },
    });
    expect(createReferralIntakeMock).toHaveBeenCalledOnce();
    expect(createReferralIntakeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.objectContaining({
        name: sensitivePayload.name,
        referral_type: 'physician',
      }),
    );
  });

  it('passes duplicate acknowledgements through and keeps the acknowledged success payload minimal', async () => {
    createReferralIntakeMock.mockResolvedValueOnce({
      status: 'created',
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [
        {
          code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
          severity: 'warning',
          message: '重複候補を確認済みとして紹介受付を登録しました。',
        },
      ],
      metadata: { duplicate_count: 1 },
    });

    const response = await POST(
      createRequest({
        ...sensitivePayload,
        duplicate_acknowledged: true,
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      patient: { id: 'patient_new' },
      case: { id: 'case_new' },
      warnings: [
        {
          code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
          severity: 'warning',
          message: '重複候補を確認済みとして紹介受付を登録しました。',
        },
      ],
      metadata: { duplicate_count: 1 },
    });
    expect(Object.keys(body).sort()).toEqual(['case', 'metadata', 'patient', 'warnings']);
    expect(Object.keys(body.patient).sort()).toEqual(['id']);
    expect(Object.keys(body.case).sort()).toEqual(['id']);
    expect(createReferralIntakeMock).toHaveBeenCalledOnce();
    expect(createReferralIntakeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }),
      expect.objectContaining({
        duplicate_acknowledged: true,
        name: sensitivePayload.name,
        referral_type: 'physician',
      }),
    );

    const bodyText = JSON.stringify(body);
    for (const sensitiveValue of [
      sensitivePayload.name,
      sensitivePayload.name_kana,
      sensitivePayload.birth_date,
      sensitivePayload.phone,
      sensitivePayload.address,
      sensitivePayload.medical_insurance_number,
      sensitivePayload.care_insurance_number,
      sensitivePayload.referral_source,
      sensitivePayload.referral_notes,
    ]) {
      expect(bodyText).not.toContain(sensitiveValue);
    }
  });

  it('rejects invalid input before calling the service', async () => {
    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    expect(createReferralIntakeMock).not.toHaveBeenCalled();
  });

  it('returns sanitized duplicate details without patient identity fields', async () => {
    createReferralIntakeMock.mockResolvedValueOnce({
      status: 'duplicate',
      duplicate_count: 1,
      duplicates: [{ id: 'patient_existing' }],
    });

    const response = await POST(createRequest(sensitivePayload));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      code: 'WORKFLOW_CONFLICT',
      message: '重複している可能性がある患者が存在します',
      details: {
        duplicate_type: 'patient_identity',
        duplicate_count: 1,
      },
    });
    expect(Object.keys(body.details).sort()).toEqual(['duplicate_count', 'duplicate_type']);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('duplicates');
    expect(bodyText).not.toContain('patient_existing');
    expect(bodyText).not.toContain('Sensitive Patient');
    expect(bodyText).not.toContain('Sensitive Kana');
    expect(bodyText).not.toContain('1950-01-01');
    expect(bodyText).not.toContain('090-0000-0000');
    expect(bodyText).not.toContain('Sensitive Address 1-2-3');
    expect(bodyText).not.toContain('medical-secret-123');
    expect(bodyText).not.toContain('care-secret-456');
    expect(bodyText).not.toContain('Sensitive Clinic');
    expect(bodyText).not.toContain('Sensitive referral note');
    expect(createReferralIntakeMock).toHaveBeenCalledOnce();
  });

  it('returns a fixed generic message for transaction failures', async () => {
    createReferralIntakeMock.mockRejectedValueOnce(new ReferralIntakeTransactionError());

    const response = await POST(createRequest(sensitivePayload));

    expect(response.status).toBe(500);
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).toContain('紹介受付の登録に失敗しました');
    for (const sensitiveValue of [
      sensitivePayload.name,
      sensitivePayload.phone,
      sensitivePayload.address,
      sensitivePayload.medical_insurance_number,
      sensitivePayload.care_insurance_number,
      sensitivePayload.referral_source,
      sensitivePayload.referral_notes,
    ]) {
      expect(bodyText).not.toContain(sensitiveValue);
    }
    expect(createReferralIntakeMock).toHaveBeenCalledOnce();
  });
});
