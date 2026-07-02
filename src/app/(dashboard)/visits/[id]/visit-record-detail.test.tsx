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

type QueryStubOptions = {
  careReportsError?: boolean;
  billingError?: boolean;
  residualsError?: boolean;
  visitPreparationError?: boolean;
  billingBlockers?: Array<{ key: string; reason: string; severity?: 'high' | 'normal' }>;
  record?: typeof RECORD;
};

function setupQueries(options: QueryStubOptions = {}) {
  const refetchSpies: Record<string, ReturnType<typeof vi.fn>> = {
    'care-reports-by-visit': vi.fn(),
    'billing-candidates-by-visit': vi.fn(),
    'residual-medications': vi.fn(),
    'visit-preparation-care-team': vi.fn(),
  };
  useOrgIdMock.mockReturnValue('org_1');
  useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
  useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'visit-record') {
      return { data: options.record ?? RECORD, isLoading: false, isError: false, refetch: vi.fn() };
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
        data: options.residualsError ? undefined : [],
        isError: Boolean(options.residualsError),
        refetch: refetchSpies['residual-medications'],
      };
    }
    // visit-preparation-care-team and any other secondary queries
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
  return { refetchSpies };
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
