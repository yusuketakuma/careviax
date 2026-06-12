// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { PatientWorkspace } from './patient-detail.types';

const useQueryMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

import { CardWorkspace } from './card-workspace';

setupDomTestEnv();

function buildWorkspace(overrides: Partial<PatientWorkspace> = {}): PatientWorkspace {
  return {
    cycle_id: 'cycle_1',
    overall_status: 'dispensed',
    exception_status: null,
    current_intake: {
      id: 'intake_0500',
      prescribed_date: '2026-06-09T00:00:00.000Z',
      prescription_category: 'regular',
    },
    safety: {
      allergy: 'セフェム系(2019)',
      renal: 'eGFR 38(6/1)',
      handling_tags: ['narcotic', 'cold_storage', 'unit_dose'],
      swallowing: '錠剤OK・大きい錠は半割',
      cautions: ['ふらつき(6/5〜経過観察)'],
    },
    prescription_lines: [
      {
        id: 'line_1',
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '朝食後',
        days: 28,
        quantity: null,
        unit: null,
        packaging_instruction_tags: [],
      },
      {
        id: 'line_2',
        drug_name: 'オキシコドン錠5mg',
        dose: '1錠',
        frequency: '疼痛時',
        days: 14,
        quantity: 14,
        unit: '錠',
        packaging_instruction_tags: ['narcotic'],
      },
      {
        id: 'line_3',
        drug_name: 'インスリングラルギン注',
        dose: '8単位',
        frequency: '夕',
        days: 28,
        quantity: 1,
        unit: '本',
        packaging_instruction_tags: ['cold_storage'],
      },
    ],
    recent_activities: [
      {
        id: 'transition-1',
        type: 'transition',
        label: '調剤 完了',
        actor: '佐藤',
        at: '2026-06-01T09:30:00.000Z',
        href: '/auditing',
      },
      {
        id: 'inquiry-1',
        type: 'inquiry',
        label: '残薬調整 → 疑義照会 回答受領',
        actor: null,
        at: '2026-06-01T09:31:00.000Z',
        href: '/communications/requests',
      },
      {
        id: 'intake-1',
        type: 'intake',
        label: '定期処方 取込(やまもと内科)',
        actor: null,
        at: '2026-05-30T08:00:00.000Z',
        href: '/prescriptions',
      },
    ],
    today_tasks: [
      {
        id: 'audit-1',
        tone: 'deadline',
        time_label: '期限 12:00',
        label: '麻薬監査',
        href: '/auditing',
        action_label: '監査へ',
        due_time: '12:00',
      },
      {
        id: 'set-1',
        tone: 'waiting',
        time_label: '監査後',
        label: 'セット作成',
        href: '/medication-sets',
        action_label: 'セットへ',
        due_time: null,
      },
      {
        id: 'visit-1',
        tone: 'scheduled',
        time_label: '14:00',
        label: '訪問',
        href: '/schedules',
        action_label: '訪問へ',
        due_time: null,
      },
    ],
    open_exceptions: [
      {
        id: 'exception_1',
        exception_type: 'awaiting_reply',
        description: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        created_at: null,
      },
    ],
    medication_changes: [],
    previous_medication: null,
    current_medication: null,
    set_plan: null,
    prescription_document_url: null,
    ...overrides,
  };
}

function mockPatientQuery(workspace: PatientWorkspace | null) {
  useOrgIdMock.mockReturnValue('org_1');
  useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
  useQueryMock.mockReturnValue({
    data: {
      id: 'patient_1',
      name: '田中 一郎',
      name_kana: 'タナカ イチロウ',
      birth_date: '1942-04-12',
      gender: 'male',
      archived_at: null,
      allergy_info: [],
      residences: [],
      visit_schedules: [],
      lab_summary: [
        {
          analyte_code: 'egfr',
          value_numeric: 38,
          measured_at: '2026-06-01T00:00:00.000Z',
          unit: 'mL/min/1.73m2',
          abnormal_flag: 'L',
        },
      ],
      cases: [],
      conditions: [],
      summary_metrics: { open_tasks_count: 0 },
      risk_summary: null,
      visit_brief: null,
      jahis_supplemental_records: [],
      workspace,
    },
    isLoading: false,
    error: null,
  });
}

describe('CardWorkspace', () => {
  it('renders the 06_card single-scroll workspace: header, safety board, prescription, activities, rail', () => {
    mockPatientQuery(buildWorkspace());

    render(<CardWorkspace patientId="patient_1" />);

    // ヘッダー行: カード見出し + RX 番号 + サブ + 右上 2 ボタン
    expect(screen.getByRole('heading', { name: 'カード — 田中 一郎 様' })).toBeTruthy();
    expect(screen.getByText('RX-2026-0500 / 1枚で患者のいまが全部わかる作業台')).toBeTruthy();
    const profileLink = screen.getByRole('link', { name: '→ 患者プロフィール' });
    expect(profileLink.getAttribute('href')).toBe('/patients/patient_1?view=profile');
    const compareLink = screen.getByRole('link', { name: 'カードを分割表示' });
    expect(compareLink.getAttribute('href')).toBe('/patients/compare?patients=patient_1');

    // タブ UI は廃止(単一スクロール構成)
    expect(screen.queryByRole('tab')).toBeNull();

    // セーフティボード: アレルギー / 腎機能 / 取扱タグ / 嚥下 / 注意
    const safetyBoard = screen.getByTestId('safety-board');
    expect(within(safetyBoard).getByText('セフェム系(2019)')).toBeTruthy();
    expect(within(safetyBoard).getByText('eGFR 38(6/1)')).toBeTruthy();
    expect(within(safetyBoard).getByText('一包化')).toBeTruthy();
    expect(within(safetyBoard).getByText('錠剤OK・大きい錠は半割')).toBeTruthy();
    expect(within(safetyBoard).getByText('ふらつき(6/5〜経過観察)')).toBeTruthy();

    // 今回の処方: RX 見出し + 現在工程 + 9 工程チップ + 薬剤テーブル
    expect(screen.getByRole('heading', { name: '今回の処方 — RX-2026-0500' })).toBeTruthy();
    expect(screen.getByText('工程: 監査(いまここ)')).toBeTruthy();
    const chips = screen.getByTestId('process-chips');
    expect(within(chips).getByText('監査').closest('[data-state]')?.getAttribute('data-state')).toBe(
      'current',
    );
    const prescriptionSection = screen.getByTestId('card-prescription-section');
    expect(within(prescriptionSection).getByText('アムロジピン錠5mg')).toBeTruthy();
    expect(within(prescriptionSection).getByText('オキシコドン錠5mg')).toBeTruthy();
    expect(within(prescriptionSection).getByText('14錠')).toBeTruthy();
    expect(within(prescriptionSection).getByText('28日分')).toBeTruthy();
    expect(within(prescriptionSection).getByText('麻薬')).toBeTruthy();
    expect(within(prescriptionSection).getByText('冷所')).toBeTruthy();
    // 無タグ行に「安全タグなし」風の淡表示は出さない
    expect(screen.queryByText('安全タグなし')).toBeNull();

    // 直近の動き: 時系列 3 行 + 「開く」
    const activities = screen.getByTestId('card-recent-activities');
    expect(within(activities).getByText('調剤 完了 — 佐藤')).toBeTruthy();
    expect(within(activities).getByText('残薬調整 → 疑義照会 回答受領')).toBeTruthy();
    expect(within(activities).getByText('定期処方 取込(やまもと内科)')).toBeTruthy();
    expect(within(activities).getAllByRole('button', { name: '開く' })).toHaveLength(3);

    // 右レール: このカードに紐づく今日(期限/監査後/時刻 + 遷移リンク)
    const todayPanel = screen.getByTestId('card-today-panel');
    expect(within(todayPanel).getByText('期限 12:00')).toBeTruthy();
    expect(within(todayPanel).getByText('麻薬監査')).toBeTruthy();
    expect(within(todayPanel).getByText('監査後')).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: '→ 監査へ' })).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: '→ セットへ' })).toBeTruthy();
    expect(within(todayPanel).getByRole('link', { name: '→ 訪問へ' })).toBeTruthy();

    // 次にやること: 主操作 1 つ、期限を内包したラベル
    const nextActionPanel = screen.getByTestId('next-action-panel');
    expect(
      within(nextActionPanel).getByRole('link', { name: '調剤鑑査を始める — 12:00期限' }),
    ).toBeTruthy();

    // 止まっている理由: カテゴリチップ + アクションリンク(リッチ形式)
    const blockedPanel = screen.getByTestId('blocked-reasons-panel');
    expect(within(blockedPanel).getByText('医療機関')).toBeTruthy();
    expect(within(blockedPanel).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(blockedPanel).getByRole('link', { name: '状況を見る →' })).toBeTruthy();

    // 根拠・記録: 「開く」文言 + meta
    const evidencePanel = screen.getByTestId('evidence-panel');
    expect(within(evidencePanel).getByText('お薬手帳(最新)')).toBeTruthy();
    expect(within(evidencePanel).getByText('照会回答')).toBeTruthy();
    expect(within(evidencePanel).getByText('検査値の推移')).toBeTruthy();
    expect(within(evidencePanel).getByText('eGFR')).toBeTruthy();
    expect(within(evidencePanel).getAllByRole('link', { name: '開く' }).length).toBeGreaterThan(0);
  });

  it('falls back to an empty state when no cycle workspace exists', () => {
    mockPatientQuery(null);

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByRole('heading', { name: 'カード — 田中 一郎 様' })).toBeTruthy();
    expect(screen.getByText('進行中のカードがありません')).toBeTruthy();
    expect(screen.getByRole('link', { name: '→ 患者プロフィール' })).toBeTruthy();
    expect(screen.queryByTestId('card-prescription-section')).toBeNull();
  });
});
