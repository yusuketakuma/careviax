// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { PatientDocumentsSnapshot, PatientWorkspace } from './patient-detail.types';
import type { PatientHomeOperationsSnapshot } from '@/types/patient-home-operations';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
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

import { CardWorkspace, buildConferenceStructuredContent } from './card-workspace';

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

function mockPatientQuery(
  workspace: PatientWorkspace | null,
  homeOperations: PatientHomeOperationsSnapshot | null = null,
) {
  const faxMutate = vi.fn();
  const prescriptionDocumentMutate = vi.fn();
  const prescriptionOriginalManagementMutate = vi.fn();
  const billingMutate = vi.fn();
  const billingProfileMutate = vi.fn();
  const conferenceMutate = vi.fn();
  const mcsCheckLogMutate = vi.fn();
  useOrgIdMock.mockReturnValue('org_1');
  useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
  useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
  useMutationMock
    .mockReturnValueOnce({ mutate: faxMutate, isPending: false, variables: null })
    .mockReturnValueOnce({
      mutate: prescriptionDocumentMutate,
      isPending: false,
      variables: null,
    })
    .mockReturnValueOnce({
      mutate: prescriptionOriginalManagementMutate,
      isPending: false,
      variables: null,
    })
    .mockReturnValueOnce({ mutate: billingMutate, isPending: false, variables: null })
    .mockReturnValueOnce({ mutate: billingProfileMutate, isPending: false, variables: null })
    .mockReturnValueOnce({ mutate: conferenceMutate, isPending: false, variables: null })
    .mockReturnValueOnce({ mutate: mcsCheckLogMutate, isPending: false, variables: null });
  const patientData = {
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
    phone: '090-0000-0000',
    medical_insurance_number: null,
    care_insurance_number: null,
    billing_support_flag: true,
    notes: null,
    summary_metrics: { open_tasks_count: 0 },
    risk_summary: null,
    visit_brief: {
      conference_summary: {
        recent_conferences: 1,
        pending_action_items: 0,
        last_conference_date: '2026-06-01T00:00:00.000Z',
        last_conference_type: 'discharge_conference',
        summary: '退院前カンファで初回訪問を確認',
      },
      unresolved_items: [],
    },
    jahis_supplemental_records: [],
    workspace,
    privacy: {
      sensitive_fields_masked: false,
      address_fields_masked: false,
      can_view_detail: true,
    },
  };
  const documentsData: PatientDocumentsSnapshot = {
    patient: {
      id: 'patient_1',
      name: '田中 一郎',
      name_kana: 'タナカ イチロウ',
    },
    print_readiness: {
      overall_status: 'warning',
      missing_required_count: 0,
      warning_count: 1,
      template_versions: [
        {
          document_type: 'contract',
          label: '契約書',
          template_id: 'template_contract',
          template_name: '在宅契約書',
          template_version: 'v3',
          effective_from: '2026-04-01T00:00:00.000Z',
          effective_to: null,
        },
      ],
      checks: [
        {
          key: 'patient_profile',
          label: '患者基本情報',
          completed: true,
          severity: 'required',
          description: '氏名、フリガナ、生年月日を差し込みできます。',
          action_href: '/patients/patient_1/edit',
          action_label: '基本情報を編集',
        },
        {
          key: 'explainer',
          label: '説明担当者',
          completed: false,
          severity: 'warning',
          description: '説明担当者の初期値に使う主担当薬剤師を設定してください。',
          action_href: '/patients/patient_1#patient-profile-summary',
          action_label: '担当者を確認',
        },
      ],
    },
    document_statuses: [
      {
        document_type: 'contract',
        label: '契約書',
        status: 'created',
        status_label: '作成済み',
        template_name: '在宅契約書',
        template_version: 'v3',
        storage_location: '店舗',
        latest_action_at: '2026-06-01T00:00:00.000Z',
        latest_document_id: 'doc_1',
        has_file: true,
        delivered_at: null,
        alerts: ['交付・回収が未記録です'],
      },
      {
        document_type: 'important_matters',
        label: '重要事項説明書',
        status: 'not_created',
        status_label: '未作成',
        template_name: null,
        template_version: null,
        storage_location: null,
        latest_action_at: null,
        latest_document_id: null,
        has_file: false,
        delivered_at: null,
        alerts: ['文書が未作成です'],
      },
    ],
    first_visit_documents: [],
  };

  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'patient-home-operations') {
      return {
        data: homeOperations ?? undefined,
        isLoading: false,
        error: null,
      };
    }
    if (queryKey[0] === 'patient-documents') {
      return {
        data: documentsData,
        isLoading: false,
        error: null,
      };
    }

    return {
      data: patientData,
      isLoading: false,
      error: null,
    };
  });
  return {
    faxMutate,
    prescriptionDocumentMutate,
    prescriptionOriginalManagementMutate,
    billingMutate,
    billingProfileMutate,
    conferenceMutate,
    mcsCheckLogMutate,
  };
}

describe('CardWorkspace', () => {
  it('renders the 06_card single-scroll workspace: header, safety board, prescription, activities, rail', () => {
    mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 3,
      top_alerts: [
        {
          id: 'documents:0:作成済み書類の交付・回収が未記録です',
          key: 'documents',
          label: '契約・同意・書類',
          message: '作成済み書類の交付・回収が未記録です',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態へ',
        },
        {
          id: 'prescription:0:FAX受信から7日経過しても原本到着が未記録です',
          key: 'prescription',
          label: '処方せん',
          message: 'FAX受信から7日経過しても原本到着が未記録です',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
        },
        {
          id: 'billing:1:未収額 1,080円 があります',
          key: 'billing',
          label: '請求・集金',
          message: '未収額 1,080円 があります',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
        },
      ],
      items: [
        {
          key: 'documents',
          label: '契約・同意・書類',
          status: '作成済・回収確認',
          description: '作成済み書類の交付・回収が未記録です',
          href: '/patients/patient_1#patient-documents',
          action_label: '文書状態へ',
          tone: 'attention',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [
            { label: 'PDF/画像', value: '保存済み' },
            { label: '交付', value: '未記録' },
          ],
          alerts: ['作成済み書類の交付・回収が未記録です'],
        },
        {
          key: 'mcs',
          label: 'MCS・外部連携',
          status: '連携あり',
          description: '田中一郎 在宅チーム / 最終同期 2026/06/01',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を管理',
          external_href: 'https://www.medical-care.net/projects/medical/57886227',
          external_action_label: 'MCSを開く',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [{ label: '最終同期', value: '2026/06/01' }],
          alerts: [],
        },
        {
          key: 'prescription',
          label: '処方せん',
          status: '原本未着',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '期限', value: '2026/06/12 / 4日超過' },
            { label: '原本', value: '未着/未記録' },
            { label: 'FAX経過', value: '7日未着' },
            { label: '疑義照会', value: '未解決なし' },
            { label: '照合', value: '未照合' },
          ],
          alerts: ['FAX受信から7日経過しても原本到着が未記録です'],
          quick_actions: [
            {
              key: 'mark_fax_original_collected',
              label: '原本到着を記録',
              resource_id: 'intake_0500',
            },
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / candidate',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '算定候補', value: '1件' },
            { label: '支払設定', value: '家族' },
            { label: '支払方法', value: '振込' },
            { label: '今月請求額', value: '3,240円' },
            { label: '未収額', value: '1,080円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '支払者区分コード', value: 'family' },
            { label: '支払方法コード', value: 'bank_transfer' },
            { label: '集金タイミングコード', value: 'month_end' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '請求書発行コード', value: 'yes' },
            { label: '未収許容コード', value: 'one_month' },
            { label: '続柄', value: '長女' },
          ],
          alerts: ['未処理の算定候補が1件あります', '未収額 1,080円 があります'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を更新',
              resource_id: 'patient_1',
            },
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '記録あり',
          description: '退院前カンファ / 2026/06/01',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議要点へ',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [{ label: '報告書', value: '作成済み' }],
          alerts: [],
          quick_actions: [
            {
              key: 'record_conference_note',
              label: '会議要点を追記',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    // ヘッダー行: カード見出し + RX 番号 + サブ + 右上 2 ボタン
    expect(screen.getByRole('heading', { name: 'カード — 田中 一郎 様' })).toBeTruthy();
    expect(screen.getByText('RX-2026-0500 / 1枚で患者のいまが全部わかる作業台')).toBeTruthy();
    const profileLink = screen.getByRole('link', { name: 'プロフィールを確認' });
    expect(profileLink.getAttribute('href')).toBe('#patient-profile-summary');
    const compareLink = screen.getByRole('link', { name: 'カードを分割表示' });
    expect(compareLink.getAttribute('href')).toBe('/patients/compare?patients=patient_1');
    expect(screen.getByTestId('patient-profile-summary')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '患者プロフィール' })).toBeTruthy();
    const homeOps = screen.getByTestId('patient-home-operations-panel');
    expect(within(homeOps).getByRole('heading', { name: '在宅運用管理' })).toBeTruthy();
    expect(within(homeOps).getAllByText('契約・同意・書類').length).toBeGreaterThan(0);
    expect(within(homeOps).getByText('MCS・外部連携')).toBeTruthy();
    expect(within(homeOps).getAllByText('処方せん').length).toBeGreaterThan(0);
    expect(within(homeOps).getAllByText('請求・集金').length).toBeGreaterThan(0);
    expect(within(homeOps).getByText('カンファレンス')).toBeTruthy();
    expect(within(homeOps).getByText('要確認 3件')).toBeTruthy();
    const homeOpsAlerts = screen.getByTestId('patient-home-operation-alerts');
    expect(within(homeOpsAlerts).getByRole('heading', { name: '未処理アラート' })).toBeTruthy();
    expect(within(homeOpsAlerts).getByText('3件を上から確認')).toBeTruthy();
    expect(within(homeOpsAlerts).getByText('契約・同意・書類')).toBeTruthy();
    expect(within(homeOpsAlerts).getByText('処方せん')).toBeTruthy();
    expect(within(homeOpsAlerts).getByText('請求・集金')).toBeTruthy();
    expect(within(homeOpsAlerts).getByRole('link', { name: '文書状態へ' })).toBeTruthy();
    expect(within(homeOpsAlerts).getByRole('link', { name: '処方履歴へ' })).toBeTruthy();
    expect(
      within(homeOps).getAllByText('作成済み書類の交付・回収が未記録です').length,
    ).toBeGreaterThan(0);
    expect(
      within(homeOps).getAllByText('FAX受信から7日経過しても原本到着が未記録です').length,
    ).toBeGreaterThan(0);
    expect(within(homeOps).getByText('期限')).toBeTruthy();
    expect(within(homeOps).getByText('2026/06/12 / 4日超過')).toBeTruthy();
    expect(within(homeOps).getByText('FAX経過')).toBeTruthy();
    expect(within(homeOps).getByText('7日未着')).toBeTruthy();
    expect(within(homeOps).getByText('未処理の算定候補が1件あります')).toBeTruthy();
    expect(within(homeOps).getAllByText('未収額 1,080円 があります').length).toBeGreaterThan(0);
    expect(within(homeOps).getByText('未収額')).toBeTruthy();
    expect(within(homeOps).getAllByText('領収証').length).toBeGreaterThan(0);
    expect(within(homeOps).getAllByText('R20260616-001').length).toBeGreaterThan(0);
    expect(within(homeOps).queryByText('支払者区分コード')).toBeNull();
    const expandBillingMetricsButton = within(homeOps).getByRole('button', {
      name: '全指標を表示（残り10件）',
    });
    expect(expandBillingMetricsButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expandBillingMetricsButton);
    expect(within(homeOps).getByText('支払者区分コード')).toBeTruthy();
    expect(within(homeOps).getByText('請求書発行コード')).toBeTruthy();
    expect(within(homeOps).getByText('one_month')).toBeTruthy();
    const collapseBillingMetricsButton = within(homeOps).getByRole('button', {
      name: '主要4項目に戻す',
    });
    expect(collapseBillingMetricsButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapseBillingMetricsButton);
    expect(within(homeOps).queryByText('支払者区分コード')).toBeNull();
    expect(within(homeOps).getByRole('button', { name: /支払設定を更新/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /集金記録を更新/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /会議要点を追記/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /原本到着を記録/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /画像\/PDFを保存/ })).toBeTruthy();
    expect(within(homeOps).getByRole('button', { name: /原本管理を記録/ })).toBeTruthy();
    expect(within(homeOps).getByText('PDF/画像')).toBeTruthy();
    expect(within(homeOps).getByText('保存済み')).toBeTruthy();
    expect(
      within(homeOps)
        .getAllByRole('link', { name: /文書状態へ/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1#patient-documents'),
    ).toBe(true);
    const documentsPanel = screen.getByTestId('patient-card-documents-panel');
    expect(
      within(documentsPanel).getByRole('heading', { name: '初回訪問文書・交付記録' }),
    ).toBeTruthy();
    expect(within(documentsPanel).getByText('印刷前チェック')).toBeTruthy();
    expect(within(documentsPanel).getByText('確認あり / 確認 1件')).toBeTruthy();
    expect(within(documentsPanel).getByText('契約・同意書類の現在状態')).toBeTruthy();
    expect(within(documentsPanel).getAllByText('契約書').length).toBeGreaterThan(0);
    expect(
      within(documentsPanel).getByRole('link', { name: '印刷プレビュー' }).getAttribute('href'),
    ).toBe('/reports/print?type=first_visit_documents&patient_id=patient_1');
    const mcsExternalLink = within(homeOps).getByRole('link', { name: /MCSを開く/ });
    expect(mcsExternalLink.getAttribute('href')).toBe(
      'https://www.medical-care.net/projects/medical/57886227',
    );
    expect(mcsExternalLink.getAttribute('target')).toBe('_blank');
    expect(
      within(homeOps)
        .getByRole('link', { name: /MCS連携を管理/ })
        .getAttribute('href'),
    ).toBe('/patients/patient_1/mcs');
    expect(
      within(homeOps)
        .getAllByRole('link', { name: /処方履歴へ/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1/prescriptions'),
    ).toBe(true);
    expect(
      within(homeOps)
        .getAllByRole('link', { name: /請求候補を確認/ })
        .some(
          (link) =>
            link.getAttribute('href') ===
            '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
        ),
    ).toBe(true);
    expect(
      within(homeOps)
        .getByRole('link', { name: /会議要点へ/ })
        .getAttribute('href'),
    ).toBe('/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail');

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
    expect(
      within(chips).getByText('監査').closest('[data-state]')?.getAttribute('data-state'),
    ).toBe('current');
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
    expect(screen.getByTestId('patient-profile-summary')).toBeTruthy();
    expect(screen.getByTestId('patient-home-operations-panel')).toBeTruthy();
    expect(screen.queryByTestId('card-prescription-section')).toBeNull();
  });

  it('starts the fax original collection mutation from the home operations panel', () => {
    const { faxMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '原本未着',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['FAX先行受付の原本到着が未記録です'],
          quick_actions: [
            {
              key: 'mark_fax_original_collected',
              label: '原本到着を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.click(screen.getByRole('button', { name: /原本到着を記録/ }));

    expect(faxMutate).toHaveBeenCalledWith('intake_0500');
  });

  it('records an MCS check log from the home operations panel', () => {
    const { mcsCheckLogMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 0,
      top_alerts: [],
      items: [
        {
          key: 'mcs',
          label: 'MCS・外部連携',
          status: '連携あり',
          description: '田中一郎 在宅チーム / 最終確認 2026/06/01',
          href: '/patients/patient_1/mcs',
          action_label: 'MCS連携を管理',
          tone: 'ok',
          updated_at: '2026-06-01T00:00:00.000Z',
          metrics: [
            { label: '最終確認', value: '2026/06/01' },
            { label: '参加状況', value: '参加済' },
          ],
          alerts: [],
          quick_actions: [
            {
              key: 'record_mcs_check_log',
              label: 'MCS確認ログを記録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.click(screen.getByRole('button', { name: /MCS確認ログを記録/ }));
    expect(screen.getByText('MCS確認内容を入力してください。')).toBeTruthy();
    expect(mcsCheckLogMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('区分'), {
      target: { value: 'instruction_check' },
    });
    fireEvent.change(screen.getByLabelText('MCS確認内容'), {
      target: { value: '訪看からの食欲低下共有を確認' },
    });
    fireEvent.change(screen.getByLabelText('次アクション'), {
      target: { value: '医師へ服薬状況を確認' },
    });
    fireEvent.click(screen.getByRole('button', { name: /MCS確認ログを記録/ }));

    expect(mcsCheckLogMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      contentType: 'instruction_check',
      summary: '訪看からの食欲低下共有を確認',
      nextAction: '医師へ服薬状況を確認',
    });
  });

  it('saves a prescription image or PDF URL from the home operations panel', () => {
    const { prescriptionDocumentMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['処方せん画像/PDFが未保存です'],
          quick_actions: [
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('画像/PDF URL'), {
      target: { value: 'https://example.com/prescriptions/intake_0500.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /画像\/PDFを保存/ }));

    expect(prescriptionDocumentMutate).toHaveBeenCalledWith({
      intakeId: 'intake_0500',
      documentUrl: 'https://example.com/prescriptions/intake_0500.pdf',
    });
  });

  it('uploads a prescription image or PDF before saving its download URL', async () => {
    const { prescriptionDocumentMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [{ label: '原本', value: '未着/未記録' }],
          alerts: ['処方せん画像/PDFが未保存です'],
          quick_actions: [
            {
              key: 'save_prescription_document',
              label: '画像/PDFを保存',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: '11111111-1111-4111-8111-111111111111',
            uploadUrl: 'https://uploads.example.com/prescription.pdf',
            headers: { 'x-amz-server-side-encryption': 'AES256' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ etag: 'etag-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: '11111111-1111-4111-8111-111111111111',
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<CardWorkspace patientId="patient_1" />);

    const file = new File(['pdf'], 'prescription.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('ファイル'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /画像\/PDFを保存/ }));

    await waitFor(() => {
      expect(prescriptionDocumentMutate).toHaveBeenCalledWith({
        intakeId: 'intake_0500',
        documentUrl:
          'http://localhost:3000/api/files/11111111-1111-4111-8111-111111111111/download',
      });
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/files/presigned-upload',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"patient_id":"patient_1"'),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://uploads.example.com/prescription.pdf',
      expect.objectContaining({
        method: 'PUT',
        body: file,
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/files/complete',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"etag":"etag-1"'),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('records prescription original reconciliation and storage from the home operations panel', () => {
    const { prescriptionOriginalManagementMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '照合', value: '未照合' },
            { label: '保管', value: '未保管' },
          ],
          alerts: ['原本到着後の照合結果が未記録です'],
          quick_actions: [
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByText('保存される原本管理')).toBeTruthy();
    expect(screen.getByLabelText('原本到着日時')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('照合結果'), { target: { value: 'discrepancy' } });
    fireEvent.change(screen.getByLabelText('差異内容'), {
      target: { value: 'FAX記載の日数と原本の日数が異なる' },
    });
    fireEvent.change(screen.getByLabelText('保管場所'), { target: { value: 'headquarters' } });
    fireEvent.change(screen.getByLabelText('電子処方せん'), { target: { value: 'acquired' } });
    fireEvent.change(screen.getByLabelText('結果登録'), { target: { value: 'registered' } });
    fireEvent.change(screen.getByLabelText('引換番号'), { target: { value: 'EP-12345' } });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '医師確認済み' },
    });
    expect(screen.getByText('取得済み / EP-12345')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));

    expect(prescriptionOriginalManagementMutate).toHaveBeenCalledWith({
      intakeId: 'intake_0500',
      originalCollectedAt: expect.any(String),
      reconciliationResult: 'discrepancy',
      discrepancyNote: 'FAX記載の日数と原本の日数が異なる',
      storageLocation: 'headquarters',
      ePrescriptionExchangeNumber: 'EP-12345',
      ePrescriptionAcquiredStatus: 'acquired',
      dispensingResultRegistration: 'registered',
      note: '医師確認済み',
    });
  });

  it('blocks incomplete prescription original management before mutation', async () => {
    const { prescriptionOriginalManagementMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'prescription',
          label: '処方せん',
          status: '受付あり',
          description: 'FAX先行 / やまもと内科 / 2026/06/09',
          href: '/patients/patient_1/prescriptions',
          action_label: '処方履歴へ',
          tone: 'attention',
          updated_at: '2026-06-09T00:00:00.000Z',
          metrics: [
            { label: '照合', value: '未照合' },
            { label: '保管', value: '未保管' },
          ],
          alerts: ['原本到着後の照合結果が未記録です'],
          quick_actions: [
            {
              key: 'record_prescription_original_management',
              label: '原本管理を記録',
              resource_id: 'intake_0500',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('照合結果'), { target: { value: 'discrepancy' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '差異ありの場合は差異内容を入力してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('差異内容'), {
      target: { value: 'FAX記載の日数と原本の日数が異なる' },
    });
    fireEvent.change(screen.getByLabelText('電子処方せん'), { target: { value: 'pending' } });
    expect(screen.getByText('取得待ち / 引換番号未入力')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '電子処方せん対象では引換番号を入力してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('引換番号'), { target: { value: 'EP-12345' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '電子処方せん取得待ちでは調剤結果登録済みにできません。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('電子処方せん'), {
      target: { value: 'not_applicable' },
    });
    fireEvent.change(screen.getByLabelText('保管場所'), { target: { value: 'not_stored' } });
    fireEvent.click(screen.getByRole('button', { name: /原本管理を記録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '照合済みまたは調剤結果登録済みでは保管場所を記録してください。',
    );
    expect(prescriptionOriginalManagementMutate).not.toHaveBeenCalled();
  });

  it('records billing collection metadata from the home operations panel', () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '次回集金予定', value: '未設定' },
            {
              label: '領収証控えURL',
              value: '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
            },
            {
              label: '請求書控えURL',
              value: '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
            },
          ],
          alerts: ['集金ステータスが未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を登録',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.change(screen.getByLabelText('領収証番号'), {
      target: { value: 'R20260616-001' },
    });
    fireEvent.change(screen.getByLabelText('次回集金予定'), {
      target: { value: '2026-06-25T10:30' },
    });
    fireEvent.change(screen.getByLabelText('請求書状態'), {
      target: { value: 'issued' },
    });
    fireEvent.click(screen.getByLabelText('領収証控えを保存する'));
    expect(screen.getByText('領収証 発行済み / 請求書 発行済み')).toBeTruthy();
    expect(screen.getByText('保存する')).toBeTruthy();
    expect(screen.getByRole('link', { name: '領収証PDF' }).getAttribute('href')).toBe(
      '/api/billing-candidates/candidate_1/documents/pdf?kind=receipt',
    );
    expect(screen.getByRole('link', { name: '請求書PDF' }).getAttribute('href')).toBe(
      '/api/billing-candidates/candidate_1/documents/pdf?kind=invoice',
    );
    fireEvent.click(screen.getByRole('button', { name: /集金記録を登録/ }));

    expect(billingMutate).toHaveBeenCalledWith({
      candidateId: 'candidate_1',
      status: 'collected',
      billedAmount: 3240,
      collectedAmount: 3240,
      payerName: '長女',
      paymentMethod: 'cash',
      scheduledCollectionAt: new Date('2026-06-25T10:30').toISOString(),
      receiptNumber: 'R20260616-001',
      receiptIssueStatus: 'issued',
      invoiceIssueStatus: 'issued',
      saveReceiptCopy: true,
    });
  });

  it('blocks inconsistent billing collection metadata before mutation', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '次回集金予定', value: '未設定' },
          ],
          alerts: ['集金ステータスが未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を登録',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'partial' } });
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を登録/ }));

    expect(
      await screen.findByText('一部入金では請求額未満の入金額を入力してください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires a receipt number before saving collected billing when receipt issuance is enabled', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: '未発行/未記録' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '次回集金予定', value: '未設定' },
          ],
          alerts: ['領収証番号が未記録です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByText('保存される集金履歴')).toBeTruthy();
    expect(screen.getByText('番号未入力')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('領収証発行が必要な集金では領収証番号を入力してください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires issued receipt status before saving receipt-managed collection', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '領収証発行コード', value: 'paper' },
            { label: '領収証状態コード', value: 'not_issued' },
          ],
          alerts: ['領収証が未発行です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '3240' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('領収証発行が必要な集金では発行状態を発行済みにしてください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('requires issued invoice status before saving invoice-managed billing collection', async () => {
    const { billingMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '確認待ち',
          description: '2026/06 居宅療養管理指導 / confirmed',
          href: '/billing/candidates?patient_id=patient_1&billing_month=2026-06-01',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: '2026-06-10T00:00:00.000Z',
          metrics: [
            { label: '今月請求額', value: '3,240円' },
            { label: '支払者', value: '長女' },
            { label: '領収証', value: 'R20260616-001' },
            { label: '領収証発行コード', value: 'none' },
            { label: '請求書発行コード', value: 'yes' },
            { label: '請求書状態コード', value: 'not_issued' },
          ],
          alerts: ['請求書が未発行です'],
          quick_actions: [
            {
              key: 'record_billing_collection',
              label: '集金記録を更新',
              resource_id: 'candidate_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'billed' } });
    fireEvent.change(screen.getByLabelText('入金額'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /集金記録を更新/ }));

    expect(
      await screen.findByText('請求書発行が必要な請求・集金では発行状態を発行済みにしてください。'),
    ).toBeTruthy();
    expect(billingMutate).not.toHaveBeenCalled();
  });

  it('records patient billing payment profile metadata from the home operations panel', () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.change(screen.getByLabelText('支払方法'), {
      target: { value: 'bank_transfer' },
    });
    fireEvent.change(screen.getByLabelText('支払者氏名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.change(screen.getByLabelText('続柄'), {
      target: { value: '長女' },
    });
    fireEvent.change(screen.getByLabelText('集金タイミング'), {
      target: { value: 'month_end' },
    });
    fireEvent.change(screen.getByLabelText('未収許容'), {
      target: { value: 'one_month' },
    });
    fireEvent.change(screen.getByLabelText('備考'), {
      target: { value: '月末に長女へ請求' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(billingProfileMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      payerType: 'family',
      payerName: '山田 花子',
      payerRelation: '長女',
      billingAddressMode: 'same_as_patient',
      billingAddress: null,
      paymentMethod: 'bank_transfer',
      collectionTiming: 'month_end',
      receiptIssue: 'paper',
      invoiceIssue: 'yes',
      unpaidTolerance: 'one_month',
      note: '月末に長女へ請求',
    });
  });

  it('requires payer details before saving a non-self billing payment profile', async () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(
      await screen.findByText('本人以外の支払者では支払者氏名を入力してください。'),
    ).toBeTruthy();
    expect(billingProfileMutate).not.toHaveBeenCalled();
  });

  it('records a different billing address from the billing payment profile quick form', () => {
    const { billingProfileMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'billing',
          label: '請求・集金',
          status: '未設定',
          description: '支払者、支払方法、請求候補、未収・集金予定、領収証の確認導線です。',
          href: '/billing/candidates?patient_id=patient_1',
          action_label: '請求候補を確認',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '算定候補', value: '0件' },
            { label: '支払設定', value: '未設定' },
            { label: '支払者', value: '未記録' },
          ],
          alerts: ['患者ごとの支払者・支払方法が未設定です'],
          quick_actions: [
            {
              key: 'record_billing_payment_profile',
              label: '支払設定を登録',
              resource_id: 'patient_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('支払者'), {
      target: { value: 'family' },
    });
    fireEvent.change(screen.getByLabelText('支払者氏名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.change(screen.getByLabelText('続柄'), {
      target: { value: '長女' },
    });
    fireEvent.change(screen.getByLabelText('請求先住所区分'), {
      target: { value: 'different' },
    });
    fireEvent.change(screen.getByLabelText('請求先住所'), {
      target: { value: '東京都千代田区1-1-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /支払設定を登録/ }));

    expect(billingProfileMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAddressMode: 'different',
        billingAddress: '東京都千代田区1-1-1',
      }),
    );
  });

  it('records a patient-scoped conference note from the home operations panel', () => {
    const { conferenceMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '未登録',
          description:
            '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を管理します。',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議を登録',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '報告書', value: '未作成' },
            { label: 'タスク', value: '0件' },
          ],
          alerts: ['カンファレンス予定・記録が未登録です'],
          quick_actions: [
            {
              key: 'record_conference_note',
              label: '会議要点を登録',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    expect(screen.getByText('保存される会議連動')).toBeTruthy();
    expect(screen.getByText('対面 / CM')).toBeTruthy();
    expect(screen.getByText('ケアマネ向け報告書')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('会議要点'), {
      target: { value: '退院後の服薬支援と残薬確認を合意した' },
    });
    fireEvent.change(screen.getByLabelText('開催形式'), {
      target: { value: 'mcs' },
    });
    fireEvent.change(screen.getByLabelText('主催者'), {
      target: { value: 'visiting_nurse' },
    });
    fireEvent.change(screen.getByLabelText('報告書用途'), {
      target: { value: 'nurse_share' },
    });
    fireEvent.change(screen.getByLabelText('訪問頻度変更'), {
      target: { value: '月2回' },
    });
    fireEvent.change(screen.getByLabelText('フォロー期限'), {
      target: { value: '2026-06-17T10:30' },
    });
    fireEvent.click(screen.getByLabelText('フォロー完了'));
    fireEvent.change(screen.getByLabelText('薬局タスク'), {
      target: { value: '報告書作成 / 薬剤師' },
    });
    expect(screen.getByText('タスク 1件')).toBeTruthy();
    expect(screen.getByText('2026-06-17 10:30 / 完了')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));

    expect(conferenceMutate).toHaveBeenCalledWith({
      patientId: 'patient_1',
      caseId: 'case_1',
      noteType: 'service_manager',
      title: '田中 一郎様 サービス担当者会議',
      conferenceDate: expect.any(String),
      conferenceFormat: 'mcs',
      organizer: 'visiting_nurse',
      reportType: 'nurse_share',
      followUpDate: '2026-06-17T10:30',
      followUpCompleted: true,
      content: '退院後の服薬支援と残薬確認を合意した',
      visitScheduleChange: '月2回',
      targetDischargeDate: '',
      actionItemsRaw: '報告書作成 / 薬剤師',
    });
  });

  it('blocks incomplete conference quick-note submissions before mutation', () => {
    const { conferenceMutate } = mockPatientQuery(buildWorkspace(), {
      generated_at: '2026-06-16T00:00:00.000Z',
      attention_count: 1,
      top_alerts: [],
      items: [
        {
          key: 'conference',
          label: 'カンファレンス',
          status: '未登録',
          description:
            '退院前カンファ、担当者会議、デスカンファの予定・議事録・報告書を管理します。',
          href: '/conferences?patient_id=patient_1&case_id=case_1&focus=notes&context=patient_detail',
          action_label: '会議を登録',
          tone: 'attention',
          updated_at: null,
          metrics: [
            { label: '報告書', value: '未作成' },
            { label: 'タスク', value: '0件' },
          ],
          alerts: ['カンファレンス予定・記録が未登録です'],
          quick_actions: [
            {
              key: 'record_conference_note',
              label: '会議要点を登録',
              resource_id: 'case_1',
            },
          ],
        },
      ],
    });

    render(<CardWorkspace patientId="patient_1" />);

    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '会議名・開催日時・会議要点を入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('会議要点'), {
      target: { value: '退院後の服薬支援と残薬確認を合意した' },
    });
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '会議後の薬局タスクを1件以上入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('薬局タスク'), {
      target: { value: '報告書作成 / 薬剤師' },
    });
    fireEvent.change(screen.getByLabelText('会議種別'), {
      target: { value: 'pre_discharge' },
    });
    fireEvent.click(screen.getByRole('button', { name: /会議要点を登録/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      '退院前カンファレンスでは退院予定日を入力してください。',
    );
    expect(conferenceMutate).not.toHaveBeenCalled();
  });

  it('maps conference quick-form fields to structured sync sections', () => {
    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'service_manager',
        title: 'サービス担当者会議',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        organizer: 'care_manager',
        reportType: 'care_manager_report',
        followUpDate: '',
        followUpCompleted: false,
        content: 'ケアプラン変更と服薬支援方針を確認した',
        visitScheduleChange: '月2回',
        targetDischargeDate: '',
        actionItemsRaw: '報告書作成 / 薬剤師\n次回訪問日を連絡 / 事務',
      }),
    ).toEqual({
      template: 'service_manager',
      sections: [
        {
          key: 'meeting_purpose',
          label: '会議目的',
          body: 'ケアプラン変更と服薬支援方針を確認した',
        },
        {
          key: 'service_adjustments',
          label: 'サービス調整',
          body: '訪問頻度を月2回へ変更',
        },
      ],
    });

    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'pre_discharge',
        title: '退院前カンファ',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        organizer: 'hospital',
        reportType: 'physician_report',
        followUpDate: '',
        followUpCompleted: false,
        content: '退院後の服薬支援を確認した',
        visitScheduleChange: '月1回',
        targetDischargeDate: '2026-06-20',
        actionItemsRaw: '',
      }),
    ).toEqual({
      template: 'pre_discharge',
      sections: [
        { key: 'discharge_background', label: '退院背景', body: '退院後の服薬支援を確認した' },
        { key: 'target_discharge_date', label: '退院予定日', body: '2026-06-20' },
        {
          key: 'next_visit_plan',
          label: '初回訪問計画',
          body: '退院後の初回訪問を月1回で調整',
        },
      ],
    });

    expect(
      buildConferenceStructuredContent({
        patientId: 'patient_1',
        caseId: 'case_1',
        noteType: 'pre_discharge',
        title: '退院前カンファ',
        conferenceDate: '2026-06-16T09:00',
        conferenceFormat: 'in_person',
        organizer: 'hospital',
        reportType: 'physician_report',
        followUpDate: '',
        followUpCompleted: false,
        content: '退院後の服薬支援を確認した',
        visitScheduleChange: '月1回',
        targetDischargeDate: '',
        actionItemsRaw: '',
      }),
    ).toEqual({
      template: 'pre_discharge',
      sections: [
        { key: 'discharge_background', label: '退院背景', body: '退院後の服薬支援を確認した' },
      ],
    });
  });
});
