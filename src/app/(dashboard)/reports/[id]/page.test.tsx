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
    content: {
      title: '服薬情報提供書',
      body: '訪問記録から生成された報告内容',
    },
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
});
