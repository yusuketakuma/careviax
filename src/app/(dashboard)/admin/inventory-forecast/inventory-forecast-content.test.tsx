// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { InventoryForecastContent } from './inventory-forecast-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function renderContent() {
  return render(<InventoryForecastContent />, { wrapper: createQueryClientWrapper() });
}

describe('InventoryForecastContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/admin/inventory-forecast') {
          return new Response('{}', { status: 404 });
        }

        return new Response(
          JSON.stringify({
            data: {
              week: { start_date: '2026-06-22', end_date: '2026-06-28' },
              drugs: [
                {
                  drugIdentityKey: 'code:YJ_AMLO',
                  drugCode: 'YJ_AMLO',
                  drugKey: 'アムロジピン',
                  requiredQty: 14,
                  stockQty: 4,
                  unit: '錠',
                  status: 'order_required',
                  stockRegistered: true,
                  stockEvidence: 'registered_stock',
                },
                {
                  drugIdentityKey: 'name:酸化Mg',
                  drugCode: null,
                  drugKey: '酸化Mg',
                  requiredQty: 7,
                  stockQty: 10,
                  unit: '包',
                  status: 'sufficient',
                  stockRegistered: true,
                  stockEvidence: 'registered_stock',
                },
              ],
              patients: [
                {
                  key: 'patient_1',
                  patientId: 'p1',
                  label: '患者A',
                  firstVisitDateKey: '2026-06-23',
                  isFacilityBatch: false,
                  facilityPatientCount: null,
                  shortagePatientCount: 1,
                  dataBackedPatientCount: 1,
                  shortageDrugKeys: ['アムロジピン'],
                  runOutDateKey: '2026-06-23',
                  runOutBasis: 'line_end_date',
                  urgency: 'critical',
                  shortageDetails: [
                    {
                      drugIdentityKey: 'code:YJ_AMLO',
                      drugCode: 'YJ_AMLO',
                      drugKey: 'アムロジピン',
                      requiredQty: 14,
                      stockQty: 4,
                      unit: '錠',
                      status: 'order_required',
                      stockRegistered: true,
                      stockEvidence: 'registered_stock',
                      affectedPatientCount: 1,
                      runOutDateKey: '2026-06-23',
                      runOutBasis: 'line_end_date',
                      urgency: 'critical',
                    },
                  ],
                },
                {
                  key: 'facility-batch:f1',
                  patientId: null,
                  label: '施設A 5名',
                  firstVisitDateKey: '2026-06-24',
                  isFacilityBatch: true,
                  facilityPatientCount: 5,
                  shortagePatientCount: 2,
                  dataBackedPatientCount: 2,
                  shortageDrugKeys: ['酸化Mg'],
                  runOutDateKey: '2026-06-30',
                  runOutBasis: 'line_start_date_plus_days',
                  urgency: 'warning',
                  shortageDetails: [],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );
  });

  it('keeps drug forecast table searchable without adding patient-list search controls', async () => {
    renderContent();

    expect(await screen.findByRole('heading', { name: '在庫と定期処方の予測' })).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/admin/inventory-forecast', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect((await screen.findAllByText('アムロジピン')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('薬剤別必要量内検索')).toBeTruthy();
    expect(screen.getByRole('button', { name: '列' })).toBeTruthy();
    expect(screen.getAllByText('要発注').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('14錠').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('YJ_AMLO').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('患者A 様')).toBeTruthy();
    expect(screen.queryByLabelText('影響患者内検索')).toBeNull();
  });

  it('renders the decision summary as shared StatCards (state color only where meaningful)', async () => {
    renderContent();

    await screen.findByRole('heading', { name: '在庫と定期処方の予測' });

    // 旧 SummaryCard の語彙を共通 StatCard でも維持する。
    expect(screen.getAllByText('要発注').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('発注候補')).toBeTruthy();
    expect(screen.getByText('影響患者')).toBeTruthy();
    expect(screen.getByText('最優先')).toBeTruthy();
    // 単位は value に埋め込まず「件」を分離(StatCard の数値整列を活かす)。
    expect(screen.getAllByText('件').length).toBeGreaterThanOrEqual(3);
    // 最優先は薬剤ベース名(非数値) + 充足率 hint。アムロジピンは表と StatCard の双方に出る。
    expect(screen.getAllByText('アムロジピン').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/充足率/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders truthful run-out date, urgency, and facility coverage from the DTO', async () => {
    renderContent();

    expect(await screen.findByText('患者A 様')).toBeTruthy();
    // 来週初回訪問日を「訪問予定 M/D」と明示する(データに忠実)。
    expect(screen.getByText(/訪問予定\s*06\/23/)).toBeTruthy();
    // 個人カード: critical=至急バッジ + 処方終了日由来の薬切れ見込み(推定注記なし)。
    expect(screen.getByText('至急')).toBeTruthy();
    expect(screen.getByText('薬切れ見込み 06/23')).toBeTruthy();
    expect(screen.getByText('不足薬: アムロジピン')).toBeTruthy();
    // 施設バッチ: warning=要注意 + 開始日+日数の推定注記 + 「5名中 2名に不足/在庫登録確認」の被覆明示。
    expect(screen.getByText('要注意')).toBeTruthy();
    expect(screen.getByText('薬切れ見込み 06/30（処方日数から推定）')).toBeTruthy();
    expect(screen.getByText(/5名中\s*2名に不足\/在庫登録確認/)).toBeTruthy();
  });

  it('does not fabricate a run-out date when basis is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/admin/inventory-forecast') {
          return new Response('{}', { status: 404 });
        }
        return new Response(
          JSON.stringify({
            data: {
              week: { start_date: '2026-06-22', end_date: '2026-06-28' },
              drugs: [
                {
                  drugIdentityKey: 'code:YJ_AMLO',
                  drugCode: 'YJ_AMLO',
                  drugKey: 'アムロジピン',
                  requiredQty: 14,
                  stockQty: 4,
                  unit: '錠',
                  status: 'order_required',
                  stockRegistered: true,
                  stockEvidence: 'registered_stock',
                },
              ],
              patients: [
                {
                  key: 'patient_2',
                  patientId: 'p2',
                  label: '患者B',
                  firstVisitDateKey: '2026-06-25',
                  isFacilityBatch: false,
                  facilityPatientCount: null,
                  shortagePatientCount: 1,
                  dataBackedPatientCount: 1,
                  shortageDrugKeys: ['アムロジピン'],
                  runOutDateKey: null,
                  runOutBasis: 'unknown',
                  urgency: 'unknown',
                  shortageDetails: [],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }),
    );
    renderContent();

    expect(await screen.findByText('患者B 様')).toBeTruthy();
    expect(screen.getByText('薬切れ見込み日: 算出不可（処方期間情報なし）')).toBeTruthy();
    expect(screen.getByText('予定日不明')).toBeTruthy();
  });

  it('surfaces unresolved prescription demand separately from automatic shortage matching', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/admin/inventory-forecast') {
          return new Response('{}', { status: 404 });
        }
        return new Response(
          JSON.stringify({
            data: {
              week: { start_date: '2026-06-22', end_date: '2026-06-28' },
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
          }),
          { status: 200 },
        );
      }),
    );
    renderContent();

    expect(await screen.findByRole('heading', { name: 'コード未解決の処方需要' })).toBeTruthy();
    expect(screen.getByText('1件 要確認')).toBeTruthy();
    expect(screen.getByText('同名薬')).toBeTruthy();
    expect(screen.getByText('マスター未一致: BADCODE')).toBeTruthy();
    expect(screen.getByText('7錠')).toBeTruthy();
    expect(screen.getByText('1名分')).toBeTruthy();
    expect(
      screen.getByText('来週の訪問予定と在庫登録から計算できる薬剤がありません。'),
    ).toBeTruthy();
  });

  it('keeps resolved demand visible when the adopted stock record is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== '/api/admin/inventory-forecast') {
          return new Response('{}', { status: 404 });
        }
        return new Response(
          JSON.stringify({
            data: {
              week: { start_date: '2026-06-22', end_date: '2026-06-28' },
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
                {
                  key: 'patient_no_stock',
                  patientId: 'p-no-stock',
                  label: '在庫未登録 患者',
                  firstVisitDateKey: '2026-06-23',
                  isFacilityBatch: false,
                  facilityPatientCount: null,
                  shortagePatientCount: 1,
                  dataBackedPatientCount: 1,
                  shortageDrugKeys: ['未採用薬'],
                  runOutDateKey: '2026-07-07',
                  runOutBasis: 'line_start_date_plus_days',
                  urgency: 'normal',
                  shortageDetails: [
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
          }),
          { status: 200 },
        );
      }),
    );
    renderContent();

    expect((await screen.findAllByText('未採用薬')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('在庫未登録').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('未登録').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('登録確認').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('未確認').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('在庫登録確認')).toBeTruthy();
    expect(screen.getByText('未採用薬の在庫登録を確認')).toBeTruthy();
    expect(screen.getByText('在庫未登録 患者 様')).toBeTruthy();
    expect(screen.getByText('在庫登録未確認: 未採用薬')).toBeTruthy();
    expect(screen.queryByText('不足薬: 未採用薬')).toBeNull();
  });
});
