import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  patientFindFirstMock,
  jahisSupplementalRecordDeleteManyMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  parseJahisQRSafeMock,
  mergeJahisQRPagesMock,
  detectMultiQRMock,
  mapJahisToIntakeMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    },
  ),
  withOrgContextMock: vi.fn(),
  qrScanDraftFindFirstMock: vi.fn().mockResolvedValue(null),
  qrScanDraftCreateMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  jahisSupplementalRecordCreateManyMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
  parseJahisQRSafeMock: vi.fn(),
  mergeJahisQRPagesMock: vi.fn(),
  detectMultiQRMock: vi.fn().mockReturnValue(null),
  mapJahisToIntakeMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
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
  },
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

vi.mock('@/lib/pharmacy/jahis-qr', () => ({
  isJahisQR: vi.fn().mockReturnValue(true),
  parseJahisQRSafe: parseJahisQRSafeMock,
  mergeJahisQRPages: mergeJahisQRPagesMock,
  detectMultiQR: detectMultiQRMock,
}));

vi.mock('@/lib/pharmacy/qr-intake-mapper', () => ({
  mapJahisToIntake: mapJahisToIntakeMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/qr-scan-drafts POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
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
        remarks: ['一包化'],
        patientNotes: ['他職種共有あり'],
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

  it('persists enriched parsed_data from the QR mapper', async () => {
    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(mapJahisToIntakeMock).toHaveBeenCalled();
    expect(qrScanDraftCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patient_id: 'patient_1',
          parsed_data: expect.objectContaining({
            patientName: '山田 太郎',
            prescriberInstitutionId: 'inst_1',
            unmatchedDrugs: expect.any(Array),
            formularyStatus: expect.any(Array),
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
    expect(broadcastStatusUpdateMock).toHaveBeenCalled();
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
});
