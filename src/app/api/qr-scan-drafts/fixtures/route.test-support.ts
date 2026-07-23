import { afterEach, beforeEach, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestAuthContext = { orgId: string; userId: string; role: 'pharmacist' };
type TestRouteContext = { params: Promise<Record<string, string>> };
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
type NextRequestInitWithDuplex = NextRequestInit & { duplex: 'half' };

const {
  withAuthContextMock,
  withOrgContextMock,
  qrScanDraftFindManyMock,
  qrScanDraftCountMock,
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  patientFindFirstMock,
  pharmacySiteFindFirstMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  jahisSupplementalRecordDeleteManyMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  isJahisQRMock,
  parseJahisQRSafeMock,
  mergeJahisQrPageTextsMock,
  detectMultiQRMock,
  hasJahisQrSplitRecordMock,
  mapJahisToIntakeMock,
  canAccessPrescriptionPatientMock,
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
  qrScanDraftFindManyMock: vi.fn(),
  qrScanDraftCountMock: vi.fn(),
  qrScanDraftFindFirstMock: vi.fn().mockResolvedValue(null),
  qrScanDraftCreateMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn().mockResolvedValue({ id: 'case_1' }),
  careCaseFindManyMock: vi.fn().mockResolvedValue([]),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  jahisSupplementalRecordCreateManyMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
  isJahisQRMock: vi.fn().mockReturnValue(true),
  parseJahisQRSafeMock: vi.fn(),
  mergeJahisQrPageTextsMock: vi.fn(),
  detectMultiQRMock: vi.fn().mockReturnValue(null),
  hasJahisQrSplitRecordMock: vi.fn().mockReturnValue(false),
  mapJahisToIntakeMock: vi.fn(),
  canAccessPrescriptionPatientMock: vi.fn().mockResolvedValue(true),
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
      findMany: careCaseFindManyMock,
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
  mergeJahisQrPageTexts: mergeJahisQrPageTextsMock,
  detectMultiQR: detectMultiQRMock,
  hasJahisQrSplitRecord: hasJahisQrSplitRecordMock,
}));

vi.mock('@/lib/pharmacy/qr-intake-mapper', () => ({
  mapJahisToIntake: mapJahisToIntakeMock,
}));

vi.mock('@/server/services/prescription-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/services/prescription-access')>()),
  canAccessPrescriptionPatient: canAccessPrescriptionPatientMock,
}));

import { GET as rawGET, POST as rawPOST } from '../route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
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

function createStreamRequest(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  const init: NextRequestInitWithDuplex = {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    duplex: 'half',
  };
  return new NextRequest('http://localhost/api/qr-scan-drafts', init);
}

function createChunkedRequest(chunks: readonly Uint8Array[], headers: Record<string, string> = {}) {
  return createStreamRequest(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    headers,
  );
}

function createGetRequest(url = 'http://localhost/api/qr-scan-drafts') {
  return new NextRequest(url, { method: 'GET' });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('pragma')).toBe('no-cache');
}

export function getQrScanDraftRouteTestSupport() {
  return {
    withOrgContextMock,
    qrScanDraftFindManyMock,
    qrScanDraftCountMock,
    qrScanDraftFindFirstMock,
    qrScanDraftCreateMock,
    patientFindFirstMock,
    pharmacySiteFindFirstMock,
    jahisSupplementalRecordDeleteManyMock,
    jahisSupplementalRecordCreateManyMock,
    broadcastStatusUpdateMock,
    isJahisQRMock,
    parseJahisQRSafeMock,
    mergeJahisQrPageTextsMock,
    detectMultiQRMock,
    hasJahisQrSplitRecordMock,
    mapJahisToIntakeMock,
    canAccessPrescriptionPatientMock,
    GET,
    POST,
    createRequest,
    createMalformedJsonRequest,
    createStreamRequest,
    createChunkedRequest,
    createGetRequest,
    expectSensitiveNoStore,
  };
}

export function registerQrScanDraftGlobalHooks() {
  afterEach(() => {
    vi.useRealTimers();
  });
}

export function registerQrScanDraftGetBeforeEach() {
  beforeEach(() => {
    vi.clearAllMocks();
    qrScanDraftFindManyMock.mockResolvedValue([
      {
        id: 'draft_1',
        status: 'pending',
        patient_id: null,
        raw_qr_texts: ['secret'],
        qr_payload_hash: 'hash_1',
        parsed_data: { patient: { name: '山田 太郎' }, rawText: 'secret text' },
        created_at: new Date('2026-06-16T00:00:00.000Z'),
      },
    ]);
    qrScanDraftCountMock.mockResolvedValue(3);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findMany: qrScanDraftFindManyMock,
          count: qrScanDraftCountMock,
        },
      }),
    );
  });
}

export function registerQrScanDraftPostBeforeEach() {
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
    hasJahisQrSplitRecordMock.mockReturnValue(false);
    mergeJahisQrPageTextsMock.mockImplementation((pages: string[]) => pages[0]);
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
          drug_code: null,
          source_drug_code: 'RC_AMLO',
          source_drug_code_type: 'receipt',
          drug_code_resolution_status: 'review_required',
          drug_code_resolution_source: 'drug_master_name_fallback',
          candidate_drug_master_id: 'drug_1',
          candidate_drug_code: '2149001',
          candidate_drug_name: 'アムロジピン錠5mg',
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
        {
          lineIndex: 0,
          drugName: '薬A',
          drugCode: null,
          reason: 'no_code_provided',
          requiresReview: true,
          suggestedDrugMasterId: 'drug_1',
          suggestedDrugCode: '2149001',
          suggestedDrugName: 'アムロジピン錠5mg',
        },
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
}
