// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('./patient-detail-helpers', () => ({
  deriveStatusFromPatient: () => 'stable',
  selectNextVisit: () => null,
}));

vi.mock('@/components/visit-brief/visit-brief-card', () => ({
  VisitBriefCard: ({ title }: { title: string }) => <div data-testid="visit-brief">{title}</div>,
}));

vi.mock('./cases-tab', () => ({
  CasesTab: () => <div data-testid="cases-tab" />,
}));

vi.mock('./medications/medications-content', () => ({
  MedicationsContent: () => <div data-testid="medications-content" />,
}));

vi.mock('./patient-conditions-card', () => ({
  PatientConditionsCard: () => <div data-testid="conditions-card" />,
}));

vi.mock('./patient-intake-summary-card', () => ({
  PatientIntakeSummaryCard: () => <div data-testid="intake-summary-card" />,
}));

vi.mock('./patient-insurance-card', () => ({
  PatientInsuranceCard: () => <div data-testid="insurance-card" />,
}));

vi.mock('./patient-master-card', () => ({
  PatientMasterCard: () => <div data-testid="master-card" />,
}));

vi.mock('./patient-facility-multi-visit-card', () => ({
  PatientFacilityMultiVisitCard: () => <div data-testid="facility-multi-visit-card" />,
}));

vi.mock('./patient-packaging-card', () => ({
  PatientPackagingCard: () => <div data-testid="packaging-card" />,
}));

vi.mock('./patient-labs-card', () => ({
  PatientLabsCard: () => <div data-testid="labs-card" />,
}));

vi.mock('./patient-workflow-preview-card', () => ({
  PatientWorkflowPreviewCard: () => <div data-testid="workflow-preview-card" />,
}));

vi.mock('./patient-risk-card', () => ({
  PatientRiskCard: () => <div data-testid="risk-card" />,
}));

vi.mock('./patient-readiness-card', () => ({
  PatientReadinessCard: () => <div data-testid="readiness-card" />,
}));

vi.mock('./patient-visits-panel', () => ({
  PatientVisitsPanel: () => <div data-testid="visits-panel" />,
}));

vi.mock('./patient-communications-panel', () => ({
  PatientCommunicationsPanel: () => <div data-testid="communications-panel" />,
}));

vi.mock('./patient-documents-panel', () => ({
  PatientDocumentsPanel: () => <div data-testid="documents-panel" />,
}));

vi.mock('./patient-timeline-panel', () => ({
  PatientTimelinePanel: () => <div data-testid="timeline-panel" />,
}));

vi.mock('./prescriptions/prescription-history-content', () => ({
  PrescriptionHistoryContent: () => <div data-testid="prescription-history-content" />,
}));

vi.mock('./visit-constraints-card', () => ({
  VisitConstraintsCard: () => <div data-testid="visit-constraints-card" />,
}));

vi.mock('@/components/features/prescriptions/jahis-supplemental-records-card', () => ({
  JahisSupplementalRecordsCard: () => <div data-testid="jahis-card" />,
}));

vi.mock('@/lib/pharmacy/jahis-supplemental-records-view', () => ({
  normalizeJahisSupplementalRecords: () => [],
}));

import { PatientDetailInfoGroup, PatientDetailTabs } from './patient-detail-tabs';

setupDomTestEnv();

describe('PatientDetailInfoGroup', () => {
  it('renders a bordered information group with an accessible heading', () => {
    render(
      <PatientDetailInfoGroup
        title="患者基本・保険"
        description="患者マスタ、住所、連絡先、保険、請求支援の前提情報をまとめます。"
      >
        <div>患者マスタ</div>
      </PatientDetailInfoGroup>,
    );

    const group = screen.getByRole('region', { name: '患者基本・保険' });
    expect(group.className).toContain('border-border/70');
    expect(group.className).toContain('rounded-2xl');
    expect(screen.getByText('患者マスタ')).toBeTruthy();
  });
});

describe('PatientDetailTabs', () => {
  it('renders the p0_08 workspace: mini card, default memo tab, and cycle status', () => {
    useOrgIdMock.mockReturnValue('org_1');
    usePathnameMock.mockReturnValue('/patients/patient_1');
    useRouterMock.mockReturnValue({ replace: vi.fn(), push: vi.fn() });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        id: 'patient_1',
        name: '山田花子',
        name_kana: 'ヤマダハナコ',
        birth_date: '1940-01-01',
        gender: 'female',
        archived_at: null,
        archived_by_name: null,
        allergy_info: [],
        residences: [
          {
            id: 'residence_1',
            is_primary: true,
            address: '東京都千代田区1-1',
            unit_name: '101',
            facility_id: null,
          },
        ],
        visit_schedules: [],
        lab_summary: [],
        cases: [],
        medical_insurance_number: 'mi_1',
        care_insurance_number: null,
        billing_support_flag: true,
        risk_summary: {
          reasons: [],
          pending_reports: 0,
        },
        summary_metrics: {
          open_tasks_count: 0,
        },
        visit_brief: null,
        conditions: [],
        jahis_supplemental_records: null,
        workspace: {
          cycle_id: 'cycle_1',
          overall_status: 'setting',
          exception_status: null,
          open_exceptions: [
            {
              id: 'exception_1',
              exception_type: 'discontinued_collection_unconfirmed',
              description: '中止薬の回収袋が未確認です',
              severity: 'critical',
            },
          ],
          medication_changes: [
            { change_type: 'added', drug_name: 'トラセミド錠4mg', frequency: '朝食後', days: 28 },
            { change_type: 'removed', drug_name: 'アムロジピン錠5mg', frequency: null, days: null },
          ],
          previous_medication: { start: '2026-05-01', end: '2026-05-21' },
          current_medication: { start: '2026-05-22', end: '2026-06-18' },
          set_plan: {
            id: 'set_plan_1',
            set_method: 'facility_calendar',
            notes: '残薬充当あり / 中止薬回収あり',
            target_period_start: '2026-05-22',
            target_period_end: '2026-06-18',
            processing: { unit_dose: true, separate_pack: true, crushed: false },
          },
          prescription_document_url: null,
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PatientDetailTabs patientId="patient_1" />);

    // 左ミニカード: 患者名 様 + 5 項目 + 主操作
    expect(screen.getByText('山田花子 様')).toBeTruthy();
    expect(screen.getByText('前回薬')).toBeTruthy();
    expect(screen.getByText('今回薬')).toBeTruthy();
    expect(screen.getByText('5/21まで')).toBeTruthy();
    expect(screen.getAllByText('5/22〜6/18').length).toBeGreaterThan(0);
    expect(screen.getAllByText('セット監査待ち').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'カードを編集' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '一覧へ戻る' })).toBeTruthy();

    // タブ構成(7 つ)と既定タブ
    const tabLabels = ['薬剤師メモ', '工程', '処方・監査', 'セット', '訪問', '報告', '履歴'];
    for (const label of tabLabels) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('tab', { name: '基本情報' })).toBeNull();

    // 薬剤師メモタブの 3 セクション
    expect(screen.getByText('今日の見どころ')).toBeTruthy();
    expect(screen.getByText('処方の変化')).toBeTruthy();
    expect(screen.getByText('セットの注意')).toBeTruthy();
    expect(screen.getByText('トラセミド錠4mg')).toBeTruthy();
    expect(screen.getByText('アムロジピン錠5mg')).toBeTruthy();
  });
});
