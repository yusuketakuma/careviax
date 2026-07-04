// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const { useQueryMock, useMutationMock, useQueryClientMock, useOrgIdMock, routerPushMock } =
  vi.hoisted(() => ({
    useQueryMock: vi.fn(),
    useMutationMock: vi.fn(),
    useQueryClientMock: vi.fn(),
    useOrgIdMock: vi.fn(),
    routerPushMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Heavy child components are stubbed: this suite only proves the fetch-error banner +
// retry wiring on the parent, not the children's internals.
vi.mock('@/components/features/visits/visit-report-readiness-panel', () => ({
  VisitReportReadinessPanel: ({
    items,
  }: {
    items?: Array<{ key: string; description?: string; done?: boolean }>;
  }) => (
    <div data-testid="readiness-panel">
      {(items ?? []).map((item) => (
        <div
          key={item.key}
          data-testid={`readiness-item-${item.key}`}
          data-done={String(Boolean(item.done))}
        >
          {item.description}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('@/components/features/visits/patient-care-team-source-panel', () => ({
  PatientCareTeamSourcePanel: () => <div data-testid="care-team-panel" />,
}));
vi.mock('./visit-reflected-fields-card', () => ({
  VisitReflectedFieldsCard: () => <div data-testid="reflected-fields" />,
}));

import { VisitRecordDetail } from './visit-record-detail';
import { toast } from 'sonner';

setupDomTestEnv();

const RECORD = {
  id: 'record_1',
  schedule_id: 'schedule_1',
  patient_id: 'patient_1',
  pharmacist_id: 'pharmacist_1',
  visit_date: '2026-06-11',
  outcome_status: 'completed',
  soap_subjective: 'S',
  soap_objective: 'O',
  soap_assessment: 'A',
  soap_plan: 'P',
  structured_soap: null,
  receipt_person_name: null,
  receipt_person_relation: null,
  receipt_at: null,
  next_visit_suggestion_date: null,
  cancellation_reason: null,
  postpone_reason: null,
  revisit_reason: null,
  version: 1,
  created_at: '2026-06-11T00:00:00.000Z',
  updated_at: '2026-06-11T00:00:00.000Z',
  pharmacist_name: '田中 薬剤師',
  last_modified_by_id: null,
  last_modified_by_name: null,
  attachments: [],
  visit_geo_log: null,
  schedule: {
    id: 'schedule_1',
    case_id: 'case_1',
    site_id: 'site_1',
    pharmacist_id: 'pharmacist_1',
    visit_type: 'home',
    scheduled_date: '2026-06-11',
    recurrence_rule: null,
    time_window_start: null,
    time_window_end: null,
  },
};

type HeaderSummaryStub = {
  name: string;
  name_kana: string | null;
  birth_date: string;
  gender_label: string;
  care_level_label: string | null;
  residence_label: string | null;
  primary_diagnosis: string | null;
  intervention_start_date: string | null;
  primary_pharmacist_name: string | null;
  backup_pharmacist_name: string | null;
  primary_staff_name: string | null;
  backup_staff_name: string | null;
  safety: {
    allergy: string | null;
    renal: string | null;
    handling_tags: string[];
    swallowing: string | null;
    cautions: string[];
  };
};

const HEADER_SUMMARY: HeaderSummaryStub = {
  name: '訪問花子',
  name_kana: 'ホウモンハナコ',
  birth_date: '1948-04-10T00:00:00.000Z',
  gender_label: '女性',
  care_level_label: '要介護3',
  residence_label: '自宅',
  primary_diagnosis: '高血圧症',
  intervention_start_date: null,
  primary_pharmacist_name: '担当薬剤師',
  backup_pharmacist_name: null,
  primary_staff_name: null,
  backup_staff_name: null,
  safety: {
    allergy: 'ペニシリン',
    renal: null,
    handling_tags: [],
    swallowing: null,
    cautions: [],
  },
};

type QueryStubOptions = {
  careReportsError?: boolean;
  billingError?: boolean;
  residualsError?: boolean;
  visitPreparationError?: boolean;
  headerSummary?: HeaderSummaryStub | null;
  headerSummaryError?: boolean;
  headerSummaryLoading?: boolean;
  residuals?: Array<Record<string, unknown>>;
  billingBlockers?: Array<{ key: string; reason: string; severity?: 'high' | 'normal' }>;
  record?: typeof RECORD;
  recordLoading?: boolean;
};

type MutationConfig = {
  onError?: (error: Error) => void;
};

function setupQueries(options: QueryStubOptions = {}) {
  const refetchSpies: Record<string, ReturnType<typeof vi.fn>> = {
    'care-reports-by-visit': vi.fn(),
    'billing-candidates-by-visit': vi.fn(),
    'residual-medications': vi.fn(),
    'visit-preparation-care-team': vi.fn(),
    'patient-header-summary': vi.fn(),
  };
  const mutationConfigs: MutationConfig[] = [];
  useOrgIdMock.mockReturnValue('org_1');
  useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
  useMutationMock.mockImplementation((config: MutationConfig) => {
    mutationConfigs.push(config);
    return { mutate: vi.fn(), isPending: false };
  });
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'visit-record') {
      if (options.recordLoading) {
        return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
      }
      return { data: options.record ?? RECORD, isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (key === 'patient-header-summary') {
      if (options.headerSummaryError) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchSpies['patient-header-summary'],
        };
      }
      if (options.headerSummaryLoading) {
        return {
          data: undefined,
          isLoading: true,
          isError: false,
          refetch: refetchSpies['patient-header-summary'],
        };
      }
      return {
        data: options.headerSummary === null ? undefined : (options.headerSummary ?? undefined),
        isLoading: false,
        isError: false,
        refetch: refetchSpies['patient-header-summary'],
      };
    }
    if (key === 'visit-preparation-care-team') {
      if (options.visitPreparationError) {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchSpies['visit-preparation-care-team'],
        };
      }
      return {
        data: {
          data: {
            pack: {
              care_team: [],
              billing_blockers: options.billingBlockers ?? [],
              intake_context: { initial_transition_management_expected: null },
              conference_context: null,
            },
          },
        },
        isLoading: false,
        isError: false,
        refetch: refetchSpies['visit-preparation-care-team'],
      };
    }
    if (key === 'care-reports-by-visit') {
      return {
        data: options.careReportsError ? undefined : { data: [] },
        isError: Boolean(options.careReportsError),
        refetch: refetchSpies['care-reports-by-visit'],
      };
    }
    if (key === 'billing-candidates-by-visit') {
      return {
        data: options.billingError ? undefined : { data: [] },
        isError: Boolean(options.billingError),
        refetch: refetchSpies['billing-candidates-by-visit'],
      };
    }
    if (key === 'residual-medications') {
      return {
        data: options.residualsError ? undefined : (options.residuals ?? []),
        isError: Boolean(options.residualsError),
        refetch: refetchSpies['residual-medications'],
      };
    }
    // visit-preparation-care-team and any other secondary queries
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
  return { refetchSpies, mutationConfigs };
}

function expectMutationErrorToast(config: MutationConfig, serverMessage: string, fallback: string) {
  config.onError?.(new Error(serverMessage));
  expect(toast.error).toHaveBeenLastCalledWith(serverMessage);

  config.onError?.(new Error(''));
  expect(toast.error).toHaveBeenLastCalledWith(fallback);
}

describe('VisitRecordDetail fetch-error handling (no false-empty workflow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no workflow data warning when all secondary queries succeed', () => {
    setupQueries();
    render(<VisitRecordDetail recordId="record_1" />);
    expect(screen.queryByText(/データの一部を取得できませんでした/)).toBeNull();
  });

  it('keeps server messages and falls back for mutation error toasts', () => {
    const { mutationConfigs } = setupQueries();
    render(<VisitRecordDetail recordId="record_1" />);

    expect(mutationConfigs).toHaveLength(3);
    const [generateReport, createNextVisit, generateBillingCandidates] = mutationConfigs;
    expectMutationErrorToast(
      generateReport,
      '報告書APIからの詳細エラー',
      '報告書の生成に失敗しました',
    );
    expectMutationErrorToast(
      createNextVisit,
      '訪問予定APIからの詳細エラー',
      '次回訪問予定の作成に失敗しました',
    );
    expectMutationErrorToast(
      generateBillingCandidates,
      '請求候補APIからの詳細エラー',
      '請求候補の生成に失敗しました',
    );
  });

  it('pins the patient identity and allergy safety tag above the visit summary (SSOT 2.3)', () => {
    setupQueries({ headerSummary: HEADER_SUMMARY });
    render(<VisitRecordDetail recordId="record_1" />);

    // 患者識別(氏名)と重大安全タグ(アレルギー)が訪問詳細に常時表示される(sticky)。
    const header = screen.getByTestId('patient-header');
    expect(header.getAttribute('data-sticky')).toBe('true');
    expect(header.textContent).toContain('訪問花子');
    expect(header.textContent).toContain('ペニシリン');
    expect(screen.queryByTestId('visit-patient-header-error')).toBeNull();
  });

  it('fails closed with an alert when the patient header summary cannot be loaded', () => {
    const { refetchSpies } = setupQueries({ headerSummaryError: true });
    render(<VisitRecordDetail recordId="record_1" />);

    // 取得失敗を「安全タグなし」と誤認させない(fail-close)。role=alert + 再試行導線。
    const banner = screen.getByTestId('visit-patient-header-error');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('「なし」とは判断せず');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchSpies['patient-header-summary']).toHaveBeenCalledTimes(1);
  });

  it('renders outcome via 6-axis StateBadge and hazard-token 減数禁止 with tabular numerals', () => {
    setupQueries({
      residuals: [
        {
          id: 'residual_1',
          drug_name: 'アムロジピン',
          prescribed_quantity: 28,
          remaining_quantity: 10,
          excess_days: 3,
          is_prohibited_reduction: true,
          is_reduction_target: false,
        },
      ],
    });
    render(<VisitRecordDetail recordId="record_1" />);

    // outcome(completed) は raw variant でなく StateBadge role=done で描く(SSOT 7.3/§10)。
    const outcomeBadge = screen.getByText('完了').closest('[data-role]');
    expect(outcomeBadge?.getAttribute('data-role')).toBe('done');
    // 減数禁止は raw destructive でなく tag-hazard トークン。
    // DataTable はデスクトップ表/モバイルカードを両方 DOM に描画するため getAllByText で拾う。
    const prohibited = screen.getAllByText('減数禁止')[0];
    expect(prohibited.className).toContain('text-tag-hazard');
    expect(prohibited.className).not.toContain('text-destructive');
    // 数値列は tabular-nums(SSOT 3.8)。
    expect(screen.getAllByText('10')[0].className).toContain('tabular-nums');
    // 最上部の主見出しは h2(SSOT 4.5)。
    expect(screen.getByRole('heading', { level: 2, name: /訪問記録$/ })).toBeTruthy();
  });

  it('reserves the header area with a labelled skeleton while loading (no false-empty)', () => {
    setupQueries({ headerSummaryLoading: true });
    render(<VisitRecordDetail recordId="record_1" />);

    expect(screen.getByRole('status', { name: '患者情報を読み込み中' })).toBeTruthy();
    expect(screen.queryByTestId('visit-patient-header-error')).toBeNull();
  });

  it('uses a named skeleton while the visit record is loading', () => {
    setupQueries({ recordLoading: true });
    render(<VisitRecordDetail recordId="record_1" />);

    expect(screen.getByRole('status', { name: '訪問記録を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('訪問記録を読み込めませんでした')).toBeNull();
  });

  it('uses soap identity tokens instead of raw Tailwind colors (FEUX-4)', () => {
    setupQueries();
    const { container } = render(<VisitRecordDetail recordId="record_1" />);

    // SOAP S/O/A/P は専用トークン(--soap-*)で識別する(SSOT: 生 Tailwind 直書き禁止)。
    for (const token of ['text-soap-s', 'text-soap-o', 'text-soap-a', 'text-soap-p']) {
      expect(container.querySelector(`.${token}`)).toBeTruthy();
    }
    for (const raw of ['text-blue-500', 'text-green-500', 'text-purple-500', 'text-orange-500']) {
      expect(container.querySelector(`.${raw}`)).toBeNull();
    }
  });

  it('surfaces a warning and refetches every failed secondary query on retry', () => {
    const { refetchSpies } = setupQueries({
      careReportsError: true,
      billingError: true,
      residualsError: true,
    });
    render(<VisitRecordDetail recordId="record_1" />);

    expect(
      screen.getByText(/報告書・請求候補・残薬・訪問準備情報の一部を取得できませんでした/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['care-reports-by-visit']).toHaveBeenCalled();
    expect(refetchSpies['billing-candidates-by-visit']).toHaveBeenCalled();
    expect(refetchSpies['residual-medications']).toHaveBeenCalled();
  });

  it('shows the warning when only residual medications fetch fails', () => {
    // residuals queryFn now throws on !res.ok, so a failed load is visible rather than a
    // silent zero that would read as "no residual medications" in visit readiness.
    setupQueries({ residualsError: true });
    render(<VisitRecordDetail recordId="record_1" />);
    expect(screen.getByText(/一部を取得できませんでした/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  // CE02: 訪問準備情報(visit-preparation)の取得失敗が readiness を偽完了させないこと。
  // 全ての基本 required 項目を done にする構造化 SOAP。billing_blockers が唯一の未完要因になる。
  const BASE_COMPLETE_RECORD = {
    ...RECORD,
    structured_soap: {
      home_visit_2026: {
        medication_review_completed: true,
        residual_medication_checked: true,
        adverse_event_checked: true,
        polypharmacy_reviewed: true,
        after_hours_contact_confirmed: true,
      },
      plan: { free_text: '医師へ服薬状況を報告し、次回訪問で継続確認する。' },
    },
  } as unknown as typeof RECORD;

  it('keeps 訪問薬剤管理の確認 incomplete when the visit-preparation fetch fails (no false completion)', () => {
    // Baseline: prep loads with a real billing blocker → the rollup is correctly incomplete.
    const baseline = setupQueries({
      record: BASE_COMPLETE_RECORD,
      billingBlockers: [
        { key: 'billing_basis', reason: '請求根拠が不足しています', severity: 'high' },
      ],
    });
    expect(baseline).toBeTruthy();
    const { unmount } = render(<VisitRecordDetail recordId="record_1" />);
    const baselineItem = screen.getByTestId('readiness-item-medication_management');
    expect(baselineItem.getAttribute('data-done')).toBe('false');
    unmount();
    vi.clearAllMocks();

    // Prep fetch fails → billing_blockers would collapse to [] and (pre-fix) the rollup would
    // flip to done because every base item is complete. Must fail closed instead.
    const { refetchSpies } = setupQueries({
      record: BASE_COMPLETE_RECORD,
      visitPreparationError: true,
    });
    render(<VisitRecordDetail recordId="record_1" />);

    const guardedItem = screen.getByTestId('readiness-item-medication_management');
    expect(guardedItem.getAttribute('data-done')).toBe('false');
    expect(guardedItem.textContent).toContain('訪問準備情報を取得できなかったため');

    // The failure is surfaced (banner) and retry refetches the preparation query too.
    expect(
      screen.getByText(/報告書・請求候補・残薬・訪問準備情報の一部を取得できませんでした/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['visit-preparation-care-team']).toHaveBeenCalled();
  });

  it('completes 訪問薬剤管理の確認 when preparation loads without blockers and all base evidence is present', () => {
    setupQueries({ record: BASE_COMPLETE_RECORD, billingBlockers: [] });
    render(<VisitRecordDetail recordId="record_1" />);
    const item = screen.getByTestId('readiness-item-medication_management');
    expect(item.getAttribute('data-done')).toBe('true');
    expect(screen.queryByText(/一部を取得できませんでした/)).toBeNull();
  });
});
