import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  intakeFindManyMock,
  qrDraftFindManyMock,
  qrDraftCountMock,
  qrDraftFindFirstMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  intakeFindManyMock: vi.fn(),
  qrDraftFindManyMock: vi.fn(),
  qrDraftCountMock: vi.fn(),
  qrDraftFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({
      prescriptionIntake: { findMany: intakeFindManyMock },
      qrScanDraft: {
        findMany: qrDraftFindManyMock,
        count: qrDraftCountMock,
        findFirst: qrDraftFindFirstMock,
      },
    }),
}));

import { GET } from './route';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/prescription-intakes/triage${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

type IntakeFixtureArgs = {
  id: string;
  sourceType?: string;
  overallStatus?: string;
  patientId?: string;
  patientName?: string;
  prescribedDate?: Date;
  createdAt?: Date;
  institution?: string | null;
  documentUrl?: string | null;
  lines?: Array<{
    drug_name: string;
    drug_master_id?: string | null;
    drug_code?: string | null;
    dose: string;
    days: number;
    quantity: number | null;
  }>;
};

function buildIntake(args: IntakeFixtureArgs) {
  return {
    id: args.id,
    source_type: args.sourceType ?? 'fax',
    prescribed_date: args.prescribedDate ?? new Date(2026, 5, 1),
    prescriber_institution: args.institution ?? 'やまもと内科',
    prescription_category: 'regular',
    original_document_url: args.documentUrl ?? null,
    created_at: args.createdAt ?? new Date(2026, 5, 11, 9, 0),
    cycle: {
      id: `cycle_${args.id}`,
      overall_status: args.overallStatus ?? 'structuring',
      case_: {
        patient: {
          id: args.patientId ?? `patient_${args.id}`,
          name: args.patientName ?? '佐々木 ハル',
        },
      },
    },
    lines: args.lines ?? [
      {
        drug_name: 'アムロジピン 5mg',
        drug_master_id: 'drug_master_amlodipine',
        drug_code: 'YJ001',
        dose: '1錠',
        days: 28,
        quantity: null,
      },
    ],
  };
}

describe('/api/prescription-intakes/triage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    vi.clearAllMocks();
    intakeFindManyMock.mockResolvedValue([]);
    qrDraftFindManyMock.mockResolvedValue([]);
    qrDraftCountMock.mockResolvedValue(0);
    qrDraftFindFirstMock.mockResolvedValue(null);
  });

  it('経路レーン集約・トリアージ状態・件数サマリを返す', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_1',
        sourceType: 'fax',
        overallStatus: 'inquiry_resolved',
        patientName: '佐々木 ハル',
        createdAt: new Date(2026, 5, 11, 9, 35),
      }),
      buildIntake({
        id: 'intake_2',
        sourceType: 'e_prescription',
        overallStatus: 'intake_received',
        patientName: '鈴木 新',
        institution: 'きたきゅうケアプラン',
        createdAt: new Date(2026, 5, 11, 9, 12),
      }),
      buildIntake({
        id: 'intake_3',
        sourceType: 'paper',
        overallStatus: 'intake_received',
        patientName: '渡辺 フミ',
        institution: 'ご家族',
        createdAt: new Date(2026, 5, 10, 16, 5),
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    const data = body.data;

    expect(data.lane_counts).toEqual({ fax: 1, online: 1, walk_in: 1 });
    expect(data.new_today_count).toBe(2);
    // 受入判断待ち(オンライン新着)1 件だけが人の判断待ち
    expect(data.needs_decision_count).toBe(1);

    const [first, second, third] = data.rows;
    expect(first.status).toBe('unblock_related');
    expect(first.action).toBe('send_to_entry');
    expect(first.content_label).toBe('処方変更(照会回答の反映)');
    expect(second.status).toBe('acceptance_pending');
    expect(second.action).toBe('to_dashboard');
    expect(third.status).toBe('imported');
    expect(third.action).toBe('to_card');
  });

  it('同一患者×発行日×Rp構成の一致を重複の疑いにする(新しい方)', async () => {
    const sharedLines = [
      { drug_name: 'メトホルミン 250mg', dose: '2錠', days: 28, quantity: null },
    ];
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_takahashi',
        patientName: '高橋 茂',
        overallStatus: 'structuring',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: sharedLines,
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_takahashi',
        patientName: '高橋 茂',
        overallStatus: 'audit_pending',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: sharedLines,
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    const oldRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_old');
    expect(newRow.status).toBe('duplicate_suspected');
    expect(newRow.action).toBe('compare');
    expect(newRow.duplicate_of_date).toBe('6/9');
    // 既存(古い方)はそのまま工程由来の状態
    expect(oldRow.status).toBe('entered_in_progress');
    expect(oldRow.action).toBe('to_audit');
    expect(oldRow.rx_number).toMatch(/^RX-2026-/);

    expect(data.duplicate_notices).toHaveLength(1);
    expect(data.duplicate_notices[0]).toMatchObject({
      intake_id: 'intake_new',
      patient_name: '高橋 茂',
      matched_date: '6/9',
    });
  });

  it('同名でも医薬品コードが異なる処方は重複疑いにしない', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_code_split',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: [
          {
            drug_name: '同名薬',
            drug_code: 'YJ002',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_code_split',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: [
          {
            drug_name: '同名薬',
            drug_code: 'YJ001',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    expect(newRow.status).toBe('entry_pending');
    expect(newRow.action).toBe('send_to_entry');
    expect(newRow.duplicate_of_date).toBeNull();
    expect(data.duplicate_notices).toEqual([]);
  });

  it('同一医薬品コードなら表示名が揺れても重複疑いにする', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_code_same',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: [
          {
            drug_name: 'アムロジピンOD錠5mg',
            drug_code: 'YJ001',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_code_same',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_code: 'YJ001',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    expect(newRow.status).toBe('duplicate_suspected');
    expect(newRow.action).toBe('compare');
    expect(newRow.duplicate_of_date).toBe('6/9');
    expect(data.duplicate_notices).toHaveLength(1);
  });

  it('同一医薬品マスターなら医薬品コードが揺れても重複疑いにする', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_master_same',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: [
          {
            drug_name: 'アムロジピンOD錠5mg',
            drug_master_id: 'drug_master_amlodipine_5',
            drug_code: 'YJ_NEW',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_master_same',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_master_id: 'drug_master_amlodipine_5',
            drug_code: 'YJ_OLD',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    expect(newRow.status).toBe('duplicate_suspected');
    expect(newRow.action).toBe('compare');
    expect(newRow.duplicate_of_date).toBe('6/9');
    expect(data.duplicate_notices).toHaveLength(1);
  });

  it('片方だけ医薬品マスター解決済みでも同一医薬品コードなら重複疑いにする', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_mixed_resolution',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_master_id: 'drug_master_amlodipine_5',
            drug_code: 'YJ001',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_mixed_resolution',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: [
          {
            drug_name: 'アムロジピン錠5mg',
            drug_master_id: null,
            drug_code: 'YJ001',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    expect(newRow.status).toBe('duplicate_suspected');
    expect(newRow.action).toBe('compare');
    expect(newRow.duplicate_of_date).toBe('6/9');
    expect(data.duplicate_notices).toHaveLength(1);
  });

  it('同一医薬品コードでも医薬品マスターが異なる処方は重複疑いにしない', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({
        id: 'intake_new',
        patientId: 'patient_master_split',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 11, 8, 55),
        lines: [
          {
            drug_name: '同一コード別マスター薬A',
            drug_master_id: 'drug_master_a',
            drug_code: 'YJ_SHARED',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
      buildIntake({
        id: 'intake_old',
        patientId: 'patient_master_split',
        prescribedDate: new Date(2026, 5, 8),
        createdAt: new Date(2026, 5, 9, 10, 0),
        lines: [
          {
            drug_name: '同一コード別マスター薬B',
            drug_master_id: 'drug_master_b',
            drug_code: 'YJ_SHARED',
            dose: '1錠',
            days: 28,
            quantity: null,
          },
        ],
      }),
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    const newRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_new');
    expect(newRow.status).toBe('entry_pending');
    expect(newRow.action).toBe('send_to_entry');
    expect(newRow.duplicate_of_date).toBeNull();
    expect(data.duplicate_notices).toEqual([]);
  });

  it('根拠・記録(元FAX画像/読取モデルの版/破棄ログ)を集計する', async () => {
    intakeFindManyMock.mockResolvedValue([
      buildIntake({ id: 'intake_1', sourceType: 'fax', documentUrl: 'https://s3/doc1.pdf' }),
      buildIntake({
        id: 'intake_2',
        sourceType: 'qr_scan',
        patientId: 'p2',
        documentUrl: null,
      }),
    ]);
    qrDraftFindManyMock.mockResolvedValue([
      {
        confirmed_intake_id: 'intake_2',
        parse_errors: [],
        auto_completed: [{ field: 'dose' }],
      },
    ]);
    qrDraftCountMock.mockResolvedValue(2);
    qrDraftFindFirstMock.mockResolvedValue({ schema_version: 1 });

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    expect(data.evidence).toEqual({
      fax_document_count: 1,
      reader_model_version: 'v1',
      discard_count_this_month: 2,
    });
    // QR 由来の行だけ確からしさ % を持つ(解析エラー0・自動補完1 → 99)
    const qrRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_2');
    const faxRow = data.rows.find((row: { intake_id: string }) => row.intake_id === 'intake_1');
    expect(qrRow.auto_read_percent).toBe(99);
    expect(faxRow.auto_read_percent).toBeNull();
  });

  it('不正な limit はバリデーションエラー', async () => {
    const res = await GET(createRequest('?limit=999'), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expectNoStore(res);
  });

  it('returns a sanitized no-store 500 when prescription intake triage fails unexpectedly', async () => {
    intakeFindManyMock.mockRejectedValueOnce(
      new Error('raw prescription intake patient medication secret'),
    );

    const res = await GET(createRequest(), { params: Promise.resolve({}) });

    expect(res.status).toBe(500);
    expectNoStore(res);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient medication secret');
  });
});
