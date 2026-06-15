// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const sendMutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock('@/components/features/visits/visit-report-readiness-panel', () => ({
  VisitReportReadinessPanel: ({ actions }: { actions?: React.ReactNode }) => (
    <section data-testid="readiness-panel">{actions}</section>
  ),
}));

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getReportDetailShortcutLinks: () => [],
}));

vi.mock('@/components/features/reports/compliance-checklist', () => ({
  ComplianceChecklist: () => <div data-testid="compliance-checklist" />,
  deriveReportComplianceChecks: () => [],
}));

vi.mock('@/components/features/visits/patient-care-team-source-panel', () => ({
  PatientCareTeamSourcePanel: () => <div data-testid="care-team-source" />,
}));

vi.mock('@/components/features/reports/physician-report-view', () => ({
  PhysicianReportView: () => <div data-testid="physician-report-view" />,
}));

vi.mock('@/components/features/reports/care-manager-report-view', () => ({
  CareManagerReportView: () => <div data-testid="care-manager-report-view" />,
}));

vi.mock('@/components/features/reports/report-edit-form', () => ({
  ReportEditForm: () => <form data-testid="report-edit-form" />,
}));

import ReportDetailPage from './page';

setupDomTestEnv();

const structuredPhysicianContent = {
  patient: { name: '佐藤 花子', birth_date: '1940-01-01', gender: 'female' },
  report_date: '2026-05-12',
  visit_date: '2026-03-29',
  pharmacist_name: '薬剤師 太郎',
  prescriber: { name: '山田 太郎', institution: '青葉内科' },
  prescriptions: [
    {
      drug_name: 'アムロジピン錠5mg',
      dose: '1錠',
      frequency: '1日1回朝食後',
      days: 14,
    },
  ],
  medication_management: {
    compliance_summary: 'カレンダー管理で概ね服薬できています',
    adherence_score: 92,
    self_management: '家族確認あり',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    sleep: '良好',
    cognition: '変化なし',
    diet_oral: '摂取良好',
    mobility: '屋内歩行可能',
    excretion: '問題なし',
  },
  residual_medications: [
    {
      drug_name: 'アムロジピン錠5mg',
      remaining_qty: 4,
      excess_days: 2,
      reduction_proposal: false,
    },
  ],
  assessment: '服薬管理は安定しています',
  plan: '次回訪問で残薬を再確認します',
  physician_communication: '処方継続で問題ありません',
  warnings: [],
};

function mockReport() {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    patient_summary: {
      id: 'patient_1',
      name: '佐藤 花子',
      name_kana: 'サトウ ハナコ',
      birth_date: '1940-01-01',
    },
    visit_summary: {
      id: 'visit_record_1',
      visit_date: '2026-03-29T09:00:00.000Z',
    },
    report_type: 'physician_report',
    status: 'draft',
    content: structuredPhysicianContent,
    pdf_url: null,
    created_by: 'user_1',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    delivery_records: [],
    prescriber_institution_suggestion: null,
    delivery_rule_suggestion: null,
  };
}

describe('ReportDetailPage send safety dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useParamsMock.mockReturnValue({ id: 'report_1' });
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: sendMutateMock,
      isPending: false,
    });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: { data: mockReport() },
        isLoading: false,
      };
    });
  });

  it('blocks report sending until recipient fields and safety acknowledgement are confirmed', () => {
    render(<ReportDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: '送付' }));

    expect(screen.getByRole('dialog', { name: '報告書を送付' })).toBeTruthy();
    expect(screen.getByText('送付前確認')).toBeTruthy();
    expect(screen.getByText('佐藤 花子')).toBeTruthy();
    expect(screen.getByText('サトウ ハナコ')).toBeTruthy();
    expect(screen.getByText('1940/01/01')).toBeTruthy();
    expect(screen.getByText('2026/03/29')).toBeTruthy();
    expect(screen.getAllByText('patient_1').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText('例: 山田 太郎 先生'), {
      target: { value: '  山田 太郎  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('メールアドレスまたはFAX番号'), {
      target: { value: '  doctor@example.com  ' },
    });
    expect(screen.getByText('山田 太郎')).toBeTruthy();
    expect(screen.getByText('doctor@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '送付する' }));

    expect(sendMutateMock).not.toHaveBeenCalled();
    expect(screen.getByText('患者、送付先、チャネルを確認してください')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '患者、訪問日、報告書種別、送付先氏名、連絡先、送付チャネルを確認しました',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '送付する' }));

    expect(sendMutateMock).toHaveBeenCalledWith({
      channel: 'email',
      recipient_name: '山田 太郎',
      recipient_contact: 'doctor@example.com',
      safety_ack: true,
    });
  });

  it('opens the report composer from the current report detail workspace', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: {
            data: [
              {
                id: 'professional_1',
                name: '鈴木 ケアマネ',
                profession_type: 'care_manager',
                organization_name: '青葉ケアプラン',
                email: 'care@example.com',
                fax: null,
                phone: '03-0000-0000',
              },
            ],
          },
          isLoading: false,
        };
      }

      return {
        data: { data: mockReport() },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByTestId('readiness-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '共有を作成' }));

    expect(screen.getByTestId('report-composer')).toBeTruthy();
    expect(screen.getByText('共有先')).toBeTruthy();
    expect(screen.getByText('報告内容')).toBeTruthy();
    expect(screen.getByText('送付前チェック')).toBeTruthy();
    expect(screen.getByText('一括送付（1件）')).toBeTruthy();
  });

  it('does not display or send legacy title/body report content', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: {
          data: {
            ...mockReport(),
            content: {
              title: '服薬情報提供書',
              body: '訪問記録から生成された報告内容',
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByText('構造化された報告内容がありません')).toBeTruthy();
    expect(screen.queryByText('服薬情報提供書')).toBeNull();
    expect(screen.queryByText('訪問記録から生成された報告内容')).toBeNull();
    expect(screen.queryByRole('button', { name: '送付' })).toBeNull();
    expect(screen.queryByRole('button', { name: '共有を作成' })).toBeNull();
  });

  it('waits for share target suggestions before opening the auto-selected composer', () => {
    let externalSuggestions: unknown[] = [];
    let externalSuggestionsLoading = true;
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: externalSuggestions },
          isLoading: externalSuggestionsLoading,
          isFetching: externalSuggestionsLoading,
        };
      }

      return {
        data: {
          data: {
            ...mockReport(),
            prescriber_institution_suggestion: {
              id: 'institution_1',
              name: '青葉内科',
              phone: null,
              fax: '03-1111-1111',
              address: null,
              recommended_channels: ['fax'],
              prescribed_date: '2026-03-28T00:00:00.000Z',
              prescriber_name: '青葉 医師',
            },
            delivery_rule_suggestion: {
              document_type: 'care_report',
              target_role: 'physician',
              channel: 'fax',
              fallback_channels: ['email'],
            },
          },
        },
        isLoading: false,
      };
    });

    const { rerender } = render(<ReportDetailPage />);

    const loadingButton = screen.getByRole('button', { name: '共有先を確認中...' });
    expect((loadingButton as HTMLButtonElement).disabled).toBe(true);

    externalSuggestions = [
      {
        id: 'professional_1',
        name: '鈴木 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '青葉ケアプラン',
        email: 'care@example.com',
        fax: null,
        phone: '03-0000-0000',
        department: null,
        address: null,
        preferred_contact_method: 'email',
        preferred_contact_time: null,
        last_contacted_at: null,
        last_success_channel: null,
        recommended_channels: ['email'],
        is_primary: true,
      },
    ];
    externalSuggestionsLoading = false;
    rerender(<ReportDetailPage />);

    const createButton = screen.getByRole('button', { name: '共有を作成' });
    expect((createButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(createButton);

    expect(screen.getByText('一括送付（2件）')).toBeTruthy();
  });
});
