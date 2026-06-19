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
const getReportDetailShortcutLinksMock = vi.hoisted(() => vi.fn());

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
  WorkflowPageIntro: ({
    title,
    actions,
    shortcuts,
  }: {
    title: string;
    actions?: React.ReactNode;
    shortcuts?: Array<{ href: string; label: string }>;
  }) => (
    <header>
      <h1>{title}</h1>
      <nav aria-label="ショートカット">
        {shortcuts?.map((shortcut) => (
          <a key={`${shortcut.href}-${shortcut.label}`} href={shortcut.href}>
            {shortcut.label}
          </a>
        ))}
      </nav>
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
  getReportDetailShortcutLinks: getReportDetailShortcutLinksMock,
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
  ReportEditForm: ({ updatedAt }: { updatedAt: string }) => (
    <form data-testid="report-edit-form" data-updated-at={updatedAt} />
  ),
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
    status: 'confirmed',
    content: structuredPhysicianContent,
    pdf_url: null,
    created_by: 'user_1',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    delivery_records: [],
    prescriber_institution_suggestion: null,
    delivery_rule_suggestion: null,
    permissions: {
      can_edit: true,
      can_send: true,
      can_create_external_share: true,
      can_create_followup_task: true,
      can_view_patient: true,
      can_view_related_requests: true,
    },
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
    getReportDetailShortcutLinksMock.mockReturnValue([
      { href: '/reports', label: '報告書一覧' },
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/communications/requests?related_entity_id=report_1', label: '関連依頼' },
      { href: '/external', label: '外部連携' },
    ]);
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
    expect((screen.getByLabelText(/送付先連絡先/) as HTMLInputElement).required).toBe(true);
    expect(
      screen.getByText('メール送信ではメールアドレス、FAX送信ではFAX番号を入力してください。'),
    ).toBeTruthy();
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
      recipient_role: 'physician',
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    });
  });

  it('resends failed reports through the same safety-checked delivery flow', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: { data: { ...mockReport(), status: 'failed' } },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: '再送' }));

    expect(screen.getByRole('dialog', { name: '報告書を再送' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('例: 山田 太郎 先生'), {
      target: { value: '  山田 太郎  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('メールアドレスまたはFAX番号'), {
      target: { value: '  doctor@example.com  ' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '患者、訪問日、報告書種別、送付先氏名、連絡先、送付チャネルを確認しました',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '再送する' }));

    expect(sendMutateMock).toHaveBeenCalledWith({
      channel: 'email',
      recipient_name: '山田 太郎',
      recipient_contact: 'doctor@example.com',
      recipient_role: 'physician',
      expected_updated_at: '2026-05-12T00:00:00.000Z',
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
                name: '鈴木 医師',
                profession_type: 'physician',
                organization_name: '青葉内科',
                email: 'doctor2@example.com',
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

  it('opens the report composer as a resend workspace for response-waiting reports', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: {
            data: [
              {
                id: 'professional_1',
                name: '鈴木 医師',
                profession_type: 'physician',
                organization_name: '青葉内科',
                email: 'doctor2@example.com',
                fax: null,
                phone: '03-0000-0000',
              },
            ],
          },
          isLoading: false,
        };
      }

      return {
        data: { data: { ...mockReport(), status: 'response_waiting' } },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByRole('button', { name: '再送' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '共有を作成' }));

    expect(screen.getByTestId('report-composer')).toBeTruthy();
    expect(screen.getByText('報告書を再送・共有')).toBeTruthy();
  });

  it('passes the current report version into the inline edit form', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: { data: { ...mockReport(), status: 'draft' } },
        isLoading: false,
      };
    });
    render(<ReportDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: '編集' }));

    expect(screen.getByTestId('report-edit-form').getAttribute('data-updated-at')).toBe(
      '2026-05-12T00:00:00.000Z',
    );
  });

  it('confirms drafts with the current report version token', async () => {
    const mutationConfigs: Array<{ mutationFn?: () => Promise<unknown> }> = [];
    useMutationMock.mockImplementation((config: { mutationFn?: () => Promise<unknown> }) => {
      mutationConfigs.push(config);
      return {
        mutate: sendMutateMock,
        isPending: false,
      };
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
        data: { data: { ...mockReport(), status: 'draft' } },
        isLoading: false,
      };
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { status: 'confirmed' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    render(<ReportDetailPage />);

    await mutationConfigs[0]?.mutationFn?.();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/care-reports/report_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          expected_updated_at: '2026-05-12T00:00:00.000Z',
          status: 'confirmed',
        }),
      }),
    );
  });

  it('sends report delivery mutations with idempotency headers', async () => {
    const mutationConfigs: Array<{ mutationFn?: (input: unknown) => Promise<unknown> }> = [];
    useMutationMock.mockImplementation(
      (config: { mutationFn?: (input: unknown) => Promise<unknown> }) => {
        mutationConfigs.push(config);
        return {
          mutate: sendMutateMock,
          isPending: false,
        };
      },
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    render(<ReportDetailPage />);

    await mutationConfigs[1]?.mutationFn?.({
      channel: 'email',
      recipient_name: '山田 太郎',
      recipient_contact: 'doctor@example.com',
      recipient_role: 'physician',
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    });
    await mutationConfigs[2]?.mutationFn?.({
      recipients: [
        {
          channel: 'fax',
          recipient_name: '青葉内科',
          recipient_contact: '03-1111-1111',
          recipient_role: 'physician',
        },
      ],
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/care-reports/report_1/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
          'Idempotency-Key': expect.stringMatching(/^care-report-send:/),
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      expected_updated_at: '2026-05-12T00:00:00.000Z',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/care-reports/report_1/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
          'Idempotency-Key': expect.stringMatching(/^care-report-send:/),
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      expected_updated_at: '2026-05-12T00:00:00.000Z',
    });
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

  it('hides sending and PDF output actions until the pharmacist confirms the draft', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: { data: { ...mockReport(), status: 'draft' } },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByRole('button', { name: '編集' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '送付' })).toBeNull();
    expect(screen.queryByRole('button', { name: '共有を作成' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'PDFを開く' })).toBeNull();
    expect(screen.queryByRole('link', { name: '印刷ビュー' })).toBeNull();
  });

  it('hides editing, draft confirmation, and send actions when the role can only view reports', () => {
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
            status: 'draft',
            permissions: {
              can_edit: false,
              can_send: false,
              can_create_external_share: false,
              can_create_followup_task: false,
              can_view_patient: false,
              can_view_related_requests: true,
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.queryByRole('button', { name: '編集' })).toBeNull();
    expect(screen.queryByRole('button', { name: '薬剤師確認済みにする' })).toBeNull();
    expect(screen.queryByRole('button', { name: '送付' })).toBeNull();
    expect(screen.queryByRole('button', { name: '共有を作成' })).toBeNull();
    expect(screen.queryByRole('link', { name: '印刷ビュー' })).toBeNull();
    expect(screen.queryByRole('link', { name: '他職種共有' })).toBeNull();
    expect(screen.getByText('薬剤師確認待ちです')).toBeTruthy();
    expect(screen.getByTestId('physician-report-view')).toBeTruthy();
  });

  it('hides confirmed report output and share shortcuts when the role cannot send reports', () => {
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
            status: 'confirmed',
            external_professional_suggestions: [
              {
                id: 'external_professional_1',
                name: '中島 桜',
                profession_type: 'care_manager',
                organization_name: 'きたきゅうケアプラン',
                department: null,
                phone: '090-1111-2222',
                email: null,
                fax: null,
                address: null,
                preferred_contact_method: null,
                preferred_contact_time: null,
                last_contacted_at: null,
                last_success_channel: null,
                recommended_channels: ['phone'],
                contact_reliability: {
                  ready: true,
                  warnings: [],
                  missing_channel_labels: [],
                },
                is_primary: true,
                source: 'patient_care_team',
              },
            ],
            permissions: {
              can_edit: false,
              can_send: false,
              can_create_external_share: false,
              can_create_followup_task: false,
              can_view_patient: true,
              can_view_related_requests: true,
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.queryByRole('link', { name: 'PDFを開く' })).toBeNull();
    expect(screen.queryByRole('link', { name: '印刷ビュー' })).toBeNull();
    expect(screen.queryByRole('link', { name: '他職種共有' })).toBeNull();
    expect(screen.getByTestId('physician-report-view')).toBeTruthy();
    expect(screen.queryByTestId('care-team-source')).toBeNull();
    const externalQueryCall = useQueryMock.mock.calls.find(
      ([options]) =>
        (options as { queryKey?: unknown[] }).queryKey?.[0] ===
        'care-report-external-professionals',
    );
    expect((externalQueryCall?.[0] as { enabled?: boolean } | undefined)?.enabled).toBe(false);
  });

  it('keeps direct send visible but hides external share entry points when external share permission is denied', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return {
          data: {
            data: [
              {
                id: 'professional_1',
                name: '鈴木 医師',
                profession_type: 'physician',
                organization_name: '青葉内科',
                email: 'doctor2@example.com',
                fax: null,
                phone: '03-0000-0000',
              },
            ],
          },
          isLoading: false,
        };
      }

      return {
        data: {
          data: {
            ...mockReport(),
            permissions: {
              can_edit: false,
              can_send: true,
              can_create_external_share: false,
              can_create_followup_task: false,
              can_view_patient: true,
              can_view_related_requests: true,
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByRole('button', { name: '送付' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '共有を作成' })).toBeNull();
    expect(screen.queryByRole('link', { name: '他職種共有' })).toBeNull();
  });

  it('filters report detail shortcuts by the route permission metadata', () => {
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
            permissions: {
              can_edit: false,
              can_send: false,
              can_create_external_share: false,
              can_create_followup_task: false,
              can_view_patient: false,
              can_view_related_requests: false,
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByRole('link', { name: '報告書一覧' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '外部連携' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '患者詳細' })).toBeNull();
    expect(screen.queryByRole('link', { name: '関連依頼' })).toBeNull();
  });

  it('shows a retryable error state when the report detail query fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return { data: { data: [] }, isLoading: false };
      }
      return {
        data: undefined,
        isLoading: false,
        error: new Error('報告書の取得に失敗しました'),
        refetch,
      };
    });

    render(<ReportDetailPage />);

    expect(screen.getByText('報告書を取得できませんでした')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('報告書が見つかりません')).toBeNull();
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
        name: '鈴木 医師',
        profession_type: 'physician',
        organization_name: '青葉内科',
        email: 'doctor2@example.com',
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
