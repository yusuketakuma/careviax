// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildReportHref } from '@/lib/reports/navigation';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const sendMutateMock = vi.hoisted(() => vi.fn());
const getReportDetailShortcutLinksMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string, extra?: Record<string, string>) => ({ 'x-org-id': orgId, ...extra })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string, extra?: Record<string, string>) => ({
    'Content-Type': 'application/json',
    'x-org-id': orgId,
    ...extra,
  })),
);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
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

vi.mock('@/lib/reports/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports/navigation')>();
  return {
    ...actual,
    buildReportHref: vi.fn(actual.buildReportHref),
  };
});

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

const HOSTILE_REPORT_ID = 'report/1?x=y#z';
const ENCODED_HOSTILE_REPORT_ID = 'report%2F1%3Fx%3Dy%23z';

type QueryConfig = {
  queryKey?: unknown[];
  queryFn?: () => Promise<unknown>;
  enabled?: boolean;
};

type MutationConfig<TInput = unknown> = {
  mutationFn?: (input?: TInput) => Promise<unknown>;
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

  it('pins the shared patient identity band above the fold', () => {
    render(<ReportDetailPage />);

    const header = screen.getByTestId('patient-header');
    expect(header).toBeTruthy();
    // 患者識別がダイアログを開かずに fold 内へ常時表示される（取り違え防止）。
    expect(within(header).getByText('佐藤 花子 様')).toBeTruthy();
    expect(within(header).getByText('サトウ ハナコ')).toBeTruthy();
  });

  it('summarizes report content warnings above the body so they are not buried on mobile', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'care-report-external-professionals') {
        return { data: { data: [] }, isLoading: false };
      }
      return {
        data: {
          data: {
            ...mockReport(),
            content: {
              ...structuredPhysicianContent,
              warnings: ['用法用量の記載がありません', '相互作用の確認が未完了です'],
            },
          },
        },
        isLoading: false,
      };
    });

    render(<ReportDetailPage />);

    const summary = screen.getByTestId('report-warnings-summary');
    expect(summary).toBeTruthy();
    expect(within(summary).getByText('報告内容に確認事項があります（2件）')).toBeTruthy();
    expect(within(summary).getByText('用法用量の記載がありません')).toBeTruthy();
    expect(within(summary).getByText('相互作用の確認が未完了です')).toBeTruthy();
  });

  it('does not render a warnings summary when there are no content warnings', () => {
    render(<ReportDetailPage />);

    expect(screen.queryByTestId('report-warnings-summary')).toBeNull();
  });

  it('blocks report sending until recipient fields and safety acknowledgement are confirmed', () => {
    render(<ReportDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: '送付' }));

    const sendDialog = screen.getByRole('dialog', { name: '報告書を送付' });
    expect(sendDialog).toBeTruthy();
    expect(screen.getByText('送付前確認')).toBeTruthy();
    expect(screen.getByLabelText('送付チャネル')).toBeTruthy();
    expect((screen.getByLabelText(/送付先連絡先/) as HTMLInputElement).required).toBe(true);
    expect(
      screen.getByText('メール送信ではメールアドレス、FAX送信ではFAX番号を入力してください。'),
    ).toBeTruthy();
    // 患者識別は共通 PatientHeader バンドと送付ダイアログの双方に出るため、ダイアログ内に限定して検証する。
    expect(within(sendDialog).getByText('佐藤 花子')).toBeTruthy();
    expect(within(sendDialog).getByText('サトウ ハナコ')).toBeTruthy();
    expect(within(sendDialog).getByText('1940/01/01')).toBeTruthy();
    expect(within(sendDialog).getByText('2026/03/29')).toBeTruthy();
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
    const submitButton = screen.getByRole('button', { name: '一括送付（1件）' });
    expect(
      screen
        .getByText('未確認: 薬剤師確認済み、宛先が設定済み、添付資料あり、患者情報の出しすぎなし')
        .getAttribute('role'),
    ).toBe('alert');
    expect(submitButton.getAttribute('aria-describedby')).toContain('report-composer-checks-error');

    fireEvent.click(screen.getByRole('checkbox', { name: /鈴木 医師 を共有先に含める/ }));

    const unselectedSubmitButton = screen.getByRole('button', { name: '一括送付（0件）' });
    expect(screen.getByText('共有先を1件以上選択してください').getAttribute('role')).toBe('alert');
    expect(unselectedSubmitButton.getAttribute('aria-describedby')).toContain(
      'report-composer-recipient-error',
    );
    expect(unselectedSubmitButton.getAttribute('aria-describedby')).toContain(
      'report-composer-checks-error',
    );
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

  it('encodes hostile report ids once for the GET query while preserving the raw query key', async () => {
    const queryConfigs: QueryConfig[] = [];
    useParamsMock.mockReturnValue({ id: HOSTILE_REPORT_ID });
    useQueryMock.mockImplementation((options: QueryConfig) => {
      queryConfigs.push(options);
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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: mockReport() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    render(<ReportDetailPage />);

    const detailQuery = queryConfigs.find((config) => config.queryKey?.[0] === 'care-report');
    expect(detailQuery?.queryKey).toEqual(['care-report', HOSTILE_REPORT_ID, 'org_1']);

    await detailQuery?.queryFn?.();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(`/api/care-reports/${ENCODED_HOSTILE_REPORT_ID}`);
    expect(url).not.toContain('?');
    expect(url).not.toContain('#');
    expect(url).not.toContain('%25');
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { 'x-org-id': 'org_1' },
      }),
    );
  });

  it('encodes hostile report ids for draft confirmation without changing the body', async () => {
    const mutationConfigs: Array<MutationConfig> = [];
    useParamsMock.mockReturnValue({ id: HOSTILE_REPORT_ID });
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return {
        mutate: sendMutateMock,
        isPending: false,
      };
    });
    useQueryMock.mockImplementation((options: QueryConfig) => {
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
      `/api/care-reports/${ENCODED_HOSTILE_REPORT_ID}`,
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        },
        body: JSON.stringify({
          expected_updated_at: '2026-05-12T00:00:00.000Z',
          status: 'confirmed',
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('?');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('#');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('%25');
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('encodes hostile report ids for single and bulk send while preserving idempotency headers and bodies', async () => {
    const mutationConfigs: Array<MutationConfig> = [];
    useParamsMock.mockReturnValue({ id: HOSTILE_REPORT_ID });
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return {
        mutate: sendMutateMock,
        isPending: false,
      };
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const singleBody = {
      channel: 'email',
      recipient_name: '山田 太郎',
      recipient_contact: 'doctor@example.com',
      recipient_role: 'physician',
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    };
    const bulkBody = {
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
    };

    render(<ReportDetailPage />);

    await mutationConfigs[1]?.mutationFn?.(singleBody);
    await mutationConfigs[2]?.mutationFn?.(bulkBody);

    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      expect(url).toBe(`/api/care-reports/${ENCODED_HOSTILE_REPORT_ID}/send`);
      expect(url).not.toContain('?');
      expect(url).not.toContain('#');
      expect(url).not.toContain('%25');
      expect(call[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-org-id': 'org_1',
            'Idempotency-Key': expect.stringMatching(/^care-report-send:/),
          }),
        }),
      );
    }
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(singleBody));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(bulkBody));
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({
        'Idempotency-Key': expect.stringMatching(/^care-report-send:/),
      }),
    );
  });

  it('encodes hostile report ids for PDF, print, and share hrefs', () => {
    useParamsMock.mockReturnValue({ id: HOSTILE_REPORT_ID });

    render(<ReportDetailPage />);

    const hrefs = [
      screen.getByRole('link', { name: 'PDFを開く' }).getAttribute('href'),
      screen.getByRole('link', { name: '印刷ビュー' }).getAttribute('href'),
      screen.getByRole('link', { name: '他職種共有' }).getAttribute('href'),
    ];
    expect(hrefs).toEqual([
      `/api/care-reports/${ENCODED_HOSTILE_REPORT_ID}/pdf`,
      `/reports/${ENCODED_HOSTILE_REPORT_ID}/print`,
      `/reports/${ENCODED_HOSTILE_REPORT_ID}/share`,
    ]);
    expect(buildReportHref).toHaveBeenCalledWith(HOSTILE_REPORT_ID, '/print');
    expect(buildReportHref).toHaveBeenCalledWith(HOSTILE_REPORT_ID, '/share');
    for (const href of hrefs) {
      expect(href).not.toContain('?');
      expect(href).not.toContain('#');
      expect(href).not.toContain('%25');
    }
  });

  it.each(['.', '..'])(
    'fails fast before fetching for exact dot-segment report id "%s"',
    async (dotSegmentId) => {
      const queryConfigs: QueryConfig[] = [];
      const mutationConfigs: Array<MutationConfig> = [];
      useParamsMock.mockReturnValue({ id: dotSegmentId });
      useQueryMock.mockImplementation((options: QueryConfig) => {
        queryConfigs.push(options);
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
      useMutationMock.mockImplementation((config: MutationConfig) => {
        mutationConfigs.push(config);
        return {
          mutate: sendMutateMock,
          isPending: false,
        };
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: { ok: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      );

      render(<ReportDetailPage />);

      const detailQuery = queryConfigs.find((config) => config.queryKey?.[0] === 'care-report');
      await expect(detailQuery?.queryFn?.()).rejects.toThrow(RangeError);
      await expect(mutationConfigs[0]?.mutationFn?.()).rejects.toThrow(RangeError);
      await expect(
        mutationConfigs[1]?.mutationFn?.({
          channel: 'email',
          recipient_name: '山田 太郎',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
          expected_updated_at: '2026-05-12T00:00:00.000Z',
          safety_ack: true,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        mutationConfigs[2]?.mutationFn?.({
          recipients: [],
          expected_updated_at: '2026-05-12T00:00:00.000Z',
          safety_ack: true,
        }),
      ).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['.', '..'])(
    'throws instead of rendering output links for report id "%s"',
    (dotSegmentId) => {
      useParamsMock.mockReturnValue({ id: dotSegmentId });
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        expect(() => render(<ReportDetailPage />)).toThrow(RangeError);
      } finally {
        consoleErrorMock.mockRestore();
      }
    },
  );

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
