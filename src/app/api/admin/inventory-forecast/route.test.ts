import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  visitScheduleFindManyMock,
  drugStockFindManyMock,
  intakeFindManyMock,
  facilityFindManyMock,
  drugMasterFindManyMock,
} = vi.hoisted(() => ({
  visitScheduleFindManyMock: vi.fn(),
  drugStockFindManyMock: vi.fn(),
  intakeFindManyMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'admin' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: { findMany: visitScheduleFindManyMock },
    pharmacyDrugStock: { findMany: drugStockFindManyMock },
    prescriptionIntake: { findMany: intakeFindManyMock },
    facility: { findMany: facilityFindManyMock },
    drugMaster: { findMany: drugMasterFindManyMock },
  },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const routeGET = (req: NextRequest) => GET(req, emptyRouteContext);

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    case_id: 'case_tanaka',
    scheduled_date: new Date('2026-06-15T00:00:00.000Z'),
    case_: { patient: { id: 'pt_tanaka', name: '田中 一郎' } },
    facility_batch: null,
    ...overrides,
  };
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/admin/inventory-forecast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 2026-06-10(水)固定 → 来週 = 2026-06-15(月)〜2026-06-21(日)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T09:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries next-week schedules (excluding cancelled) and joins stock', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      visitRow(),
      visitRow({
        case_id: 'case_res1',
        scheduled_date: new Date('2026-06-18T00:00:00.000Z'),
        case_: { patient: { id: 'pt_res1', name: '山田 ウメ' } },
        facility_batch: {
          id: 'batch_a',
          facility_id: 'fac_a',
          patient_ids: ['pt_res1', 'pt_res2', 'pt_r1', 'pt_r2', 'pt_r3'],
        },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([{ id: 'fac_a', name: '施設A' }]);
    intakeFindManyMock.mockResolvedValue([
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_tanaka' },
        lines: [
          {
            drug_name: 'アムロジピン 5mg',
            drug_code: 'YJ_AMLO',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: new Date('2026-06-16T00:00:00.000Z'),
          },
        ],
      },
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_res1' },
        lines: [
          {
            drug_name: 'トラセミド 4mg',
            drug_code: 'YJ_TORA',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-10T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([
      { id: 'drug_amlo', yj_code: 'YJ_AMLO', receipt_code: null, hot_code: null },
      { id: 'drug_tora', yj_code: 'YJ_TORA', receipt_code: null, hot_code: null },
    ]);
    drugStockFindManyMock.mockResolvedValue([
      {
        stock_qty: 4,
        drug_master: {
          id: 'drug_amlo',
          yj_code: 'YJ_AMLO',
          drug_name: 'アムロジピン 5mg',
          drug_name_kana: 'アムロジピン',
          unit: '錠',
        },
      },
      {
        stock_qty: 3,
        drug_master: {
          id: 'drug_tora',
          yj_code: 'YJ_TORA',
          drug_name: 'トラセミド 4mg',
          drug_name_kana: 'トラセミド',
          unit: '錠',
        },
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        week: { start_date: '2026-06-15', end_date: '2026-06-21' },
        drugs: [
          // アムロジピン: 1錠/日 × 7 = 7 / 在庫4 → 発注候補(4 >= 3.5)
          {
            drugIdentityKey: 'master:drug_amlo',
            drugCode: 'YJ_AMLO',
            drugKey: 'アムロジピン',
            requiredQty: 7,
            stockQty: 4,
            unit: '錠',
            status: 'order_candidate',
            stockRegistered: true,
            stockEvidence: 'registered_stock',
          },
          // トラセミド: 1錠/日 × 7 = 7 / 在庫3 → 要発注(3 < 3.5)
          {
            drugIdentityKey: 'master:drug_tora',
            drugCode: 'YJ_TORA',
            drugKey: 'トラセミド',
            requiredQty: 7,
            stockQty: 3,
            unit: '錠',
            status: 'order_required',
            stockRegistered: true,
            stockEvidence: 'registered_stock',
          },
        ],
        patients: [
          {
            key: 'patient:pt_tanaka',
            patientId: 'pt_tanaka',
            label: '田中 一郎',
            firstVisitDateKey: '2026-06-15',
            isFacilityBatch: false,
            facilityPatientCount: null,
            shortagePatientCount: 1,
            dataBackedPatientCount: 1,
            shortageDrugKeys: ['アムロジピン'],
            runOutDateKey: '2026-06-16',
            runOutBasis: 'line_end_date',
            urgency: 'warning',
            shortageDetails: [
              {
                drugIdentityKey: 'master:drug_amlo',
                drugCode: 'YJ_AMLO',
                drugKey: 'アムロジピン',
                requiredQty: 7,
                stockQty: 4,
                unit: '錠',
                status: 'order_candidate',
                stockRegistered: true,
                stockEvidence: 'registered_stock',
                affectedPatientCount: 1,
                runOutDateKey: '2026-06-16',
                runOutBasis: 'line_end_date',
                urgency: 'warning',
              },
            ],
          },
          {
            key: 'facility-batch:batch_a',
            patientId: null,
            label: '施設A 5名',
            firstVisitDateKey: '2026-06-18',
            isFacilityBatch: true,
            facilityPatientCount: 5,
            shortagePatientCount: 1,
            dataBackedPatientCount: 1,
            shortageDrugKeys: ['トラセミド'],
            runOutDateKey: '2026-07-07',
            runOutBasis: 'line_start_date_plus_days',
            urgency: 'normal',
            shortageDetails: [
              {
                drugIdentityKey: 'master:drug_tora',
                drugCode: 'YJ_TORA',
                drugKey: 'トラセミド',
                requiredQty: 7,
                stockQty: 3,
                unit: '錠',
                status: 'order_required',
                stockRegistered: true,
                stockEvidence: 'registered_stock',
                affectedPatientCount: 1,
                runOutDateKey: '2026-07-07',
                runOutBasis: 'line_start_date_plus_days',
                urgency: 'normal',
              },
            ],
          },
        ],
        unresolvedDrugs: [],
      },
    });

    // 来週レンジ(@db.Date 境界)+ cancelled 除外で照会していること
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          scheduled_date: {
            gte: new Date('2026-06-15T00:00:00.000Z'),
            lt: new Date('2026-06-22T00:00:00.000Z'),
          },
          schedule_status: { not: 'cancelled' },
        }),
      }),
    );
    // 訪問予定患者のケースに絞って処方を照会していること
    expect(intakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          cycle: { case_id: { in: ['case_tanaka', 'case_res1'] } },
        }),
        select: expect.objectContaining({
          lines: {
            select: expect.objectContaining({
              drug_code: true,
              start_date: true,
              end_date: true,
            }),
          },
        }),
      }),
    );
    // 施設名はバッチの facility_id から org スコープで解決していること
    expect(facilityFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['fac_a'] }, org_id: 'org_1' },
      }),
    );
    expect(drugStockFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          drug_master: {
            select: expect.objectContaining({
              id: true,
              yj_code: true,
            }),
          },
        }),
      }),
    );
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { yj_code: { in: ['YJ_AMLO', 'YJ_TORA'] } },
            { receipt_code: { in: ['YJ_AMLO', 'YJ_TORA'] } },
            { hot_code: { in: ['YJ_AMLO', 'YJ_TORA'] } },
          ],
        },
      }),
    );
  });

  it('returns empty aggregates without querying intakes when no visits exist', async () => {
    visitScheduleFindManyMock.mockResolvedValue([]);
    drugStockFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: {
        week: { start_date: '2026-06-15', end_date: '2026-06-21' },
        drugs: [],
        patients: [],
        unresolvedDrugs: [],
      },
    });
    expect(intakeFindManyMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(facilityFindManyMock).not.toHaveBeenCalled();
  });

  it('resolves prescription line receipt and HOT codes to DrugMaster identity before forecasting', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      visitRow({
        case_id: 'case_receipt',
        case_: { patient: { id: 'pt_receipt', name: '患者R' } },
      }),
      visitRow({
        case_id: 'case_hot',
        scheduled_date: new Date('2026-06-16T00:00:00.000Z'),
        case_: { patient: { id: 'pt_hot', name: '患者H' } },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([]);
    intakeFindManyMock.mockResolvedValue([
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_receipt' },
        lines: [
          {
            drug_name: 'レセ電コード薬',
            drug_code: '123456789',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_hot' },
        lines: [
          {
            drug_name: 'HOTコード薬',
            drug_code: '1234567890123',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_receipt',
        yj_code: '111111111111',
        receipt_code: '123456789',
        hot_code: null,
      },
      {
        id: 'drug_hot',
        yj_code: '222222222222',
        receipt_code: null,
        hot_code: '1234567890123',
      },
    ]);
    drugStockFindManyMock.mockResolvedValue([
      {
        stock_qty: 3,
        drug_master: {
          id: 'drug_receipt',
          yj_code: '111111111111',
          drug_name: 'レセ電コード薬',
          drug_name_kana: 'レセデンコードヤク',
          unit: '錠',
        },
      },
      {
        stock_qty: 3,
        drug_master: {
          id: 'drug_hot',
          yj_code: '222222222222',
          drug_name: 'HOTコード薬',
          drug_name_kana: 'ホットコードヤク',
          unit: '錠',
        },
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        drugs: expect.arrayContaining([
          expect.objectContaining({
            drugIdentityKey: 'master:drug_receipt',
            drugCode: '111111111111',
            status: 'order_required',
          }),
          expect.objectContaining({
            drugIdentityKey: 'master:drug_hot',
            drugCode: '222222222222',
            status: 'order_required',
          }),
        ]),
        unresolvedDrugs: [],
      },
    });
    expect(drugMasterFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { yj_code: { in: ['123456789', '1234567890123'] } },
            { receipt_code: { in: ['123456789', '1234567890123'] } },
            { hot_code: { in: ['123456789', '1234567890123'] } },
          ],
        },
      }),
    );
  });

  it('surfaces resolved prescription demand even when no adopted stock row exists', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      visitRow({
        case_id: 'case_no_stock',
        case_: { patient: { id: 'pt_no_stock', name: '在庫未登録 患者' } },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([]);
    intakeFindManyMock.mockResolvedValue([
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_no_stock' },
        lines: [
          {
            drug_name: '未採用薬 10mg',
            drug_code: 'YJ_NO_STOCK',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_no_stock',
        yj_code: 'YJ_NO_STOCK',
        receipt_code: null,
        hot_code: null,
      },
    ]);
    drugStockFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        drugs: [
          {
            drugIdentityKey: 'master:drug_no_stock',
            drugCode: 'YJ_NO_STOCK',
            drugKey: '未採用薬',
            requiredQty: 7,
            stockQty: 0,
            unit: '錠',
            status: 'order_required',
            stockRegistered: false,
            stockEvidence: 'missing_adopted_stock_record',
          },
        ],
        patients: [
          expect.objectContaining({
            key: 'patient:pt_no_stock',
            shortageDrugKeys: ['未採用薬'],
            shortageDetails: [
              expect.objectContaining({
                drugIdentityKey: 'master:drug_no_stock',
                drugCode: 'YJ_NO_STOCK',
                stockQty: 0,
                status: 'order_required',
                stockRegistered: false,
                stockEvidence: 'missing_adopted_stock_record',
              }),
            ],
          }),
        ],
        unresolvedDrugs: [],
      },
    });
  });

  it('keeps code-not-found prescription demand visible without auto-joining same-name stock', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      visitRow({
        case_id: 'case_bad_code',
        case_: { patient: { id: 'pt_bad_code', name: '未収載 患者' } },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([]);
    intakeFindManyMock.mockResolvedValue([
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_bad_code' },
        lines: [
          {
            drug_name: '同名薬 5mg',
            drug_code: 'BADCODE',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([]);
    drugStockFindManyMock.mockResolvedValue([
      {
        stock_qty: 0,
        drug_master: {
          id: 'drug_same_name',
          yj_code: 'YJ_SAME_NAME',
          drug_name: '同名薬 5mg',
          drug_name_kana: 'ドウメイヤク',
          unit: '錠',
        },
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        drugs: [],
        patients: [],
        unresolvedDrugs: [
          {
            drugIdentityKey: 'unresolved-code:BADCODE',
            drugCode: 'BADCODE',
            reason: 'code_not_found',
            drugKey: '同名薬',
            requiredQty: 7,
            unit: '錠',
            affectedPatientCount: 1,
          },
        ],
      },
    });
  });

  it('treats duplicate receipt/HOT candidates as unresolved instead of choosing by DB order', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      visitRow({
        case_id: 'case_ambiguous',
        case_: { patient: { id: 'pt_ambiguous', name: '候補複数 患者' } },
      }),
    ]);
    facilityFindManyMock.mockResolvedValue([]);
    intakeFindManyMock.mockResolvedValue([
      {
        prescribed_date: new Date('2026-06-08T00:00:00.000Z'),
        created_at: new Date('2026-06-08T10:00:00.000Z'),
        cycle: { patient_id: 'pt_ambiguous' },
        lines: [
          {
            drug_name: '候補複数薬',
            drug_code: '123456789',
            dose: '1錠',
            frequency: '朝',
            days: 28,
            quantity: 28,
            unit: '錠',
            start_date: new Date('2026-06-08T00:00:00.000Z'),
            end_date: null,
          },
        ],
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_candidate_a',
        yj_code: '111111111111',
        receipt_code: '123456789',
        hot_code: null,
      },
      {
        id: 'drug_candidate_b',
        yj_code: '222222222222',
        receipt_code: '123456789',
        hot_code: null,
      },
    ]);
    drugStockFindManyMock.mockResolvedValue([
      {
        stock_qty: 0,
        drug_master: {
          id: 'drug_candidate_a',
          yj_code: '111111111111',
          drug_name: '候補複数薬',
          drug_name_kana: 'コウホフクスウヤク',
          unit: '錠',
        },
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        drugs: [],
        patients: [],
        unresolvedDrugs: [
          {
            drugIdentityKey: 'unresolved-code:123456789',
            drugCode: '123456789',
            reason: 'ambiguous_code',
            drugKey: '候補複数薬',
            requiredQty: 7,
            unit: '錠',
            affectedPatientCount: 1,
          },
        ],
      },
    });
  });

  it('returns a fixed no-store 500 envelope without leaking raw forecast errors', async () => {
    visitScheduleFindManyMock.mockRejectedValueOnce(
      new Error('raw patient inventory forecast secret'),
    );
    drugStockFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/admin/inventory-forecast'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain('raw patient inventory forecast secret');
    expect(payload).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
  });
});
