import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

type TestAuthContext = { orgId: string; userId: string; role: 'pharmacist' };
type TestRouteContext = { params: Promise<Record<string, string>> };

const {
  withAuthContextMock,
  withOrgContextMock,
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  patientFindFirstMock,
  pharmacySiteFindFirstMock,
  careCaseFindFirstMock,
  jahisSupplementalRecordDeleteManyMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  isJahisQRMock,
  parseJahisQRSafeMock,
  mergeJahisQRPagesMock,
  detectMultiQRMock,
  mapJahisToIntakeMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: TestAuthContext,
        routeContext: TestRouteContext,
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, routeContext: TestRouteContext = { params: Promise.resolve({}) }) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    },
  ),
  withOrgContextMock: vi.fn(),
  qrScanDraftFindFirstMock: vi.fn().mockResolvedValue(null),
  qrScanDraftCreateMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn().mockResolvedValue({ id: 'case_1' }),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  jahisSupplementalRecordCreateManyMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
  isJahisQRMock: vi.fn().mockReturnValue(true),
  parseJahisQRSafeMock: vi.fn(),
  mergeJahisQRPagesMock: vi.fn(),
  detectMultiQRMock: vi.fn().mockReturnValue(null),
  mapJahisToIntakeMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    qrScanDraft: {
      findFirst: qrScanDraftFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

vi.mock('@/lib/pharmacy/jahis-qr', () => ({
  isJahisQR: isJahisQRMock,
  parseJahisQRSafe: parseJahisQRSafeMock,
  mergeJahisQRPages: mergeJahisQRPagesMock,
  detectMultiQR: detectMultiQRMock,
}));

vi.mock('@/lib/pharmacy/qr-intake-mapper', () => ({
  mapJahisToIntake: mapJahisToIntakeMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/qr-scan-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/qr-scan-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"qr_texts":',
  });
}

describe('/api/qr-scan-drafts POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1950-03-15T00:00:00.000Z'),
      gender: 'male',
    });
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    isJahisQRMock.mockReturnValue(true);
    mergeJahisQRPagesMock.mockImplementation((pages: unknown[]) => pages[0]);
    parseJahisQRSafeMock.mockReturnValue({
      success: true,
      warnings: [],
      data: {
        patient: {
          name: '山田 太郎',
          nameKana: 'ヤマダ タロウ',
          birthDate: '1950-03-15',
          gender: 'male',
        },
        medications: [{ drugName: 'アムロジピン錠5mg' }],
        prescribingInstitution: {
          name: 'テスト医院',
          institutionCode: '1234567',
        },
        dispensingInstitution: {},
        prescribingDoctor: '鈴木医師',
        dispensingDate: '2026-04-01',
        prescriptionIssueDate: '2026-04-01',
        prescriptionExpirationDate: '2026-04-05',
        prescriptionInsurance: {
          insurerNumber: '06012345',
          symbol: '記号A',
          number: '1234567',
          branchNumber: '05',
          patientCopayRatio: 30,
          publicSubsidies: [{ rank: 1, payerNumber: '54123456', recipientNumber: '7654321' }],
        },
        remarks: ['一包化'],
        patientNotes: ['他職種共有あり'],
        rawRecords: [
          { recordType: '21', lineNumber: 8, fields: ['1'], rawLine: '21,1' },
          {
            recordType: '27',
            lineNumber: 12,
            fields: ['54123456', '7654321'],
            rawLine: '27,54123456,7654321',
          },
        ],
        supplementalRecords: [
          {
            recordType: '421',
            recordLabel: '残薬確認',
            lineNumber: 8,
            fields: ['アムロジピンが10錠残薬。症状改善による自己判断で服用中断。', '1'],
            details: [
              {
                label: '残薬内容',
                value: 'アムロジピンが10錠残薬。症状改善による自己判断で服用中断。',
              },
              { label: 'レコード作成者', value: '1' },
            ],
            summary: 'アムロジピンが10錠残薬。症状改善による自己判断で服用中断。',
            rawLine: '421,アムロジピンが10錠残薬。症状改善による自己判断で服用中断。,1',
          },
        ],
        rawText: 'JAHISTC08,1',
      },
    });
    mapJahisToIntakeMock.mockResolvedValue({
      lines: [
        {
          line_number: 1,
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dosage_form: '錠',
          dose: '1錠',
          frequency: '1日1回朝食後',
          days: 14,
          quantity: 14,
          unit: '錠',
          is_generic: false,
          packaging_method: 'unit_dose',
          packaging_instructions: '一包化 / 別包',
          packaging_instruction_tags: ['unit_dose', 'separate_pack'],
          route: 'internal',
          dispensing_method: 'unit_dose',
          start_date: '2026-04-01',
          end_date: null,
          notes: '冷所保管',
        },
      ],
      prescribedDate: '2026-04-01',
      prescriberName: '鈴木医師',
      prescriberInstitution: 'テスト医院',
      prescriberInstitutionCode: '1234567',
      prescriberInstitutionId: 'inst_1',
      isNewInstitution: false,
      autoCompletedFields: [
        { lineIndex: 0, field: 'dosage_form', value: '錠', source: 'drug_master' },
      ],
      unmatchedDrugs: [
        { lineIndex: 0, drugName: '薬A', drugCode: null, reason: 'no_code_provided' },
      ],
      formularyStatus: [
        {
          lineIndex: 0,
          drugName: 'アムロジピン錠5mg',
          drugCode: '2149001',
          inFormulary: false,
          warningLevel: 'warning',
          warningReason: 'stocked_generic_available',
          preferredGenericId: null,
          preferredGenericName: 'アムロジピン錠5mg「GE」',
          stockQty: 0,
        },
      ],
    });
    qrScanDraftCreateMock.mockResolvedValue({
      id: 'draft_1',
      parsed_data: {},
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          create: qrScanDraftCreateMock,
        },
        jahisSupplementalRecord: {
          deleteMany: jahisSupplementalRecordDeleteManyMock,
          createMany: jahisSupplementalRecordCreateManyMock,
        },
      }),
    );
  });

  it('rejects non-object JSON payloads before patient/site lookup or draft creation', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before patient/site lookup or draft creation', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('persists enriched parsed_data from the QR mapper', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [' JAHISTC08,1 '],
        patient_id: ' patient_1 ',
        site_id: ' site_1 ',
        session_id: ' session_1 ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'site_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(isJahisQRMock).toHaveBeenCalledTimes(1);
    expect(isJahisQRMock).toHaveBeenCalledWith('JAHISTC08,1');
    expect(mapJahisToIntakeMock).toHaveBeenCalled();
    expect(qrScanDraftCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          site_id: 'site_1',
          patient_id: 'patient_1',
          session_id: 'session_1',
          raw_qr_texts: ['JAHISTC08,1'],
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          parsed_data: expect.objectContaining({
            patientName: '山田 太郎',
            prescriptionIssueDate: '2026-04-01',
            prescriptionExpirationDate: '2026-04-05',
            prescriptionInsurance: expect.objectContaining({
              insurerNumber: '06012345',
              publicSubsidies: [
                expect.objectContaining({ payerNumber: '54123456', recipientNumber: '7654321' }),
              ],
            }),
            rawRecords: [
              expect.objectContaining({ recordType: '21' }),
              expect.objectContaining({ recordType: '27' }),
            ],
            prescriberInstitutionId: 'inst_1',
            unmatchedDrugs: expect.any(Array),
            formularyStatus: [
              expect.objectContaining({
                drugName: 'アムロジピン錠5mg',
                inFormulary: false,
                warningLevel: 'warning',
                warningReason: 'stocked_generic_available',
              }),
            ],
            lines: [
              expect.objectContaining({
                drugName: 'アムロジピン錠5mg',
                packagingInstructions: '一包化 / 別包',
                packagingInstructionTags: ['unit_dose', 'separate_pack'],
                dispensingMethod: 'unit_dose',
              }),
            ],
            supplementalRecords: [
              expect.objectContaining({
                recordType: '421',
                recordLabel: '残薬確認',
              }),
            ],
          }),
        }),
      }),
    );
    expect(qrScanDraftCreateMock.mock.calls[0]?.[0]?.data.parsed_data).not.toHaveProperty(
      'rawText',
    );
    expect(jahisSupplementalRecordDeleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', qr_draft_id: 'draft_1' },
    });
    expect(jahisSupplementalRecordCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          qr_draft_id: 'draft_1',
          prescription_intake_id: null,
          record_type: '421',
          record_label: '残薬確認',
          payload: expect.objectContaining({
            details: expect.arrayContaining([
              {
                label: '残薬内容',
                value: 'アムロジピンが10錠残薬。症状改善による自己判断で服用中断。',
              },
            ]),
          }),
        }),
      ],
    });
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'qr_draft_created',
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('draft_1');
    expect(JSON.stringify(event)).not.toContain('session_1');
    expect(JSON.stringify(event)).not.toContain('patient_1');
  });

  it('rejects QR texts duplicated in the same request instead of silently deduplicating them', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [' JAHISTC08,1 ', 'JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同じQRコードが重複しています',
      details: {
        qr_texts: ['同じQRコードを複数回読み取っています'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('does not expose raw QR texts or payload hashes in the create response', async () => {
    qrScanDraftCreateMock.mockResolvedValueOnce({
      id: 'draft_1',
      status: 'pending',
      raw_qr_texts: ['JAHISTC08,1\n1,山田 太郎'],
      qr_payload_hash: 'a'.repeat(64),
      parsed_data: {
        patientName: '山田 太郎',
        rawText: 'JAHISTC08,1\n1,山田 太郎',
        rawRecords: [{ recordType: '1', lineNumber: 2 }],
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.draft).toMatchObject({
      id: 'draft_1',
      status: 'pending',
      parsed_data: {
        patientName: '山田 太郎',
        rawRecords: [{ recordType: '1', lineNumber: 2 }],
      },
    });
    expect(body.draft).not.toHaveProperty('raw_qr_texts');
    expect(body.draft).not.toHaveProperty('qr_payload_hash');
    expect(body.draft.parsed_data).not.toHaveProperty('rawText');
  });

  it('rejects blank QR texts and blank site ids before lookup or parsing', async () => {
    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1', '   '],
        site_id: '   ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects patient_id outside the current org before saving the draft', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_other_org',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects selected patients whose master identity does not match the QR patient', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1960-06-15T00:00:00.000Z'),
      gender: 'male',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報が選択患者と一致しません',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects QR payloads whose patient identity cannot be verified', async () => {
    parseJahisQRSafeMock.mockReturnValueOnce({
      success: true,
      warnings: [],
      data: {
        patient: {
          name: '山田 太郎',
          nameKana: 'ヤマダ タロウ',
          birthDate: null,
          gender: 'male',
        },
        medications: [{ drugName: 'アムロジピン錠5mg' }],
        prescribingInstitution: {},
        dispensingInstitution: {},
        supplementalRecords: [],
        rawText: 'JAHISTC08,1',
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報を確認できません',
      details: {
        missing_identity: ['birth_date'],
      },
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects incomplete split QR page sets before saving a draft', async () => {
    parseJahisQRSafeMock.mockReturnValueOnce({
      success: true,
      warnings: [],
      data: {
        patient: {
          name: '山田 太郎',
          nameKana: 'ヤマダ タロウ',
          birthDate: '1950-03-15',
          gender: 'male',
        },
        medications: [{ drugName: 'アムロジピン錠5mg' }],
        prescribingInstitution: {},
        dispensingInstitution: {},
        supplementalRecords: [],
        splitInfo: {
          dataId: '12345678901234',
          splitCount: 2,
          sequenceNumber: 1,
        },
        rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1\n911,12345678901234,002,001'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '分割QRの枚数が不足しています。2枚中1枚です',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split QR pages whose data id does not match', async () => {
    parseJahisQRSafeMock
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'アムロジピン錠5mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 1,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'メトホルミン錠500mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          splitInfo: {
            dataId: '99999999999999',
            splitCount: 2,
            sequenceNumber: 2,
          },
          rawText: 'JAHISTC08,1\n911,99999999999999,002,002',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: [
          'JAHISTC08,1\n911,12345678901234,002,001',
          'JAHISTC08,1\n911,99999999999999,002,002',
        ],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message:
        '分割QRの識別子または総枚数が一致しません。同じ処方/お薬手帳のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split QR pages whose patient identity differs', async () => {
    parseJahisQRSafeMock
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'アムロジピン錠5mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 1,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '佐藤 花子',
            nameKana: 'サトウ ハナコ',
            birthDate: '1950-03-15',
            gender: 'female',
          },
          medications: [{ drugName: 'メトホルミン錠500mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 2,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,002',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: [
          'JAHISTC08,1\n911,12345678901234,002,001',
          'JAHISTC08,1\n911,12345678901234,002,002',
        ],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '分割QR内の患者情報が一致しません。同じ患者のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects mixed e-okusuri and outpatient prescription QR families', async () => {
    parseJahisQRSafeMock
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'アムロジピン錠5mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          rawText: 'JAHISTC08,1',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'メトホルミン錠500mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          rawText: 'JAHIS11',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1', 'JAHIS11'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '異なるJAHIS QR形式が混在しています。同じ処方/お薬手帳のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects exact duplicate QR payloads before creating another draft', async () => {
    qrScanDraftFindFirstMock.mockResolvedValueOnce({
      id: 'draft_existing',
      status: 'confirmed',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
      details: {
        duplicate_draft_id: 'draft_existing',
        status: 'confirmed',
      },
    });
    expect(qrScanDraftFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'confirmed'] },
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects unmatched duplicate QR payloads using the canonical payload hash', async () => {
    qrScanDraftFindFirstMock.mockResolvedValueOnce({
      id: 'draft_unmatched_existing',
      status: 'pending',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
      details: {
        duplicate_draft_id: 'draft_unmatched_existing',
        status: 'pending',
      },
    });
    expect(qrScanDraftFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'confirmed'] },
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('maps QR payload unique conflicts during create to workflow conflict', async () => {
    qrScanDraftCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
    });
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('fails closed when duplicate QR lookup fails', async () => {
    qrScanDraftFindFirstMock.mockRejectedValueOnce(new Error('db unavailable'));

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'QRスキャン下書きの重複確認に失敗しました',
    });
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects site_id outside the current org before QR parsing and stock mapping', async () => {
    pharmacySiteFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        site_id: 'site_other_org',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'site_other_org', org_id: 'org_1' },
      select: { id: true },
    });
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects oversized QR text before site lookup and draft creation', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [`JAHISTC08,1\n${'A'.repeat(8192)}`],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects too many QR texts before site lookup and draft creation', async () => {
    const response = await POST(
      createRequest({
        qr_texts: Array.from({ length: 17 }, () => 'JAHISTC08,1'),
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });
});
