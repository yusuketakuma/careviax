import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { addDays, format } from 'date-fns';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string };
const VALID_PRESCRIBED_DATE = format(new Date(), 'yyyy-MM-dd');

const {
  withAuthMock,
  withOrgContextMock,
  createPrescriptionIntakeInTxMock,
  runPostCreateHooksMock,
  notifyWebhookEventForOrgMock,
  qrScanDraftClaimMock,
  qrScanDraftUpdateMock,
  jahisSupplementalRecordUpdateManyMock,
  broadcastStatusUpdateMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: AuthenticatedTestRequest,
        ctx: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handler(
          Object.assign(req, {
            orgId: 'org_1',
            userId: 'user_1',
          }),
          ctx,
        );
    },
  ),
  withOrgContextMock: vi.fn(),
  createPrescriptionIntakeInTxMock: vi.fn(),
  runPostCreateHooksMock: vi.fn(),
  notifyWebhookEventForOrgMock: vi.fn(),
  qrScanDraftClaimMock: vi.fn(),
  qrScanDraftUpdateMock: vi.fn(),
  jahisSupplementalRecordUpdateManyMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn().mockResolvedValue({ id: 'case_1' }),
  careCaseFindManyMock: vi.fn().mockResolvedValue([{ patient_id: 'patient_1' }]),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
  },
}));

vi.mock('@/server/services/prescription-intake-service', () => ({
  createPrescriptionIntakeInTx: createPrescriptionIntakeInTxMock,
  runPrescriptionIntakePostCreateHooks: runPostCreateHooksMock,
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  notifyWebhookEventForOrg: notifyWebhookEventForOrgMock,
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import { POST } from './route';
import { PrescriberInstitutionReferenceValidationError } from '@/lib/prescriptions/prescriber-institutions';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/qr-scan-drafts/draft_1/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/qr-scan-drafts/draft_1/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"patient_id":',
  });
}

describe('/api/qr-scan-drafts/[id]/confirm POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPrescriptionIntakeInTxMock.mockResolvedValue({
      kind: 'intake',
      intake: {
        id: 'intake_1',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
          },
        ],
      },
      cycle: { id: 'cycle_1', patient_id: 'patient_1', case_id: 'case_1' },
    });
    runPostCreateHooksMock.mockResolvedValue({
      medicationChanges: [],
      profileSyncResult: null,
    });
    notifyWebhookEventForOrgMock.mockResolvedValue([]);
    qrScanDraftClaimMock.mockResolvedValue({ count: 1 });
    qrScanDraftUpdateMock.mockResolvedValue({ id: 'draft_1', status: 'confirmed' });
    jahisSupplementalRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1950-03-15T00:00:00.000Z'),
      gender: 'male',
    });

    let callCount = 0;
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      callCount += 1;

      if (callCount === 1) {
        return callback({
          qrScanDraft: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'draft_1',
              status: 'pending',
              org_id: 'org_1',
              patient_id: 'patient_1',
              scanned_by: 'user_scan',
              parsed_data: {
                patientName: '山田 太郎',
                patientNameKana: 'ヤマダ タロウ',
                patientBirthdate: '1950-03-15',
                patientGender: 'male',
                supplementalRecords: [
                  {
                    recordType: '421',
                    recordLabel: '残薬確認',
                    lineNumber: 8,
                    fields: ['アムロジピンが10錠残薬。', '1'],
                    details: [{ label: '残薬内容', value: 'アムロジピンが10錠残薬。' }],
                    summary: 'アムロジピンが10錠残薬。',
                    rawLine: '421,アムロジピンが10錠残薬。,1',
                  },
                ],
              },
            }),
            updateMany: qrScanDraftClaimMock,
            update: qrScanDraftUpdateMock,
          },
          jahisSupplementalRecord: {
            updateMany: jahisSupplementalRecordUpdateManyMock,
          },
        });
      }

      return callback({
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      });
    });
  });

  it('rejects blank route IDs before body parsing, draft lookup, or intake creation', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: ' \t\n ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRスキャン下書きIDが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON payloads before draft lookup or intake creation', async () => {
    const response = await POST(createRequest([]), {
      params: Promise.resolve({ id: 'draft_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before draft lookup or intake creation', async () => {
    const response = await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'draft_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('creates an intake using patient_id and case_id without pre-resolving an existing cycle', async () => {
    const response = await POST(
      createRequest({
        patient_id: ' patient_1 ',
        case_id: ' case_1 ',
        prescribed_date: ` ${VALID_PRESCRIBED_DATE} `,
        prescriber_name: ' 鈴木医師 ',
        prescriber_institution_id: ' institution_1 ',
        prescriber_institution: ' テスト医院 ',
        lines: [
          {
            drug_name: ' アムロジピン錠5mg ',
            drug_code: ' 2149001 ',
            dosage_form: ' ',
            dose: ' 1錠 ',
            frequency: ' 1日1回朝食後 ',
            days: 14,
            packaging_instructions: ' 一包化 ',
            packaging_instruction_tags: [' unit_dose '],
            route: ' internal ',
            dispensing_method: ' unit_dose ',
            notes: ' ',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(qrScanDraftClaimMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'draft_1',
        org_id: 'org_1',
        status: 'pending',
      }),
      data: {
        patient_id: 'patient_1',
        status: 'confirmed',
      },
    });
    expect(createPrescriptionIntakeInTxMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        case_id: 'case_1',
        patient_id: 'patient_1',
        source_type: 'qr_scan',
        prescriber_institution_id: 'institution_1',
        lines: [
          expect.objectContaining({
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dosage_form: undefined,
            dose: '1錠',
            frequency: '1日1回朝食後',
            packaging_instructions: '一包化',
            route: 'internal',
            dispensing_method: 'unit_dose',
            notes: undefined,
          }),
        ],
      }),
      'org_1',
      'user_1',
      {
        skipStructuringCheck: true,
        accessContext: { userId: 'user_1', role: undefined },
      },
    );
    expect(qrScanDraftUpdateMock).toHaveBeenCalledWith({
      where: { id: 'draft_1' },
      data: {
        patient_id: 'patient_1',
        status: 'confirmed',
        confirmed_intake_id: 'intake_1',
      },
    });
    expect(jahisSupplementalRecordUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        qr_draft_id: 'draft_1',
        prescription_intake_id: null,
      },
      data: {
        patient_id: 'patient_1',
        prescription_intake_id: 'intake_1',
      },
    });
    expect(runPostCreateHooksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 'cycle_1',
        intakeId: 'intake_1',
        patientId: 'patient_1',
        orgId: 'org_1',
        sourceType: 'qr_scan',
      }),
    );
    expect(notifyWebhookEventForOrgMock).toHaveBeenCalledWith(
      'org_1',
      'prescription.created',
      expect.objectContaining({
        intakeId: 'intake_1',
        cycleId: 'cycle_1',
        patientId: 'patient_1',
        sourceType: 'qr_scan',
        lineCount: 1,
      }),
    );
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'qr_draft_confirmed',
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('draft_1');
    expect(JSON.stringify(event)).not.toContain('intake_1');
    expect(JSON.stringify(event)).not.toContain('cycle_1');
  });

  it('returns injectable outpatient eligibility details from intake rollback', async () => {
    createPrescriptionIntakeInTxMock.mockResolvedValue({
      kind: 'error',
      error: 'outpatient_injection_not_eligible',
      blockedLines: [
        {
          line_number: 1,
          drug_name: '注射薬A',
          reason: '薬剤マスターで外来/在宅自己注射対象として確認されていません',
        },
      ],
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: '注射薬A',
            drug_code: 'INJ001',
            dosage_form: '注射液',
            dose: '1本',
            frequency: '1日1回',
            days: 7,
            route: 'injection',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '外来/在宅自己注射として調剤可否が未確認の注射剤があります',
      details: {
        blocked_lines: [
          {
            line_number: 1,
            drug_name: '注射薬A',
            reason: '薬剤マスターで外来/在宅自己注射対象として確認されていません',
          },
        ],
      },
    });
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(runPostCreateHooksMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank required fields and invalid line enums before draft lookup', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '   ',
            frequency: '1日1回朝食後',
            days: 14,
            route: 'topical',
            dispensing_method: 'powdered',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects expired prescriptions before claiming the draft', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: '2000-01-01',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方箋の有効期限が切れています（発行日から4日以内が有効です）',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftClaimMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects future prescriptions before claiming the draft', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '未来日の処方箋は登録できません',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftClaimMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe quantity and calendar date values before draft lookup', async () => {
    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: '2026-02-30',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            quantity: -100,
            start_date: '2026-04-10',
            end_date: '2026-04-01',
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects confirmation when QR parsed_data cannot prove patient identity', async () => {
    const supplementalDeleteManyMock = vi.fn();
    const supplementalCreateManyMock = vi.fn();
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_1',
            status: 'pending',
            org_id: 'org_1',
            patient_id: 'patient_1',
            scanned_by: 'user_scan',
            parsed_data: ['unexpected'],
          }),
          updateMany: qrScanDraftClaimMock,
          update: qrScanDraftUpdateMock,
        },
        jahisSupplementalRecord: {
          updateMany: jahisSupplementalRecordUpdateManyMock,
          deleteMany: supplementalDeleteManyMock,
          createMany: supplementalCreateManyMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報を確認できません',
      details: {
        missing_identity: ['name', 'birth_date'],
      },
    });
    expect(qrScanDraftClaimMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(supplementalDeleteManyMock).not.toHaveBeenCalled();
    expect(supplementalCreateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the draft patient does not match the target patient', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_1',
            status: 'pending',
            org_id: 'org_1',
            patient_id: 'patient_2',
            scanned_by: 'user_scan',
            parsed_data: {
              patientName: '山田 太郎',
              patientBirthdate: '1950-03-15',
              supplementalRecords: [],
            },
          }),
        },
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the QR patient identity does not match the target patient', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_1',
            status: 'pending',
            org_id: 'org_1',
            patient_id: 'patient_1',
            scanned_by: 'user_scan',
            parsed_data: {
              patientName: '山田 太郎',
              patientNameKana: 'ヤマダ タロウ',
              patientBirthdate: '1960-06-15',
              patientGender: 'male',
              supplementalRecords: [],
            },
          }),
          updateMany: qrScanDraftClaimMock,
          update: qrScanDraftUpdateMock,
        },
        jahisSupplementalRecord: {
          updateMany: jahisSupplementalRecordUpdateManyMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報が選択患者と一致しません',
    });
    expect(qrScanDraftClaimMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects already processed drafts before claim or intake creation', async () => {
    withOrgContextMock.mockImplementationOnce(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'draft_1',
            status: 'confirmed',
            org_id: 'org_1',
            patient_id: 'patient_1',
            scanned_by: 'user_scan',
            parsed_data: {
              patientName: '山田 太郎',
              patientBirthdate: '1950-03-15',
              supplementalRecords: [],
            },
          }),
          updateMany: qrScanDraftClaimMock,
          update: qrScanDraftUpdateMock,
        },
        jahisSupplementalRecord: {
          updateMany: jahisSupplementalRecordUpdateManyMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'このQRスキャン下書きはすでに処理済みです',
    });
    expect(qrScanDraftClaimMock).not.toHaveBeenCalled();
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('does not create an intake when the pending claim is lost', async () => {
    qrScanDraftClaimMock.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'このQRスキャン下書きはすでに処理済みです',
    });
    expect(qrScanDraftClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'draft_1',
          org_id: 'org_1',
          status: 'pending',
        }),
      }),
    );
    expect(createPrescriptionIntakeInTxMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(runPostCreateHooksMock).not.toHaveBeenCalled();
    expect(notifyWebhookEventForOrgMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('does not confirm the draft when the target case does not belong to the patient', async () => {
    createPrescriptionIntakeInTxMock.mockResolvedValueOnce({
      kind: 'error',
      error: 'cycle_not_found',
    });

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_other_patient',
        prescribed_date: VALID_PRESCRIBED_DATE,
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '指定されたサイクルが見つかりません',
    });
    expect(createPrescriptionIntakeInTxMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_other_patient',
        source_type: 'qr_scan',
      }),
      'org_1',
      'user_1',
      {
        skipStructuringCheck: true,
        accessContext: { userId: 'user_1', role: undefined },
      },
    );
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('maps missing prescriber institution to 400 without confirming the draft', async () => {
    createPrescriptionIntakeInTxMock.mockRejectedValueOnce(
      new PrescriberInstitutionReferenceValidationError('選択した医療機関が見つかりません'),
    );

    const response = await POST(
      createRequest({
        patient_id: 'patient_1',
        case_id: 'case_1',
        prescribed_date: VALID_PRESCRIBED_DATE,
        prescriber_institution_id: 'institution_missing',
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      }),
      { params: Promise.resolve({ id: 'draft_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '選択した医療機関が見つかりません',
    });
    expect(createPrescriptionIntakeInTxMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        prescriber_institution_id: 'institution_missing',
      }),
      'org_1',
      'user_1',
      {
        skipStructuringCheck: true,
        accessContext: { userId: 'user_1', role: undefined },
      },
    );
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(jahisSupplementalRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(qrScanDraftUpdateMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });
});
