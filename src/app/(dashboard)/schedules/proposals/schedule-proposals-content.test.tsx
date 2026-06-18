// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    info: vi.fn(),
    success: toastSuccessMock,
    warning: toastWarningMock,
  },
}));

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div />,
}));

import { ScheduleProposalsContent } from './schedule-proposals-content';

setupDomTestEnv();

function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'proposed',
    patient_contact_status: 'pending',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    medication_end_date: null,
    visit_deadline_date: '2026-04-11',
    proposal_reason: '移動良好',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2', lat: 35.0, lng: 139.0 },
    vehicle_resource: {
      id: 'vehicle_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 6,
      max_route_duration_minutes: 180,
    },
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

function buildProposalDetail(overrides?: Record<string, unknown>) {
  return {
    ...buildProposal(overrides),
    approved_at: null,
    patient_contacted_at: null,
    confirmed_at: null,
    related_proposals: [],
    pharmacist_day_schedules: [],
    route_preview: {
      plan: {
        status: 'unavailable',
        note: null,
        travelMode: 'DRIVE',
        origin: null,
        encodedPath: null,
        orderedScheduleIds: [],
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        stopSummaries: [],
      },
      points: [],
      site: null,
    },
    ...overrides,
  };
}

function mockImmediateMutations() {
  useMutationMock.mockImplementation(
    (options: {
      mutationFn?: (variables: unknown) => unknown;
      onSuccess?: (data: unknown, variables: unknown) => unknown;
      onError?: (error: unknown) => unknown;
    }) => ({
      mutate: vi.fn((variables: unknown) => {
        void Promise.resolve(options.mutationFn?.(variables))
          .then((data) => options.onSuccess?.(data, variables))
          .catch((error: unknown) => options.onError?.(error));
      }),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  );
}

function mockExecutingMutations() {
  useMutationMock.mockImplementation(
    (options: {
      mutationFn?: (variables: unknown) => unknown;
      onSuccess?: (data: unknown, variables: unknown) => unknown;
      onError?: (error: unknown) => unknown;
    }) => ({
      mutate: vi.fn((variables: unknown) => {
        void Promise.resolve(options.mutationFn?.(variables))
          .then((data) => options.onSuccess?.(data, variables))
          .catch((error: unknown) => options.onError?.(error));
      }),
      mutateAsync: vi.fn(async (variables: unknown) => {
        try {
          const data = await options.mutationFn?.(variables);
          await options.onSuccess?.(data, variables);
          return data;
        } catch (error) {
          await options.onError?.(error);
          throw error;
        }
      }),
      isPending: false,
    }),
  );
}

function mockDashboardProposals(proposals: Array<ReturnType<typeof buildProposal>>) {
  useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'schedule-proposals-dashboard') {
      return {
        data: { data: proposals },
        isLoading: false,
        connected: true,
      };
    }
    if (queryKey[0] === 'schedule-proposal-detail') {
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    }
    return {
      data: undefined,
      isLoading: false,
      connected: true,
    };
  });
}

function invalidatedQueryKeys() {
  return invalidateQueriesMock.mock.calls.map(([arg]) => {
    const payload = arg as { queryKey: unknown[] };
    return payload.queryKey;
  });
}

function expectProposalQueryInvalidations() {
  expect(invalidatedQueryKeys()).toEqual(
    expect.arrayContaining([
      ['schedule-proposals-dashboard', 'org_1'],
      ['schedule-proposal-detail', 'org_1'],
      ['visit-schedule-proposals', 'org_1'],
      ['visit-schedules', 'week-board', 'org_1'],
      ['schedule-day-board', 'org_1'],
      ['tasks', 'schedule-board', 'org_1'],
      ['tasks', 'visit-contact-followup', 'org_1'],
    ]),
  );
  expect(invalidateQueriesMock).toHaveBeenCalledTimes(7);
}

function expectToastMessagesExcludeSensitiveDetails() {
  const toastText = JSON.stringify([
    toastSuccessMock.mock.calls,
    toastWarningMock.mock.calls,
    toastErrorMock.mock.calls,
  ]);
  expectTextExcludesSensitiveDetails(toastText);
  expect(toastText).not.toContain('proposal_');
}

function expectTextExcludesSensitiveDetails(text: string | null | undefined) {
  expect(text ?? '').not.toContain('東京都港区2-2-2');
  expect(text ?? '').not.toContain('090-1234-5678');
  expect(text ?? '').not.toContain('アムロジピン');
  expect(text ?? '').not.toContain('処方詳細');
}

function expectElementTextExcludesSensitiveDetails(element: HTMLElement) {
  expectTextExcludesSensitiveDetails(element.textContent);
}

function shortEntityIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return '未設定';
  const withoutKnownPrefix = normalized.replace(/^(proposal|case|patient)[_-]/u, '');
  const candidate = withoutKnownPrefix || normalized;
  return candidate.length <= 8 ? candidate : candidate.slice(-8);
}

function proposalSafeIdentifierLabel(caseId: string, proposalId: string) {
  return `ケース ${shortEntityIdentifier(caseId)} / 候補 ${shortEntityIdentifier(proposalId)}`;
}

function failedProposalDetailButtonName(
  patientName: string,
  timePattern: string,
  proposalId = 'proposal_2',
) {
  return new RegExp(
    `${patientName}.*2026\\/04\\/09.*${timePattern}.*候補 ${shortEntityIdentifier(proposalId)}.*未更新候補を詳細で確認`,
  );
}

function proposalTargetName(
  patientName: string,
  timeRange = '18:00 - 19:00',
  dateLabel = '2026/04/09',
  options?: {
    caseId?: string;
    proposalId?: string;
    pharmacistName?: string;
    vehicleLabel?: string;
  },
) {
  const caseId = options?.caseId ?? 'case_1';
  const proposalId = options?.proposalId ?? 'proposal_1';
  return `${patientName} ${dateLabel} ${timeRange} / ${options?.pharmacistName ?? '薬剤師A'} / ${options?.vehicleLabel ?? '社用車A'} / ${proposalSafeIdentifierLabel(caseId, proposalId)}`;
}

function proposalCheckboxName(
  patientName: string,
  timeRange = '18:00 - 19:00',
  dateLabel = '2026/04/09',
  options?: Parameters<typeof proposalTargetName>[3],
) {
  return `${proposalTargetName(patientName, timeRange, dateLabel, options)} の候補を選択`;
}

function expectRouterReplacedWithSearchParam(key: string, value: string) {
  expect(
    routerReplaceMock.mock.calls.some(([url]) => {
      const query = String(url).split('?')[1] ?? '';
      return new URLSearchParams(query).get(key) === value;
    }),
  ).toBe(true);
}

function expectAlertExcludesSensitiveDetails(alert: HTMLElement) {
  expectElementTextExcludesSensitiveDetails(alert);
  expect(alert.textContent ?? '').not.toContain('proposal_');
}

function expectPersistentTouchTarget(element: HTMLElement) {
  const className = element.getAttribute('class') ?? '';
  expect(className).toContain('min-h-[44px]');
  expect(className).toContain('sm:h-auto');
  expect(className).toContain('sm:min-h-[44px]');
}

function expectLargeCheckboxTarget(element: HTMLElement) {
  const className = element.getAttribute('class') ?? '';
  expect(className).toContain('size-11');
  expect(className).toContain('sm:size-11');
}

describe('ScheduleProposalsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: routerReplaceMock });
    usePathnameMock.mockReturnValue('/schedules/proposals');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('workspace=dashboard'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: invalidateQueriesMock,
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [buildProposal()] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });
  });

  it('syncs preset changes into the URL', () => {
    render(<ScheduleProposalsContent initialDateFrom="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: /本日候補/ }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      expect.stringContaining('workspace=dashboard'),
      { scroll: false },
    );
    expect(useRouterMock().replace).toHaveBeenCalledWith(expect.stringContaining('preset=today'), {
      scroll: false,
    });
  });

  it('highlights the active detail proposal row from the URL state', () => {
    render(<ScheduleProposalsContent initialDetailId="proposal_1" />);

    expect(screen.getByTestId('schedule-proposal-active-row')).toBeTruthy();
  });

  it('labels proposal card actions with date, time, pharmacist, and vehicle context', () => {
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        case_: {
          patient: {
            id: 'patient_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
        time_window_start: '2026-04-09T09:00:00',
        time_window_end: '2026-04-09T10:00:00',
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
        time_window_start: '2026-04-09T10:30:00',
        time_window_end: '2026-04-09T11:30:00',
      }),
    ]);

    render(<ScheduleProposalsContent />);

    const firstTarget = proposalTargetName('佐藤太郎', '09:00 - 10:00');
    const secondTarget = proposalTargetName('佐藤太郎', '10:30 - 11:30', '2026/04/09', {
      caseId: 'case_2',
      proposalId: 'proposal_2',
    });
    expect(screen.getByRole('checkbox', { name: `${firstTarget} の候補を選択` })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: `${secondTarget} の候補を選択` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${firstTarget} の確定フローを開く` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${secondTarget} の確定フローを開く` })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${firstTarget} を承認して患者連絡へ進める` }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${secondTarget} を承認して患者連絡へ進める` }),
    ).toBeTruthy();
  });

  it('keeps same-name proposal actions unique when date, time, pharmacist, and vehicle match', () => {
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        case_: {
          patient: {
            id: 'patient_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);

    render(<ScheduleProposalsContent />);

    const firstTarget = proposalTargetName('佐藤太郎');
    const secondTarget = proposalTargetName('佐藤太郎', '18:00 - 19:00', '2026/04/09', {
      caseId: 'case_2',
      proposalId: 'proposal_2',
    });
    expect(screen.getByRole('checkbox', { name: `${firstTarget} の候補を選択` })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: `${secondTarget} の候補を選択` })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${firstTarget} を承認して患者連絡へ進める` }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${secondTarget} を承認して患者連絡へ進める` }),
    ).toBeTruthy();
    expect(screen.getAllByText('ケース 1 / 候補 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ケース 2 / 候補 2').length).toBeGreaterThan(0);
  });

  it('keeps full primary residence addresses out of proposal list cards', () => {
    mockDashboardProposals([buildProposal()]);

    render(<ScheduleProposalsContent />);

    expect(screen.queryByText('東京都千代田区1-1-1')).toBeNull();
    expect(screen.queryByText('東京都千代田区2-2-2')).toBeNull();
    expect(screen.getByText('訪問先住所は詳細・ルート確認で表示 / 担当拠点 本店')).toBeTruthy();
  });

  it('keeps proposal dashboard critical controls at persistent 44px touch targets', () => {
    mockDashboardProposals([buildProposal()]);

    render(<ScheduleProposalsContent />);

    const target = proposalTargetName('山田花子');
    expectPersistentTouchTarget(
      screen.getByRole('button', { name: '承認できる訪問候補を選択して一括承認' }),
    );
    expectPersistentTouchTarget(
      screen.getByRole('button', { name: '却下できる訪問候補を選択して一括却下' }),
    );
    expectPersistentTouchTarget(
      screen.getByRole('button', { name: `${target} の確定フローを開く` }),
    );
    expectPersistentTouchTarget(
      screen.getByRole('button', { name: `${target} を承認して患者連絡へ進める` }),
    );
    expectLargeCheckboxTarget(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    expectLargeCheckboxTarget(
      screen.getByRole('checkbox', { name: proposalCheckboxName('山田花子') }),
    );
  });

  it('disambiguates same-name case search results with safe case and patient identifiers', async () => {
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        case_id: 'case_same_1',
        case_: {
          patient: {
            id: 'patient_same_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_same_2',
        case_: {
          patient: {
            id: 'patient_same_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-case-search') {
        return {
          data: {
            data: [
              {
                id: 'case_same_1',
                status: 'active',
                primary_pharmacist_id: 'pharmacist_1',
                primary_pharmacist_name: '薬剤師A',
                patient: {
                  id: 'patient_same_1',
                  name: '佐藤太郎',
                  residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
                },
              },
              {
                id: 'case_same_2',
                status: 'active',
                primary_pharmacist_id: 'pharmacist_1',
                primary_pharmacist_name: '薬剤師A',
                patient: {
                  id: 'patient_same_2',
                  name: '佐藤太郎',
                  residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
                },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    expect(screen.getByRole('button', { name: '選択中2件の訪問候補を一括承認' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('ケース/患者検索'), { target: { value: '佐藤' } });
    const firstResult = await screen.findByRole('button', {
      name: '佐藤太郎 / ケース same_1 / 患者識別 same_1 / 主担当 薬剤師A で候補を絞り込む',
    });
    const secondResult = screen.getByRole('button', {
      name: '佐藤太郎 / ケース same_2 / 患者識別 same_2 / 主担当 薬剤師A で候補を絞り込む',
    });
    expect(firstResult).toBeTruthy();
    expect(secondResult).toBeTruthy();
    expect(firstResult.textContent).not.toContain('東京都千代田区1-1-1');
    expect(secondResult.textContent).not.toContain('東京都港区2-2-2');

    fireEvent.click(secondResult);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '承認できる訪問候補を選択して一括承認' }),
      ).toBeTruthy();
    });
    expect(screen.getByText(/ケース固定中/).textContent).toContain('ケース same_2');
    expect(screen.getByText(/ケース固定中/).textContent).toContain('患者識別 same_2');
    expectRouterReplacedWithSearchParam('case_id', 'case_same_2');
    expectRouterReplacedWithSearchParam('patient_id', 'patient_same_2');
    expectRouterReplacedWithSearchParam('focus', 'patient');
    expect(
      useRealtimeQueryMock.mock.calls.some(([arg]) => {
        const queryKey = (arg as { queryKey: unknown[] }).queryKey;
        if (queryKey[0] !== 'schedule-proposals-dashboard') return false;
        const params = new URLSearchParams(String(queryKey[2] ?? ''));
        return (
          params.get('case_id') === 'case_same_2' && params.get('patient_id') === 'patient_same_2'
        );
      }),
    ).toBe(true);
  });

  it('does not auto-open the first same-name proposal for patient-focused URLs without a detail id', () => {
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        case_id: 'case_same_1',
        case_: {
          patient: {
            id: 'patient_same_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_same_2',
        case_: {
          patient: {
            id: 'patient_same_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);

    render(
      <ScheduleProposalsContent
        initialFocus="patient"
        initialCaseId="case_same_2"
        initialPatientId="patient_same_2"
      />,
    );

    expect(screen.queryByTestId('schedule-proposal-active-row')).toBeNull();
    expect(screen.queryByRole('dialog', { name: /訪問日時確定フロー/ })).toBeNull();
    expect(screen.getByText(/ケース固定中/).textContent).toContain('ケース same_2');
    expect(
      useRealtimeQueryMock.mock.calls.some(([arg]) => {
        const queryKey = (arg as { queryKey: unknown[] }).queryKey;
        return queryKey[0] === 'schedule-proposal-detail' && queryKey[2] === null;
      }),
    ).toBe(true);
  });

  it('names the proposal detail sheet and actions with the active proposal target', () => {
    const detail = buildProposalDetail({
      id: 'proposal_2',
      case_id: 'case_2',
      case_: {
        patient: {
          id: 'patient_2',
          name: '佐藤太郎',
          residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
        },
      },
      time_window_start: '2026-04-09T10:30:00',
      time_window_end: '2026-04-09T11:30:00',
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [detail] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialDetailId="proposal_2" />);

    const target = proposalTargetName('佐藤太郎', '10:30 - 11:30', '2026/04/09', {
      caseId: 'case_2',
      proposalId: 'proposal_2',
    });
    const detailDialog = screen.getByRole('dialog', { name: '訪問日時確定フロー' });
    expect(detailDialog).toBeTruthy();
    expectPersistentTouchTarget(
      within(detailDialog).getByRole('button', { name: `${target} を承認して患者連絡へ進める` }),
    );
  });

  it('keeps unassigned proposal card vehicles labeled as unassigned', () => {
    const detail = buildProposalDetail({
      id: 'proposal_without_vehicle',
      vehicle_resource: null,
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [detail] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialDetailId="proposal_without_vehicle" />);

    expect(screen.getByRole('dialog', { name: /訪問日時確定フロー/ })).toBeTruthy();
    expect(screen.getByText('未割当')).toBeTruthy();
  });

  it('surfaces medication, delivery, route, and phone confirmation checks on proposal cards', () => {
    mockDashboardProposals([
      buildProposal({
        medication_end_date: '2026-04-10',
        visit_deadline_date: '2026-04-09',
        proposal_reason:
          '服薬最終日 2026-04-10 より前に配置 / 薬剤変更指示あり / ルート順 1 を提案',
      }),
    ]);

    render(<ScheduleProposalsContent />);

    const workflow = screen.getByTestId('proposal-medication-workflow');
    expect(within(workflow).getByText('服用開始・配薬判断')).toBeTruthy();
    expect(within(workflow).getByText('現場確認順')).toBeTruthy();
    expect(within(workflow).getByText(/1\. 前回最終服用日/)).toBeTruthy();
    expect(within(workflow).getByText(/2026\/04\/10を起点に期限を確認/)).toBeTruthy();
    expect(within(workflow).getByText(/2\. 薬剤変更指示/)).toBeTruthy();
    expect(within(workflow).getByText('薬剤変更指示あり')).toBeTruthy();
    expect(within(workflow).getByText(/3\. 開始日前配薬/)).toBeTruthy();
    expect(within(workflow).getByText(/2026\/04\/09までの候補/)).toBeTruthy();
    expect(within(workflow).getByText(/4\. ルート・時間仮提案/)).toBeTruthy();
    expect(within(workflow).getByText('承認後に患者へ候補日時を連絡')).toBeTruthy();
  });

  it('requires confirmation before a single proposal card approval is submitted', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([buildProposal({ id: 'proposal_1' })]);

    render(<ScheduleProposalsContent />);

    const target = proposalTargetName('山田花子');
    fireEvent.click(screen.getByRole('button', { name: `${target} を承認して患者連絡へ進める` }));
    expect(fetchMock).not.toHaveBeenCalled();

    const confirmDialog = screen.getByRole('alertdialog', {
      name: `${target} を承認して患者連絡へ進めますか`,
    });
    expect(within(confirmDialog).getByText('山田花子')).toBeTruthy();
    expect(within(confirmDialog).getAllByText(/2026\/04\/09/).length).toBeGreaterThan(0);
    expect(within(confirmDialog).getAllByText(/18:00 - 19:00/).length).toBeGreaterThan(0);
    expect(within(confirmDialog).getByText('薬剤師A')).toBeTruthy();
    expect(within(confirmDialog).getByText('社用車A')).toBeTruthy();
    expect(within(confirmDialog).getByText('提案中')).toBeTruthy();
    expect(within(confirmDialog).getByText('患者連絡待ち')).toBeTruthy();
    expectElementTextExcludesSensitiveDetails(confirmDialog);

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'キャンセル' }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: `${target} を承認して患者連絡へ進める` }));
    const reopenedDialog = screen.getByRole('alertdialog', {
      name: `${target} を承認して患者連絡へ進めますか`,
    });
    fireEvent.click(
      within(reopenedDialog).getByRole('button', { name: '承認して患者連絡へ進める' }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-schedule-proposals/proposal_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      }),
    );
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('候補を承認し、患者連絡待ちへ移しました');
    });
    expectProposalQueryInvalidations();
  });

  it('confirms the exact same-name card before a single date confirmation is submitted', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        case_: {
          patient: {
            id: 'patient_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
        time_window_start: '2026-04-09T09:00:00',
        time_window_end: '2026-04-09T10:00:00',
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'confirmed',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
        time_window_start: '2026-04-09T10:30:00',
        time_window_end: '2026-04-09T11:30:00',
      }),
    ]);

    render(<ScheduleProposalsContent initialStatus="patient_contact_pending" />);

    const secondTarget = proposalTargetName('佐藤太郎', '10:30 - 11:30', '2026/04/09', {
      caseId: 'case_2',
      proposalId: 'proposal_2',
    });
    fireEvent.click(screen.getByRole('button', { name: `${secondTarget} を日時確定する` }));
    expect(fetchMock).not.toHaveBeenCalled();

    const confirmDialog = screen.getByRole('alertdialog', {
      name: `${secondTarget} を日時確定しますか`,
    });
    expect(within(confirmDialog).getByText('訪問予定確定')).toBeTruthy();
    expect(within(confirmDialog).getByText('患者確認済み')).toBeTruthy();
    expectElementTextExcludesSensitiveDetails(confirmDialog);
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '日時確定する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-schedule-proposals/proposal_2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirm' }),
      }),
    );
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('訪問予定を確定しました');
    });
    expectProposalQueryInvalidations();
  });

  it('routes detail sheet date confirmation through the active proposal confirmation dialog', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    const detail = buildProposalDetail({
      id: 'proposal_2',
      case_id: 'case_2',
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'confirmed',
      case_: {
        patient: {
          id: 'patient_2',
          name: '佐藤太郎',
          residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
        },
      },
      time_window_start: '2026-04-09T10:30:00',
      time_window_end: '2026-04-09T11:30:00',
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [buildProposal({ id: 'proposal_1' }), detail] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(
      <ScheduleProposalsContent
        initialDetailId="proposal_2"
        initialStatus="patient_contact_pending"
      />,
    );

    const target = proposalTargetName('佐藤太郎', '10:30 - 11:30', '2026/04/09', {
      caseId: 'case_2',
      proposalId: 'proposal_2',
    });
    const detailDialog = screen.getByRole('dialog', { name: '訪問日時確定フロー' });
    expectPersistentTouchTarget(
      within(detailDialog).getByRole('button', { name: `${target} を日時確定する` }),
    );
    fireEvent.click(within(detailDialog).getByRole('button', { name: `${target} を日時確定する` }));
    expect(fetchMock).not.toHaveBeenCalled();

    const confirmDialog = screen.getByRole('alertdialog', {
      name: `${target} を日時確定しますか`,
    });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '日時確定する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/visit-schedule-proposals/proposal_2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'confirm' }),
      }),
    );
  });

  it('requires confirmation before applying proposal detail route order', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    const relatedProposal = buildProposal({
      id: 'proposal_2',
      case_id: 'case_2',
      route_order: 2,
      time_window_start: '2026-04-09T10:30:00.000Z',
      time_window_end: '2026-04-09T11:30:00.000Z',
      case_: {
        patient: {
          id: 'patient_2',
          name: '佐藤太郎',
          residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
        },
      },
    });
    const detail = buildProposalDetail({
      id: 'proposal_1',
      route_order: 1,
      related_proposals: [relatedProposal],
      route_preview: {
        plan: {
          status: 'ok',
          note: null,
          travelMode: 'DRIVE',
          origin: null,
          encodedPath: null,
          orderedScheduleIds: ['proposal:proposal_2', 'proposal:proposal_1'],
          totalDistanceMeters: null,
          totalDurationSeconds: null,
          stopSummaries: [],
        },
        points: [
          {
            schedule_id: 'proposal:proposal_1',
            point_kind: 'proposal',
            patient_name: '山田花子',
            address: '東京都千代田区1-1-1',
            lat: 35.1,
            lng: 139.1,
            priority: 'normal',
            schedule_status: 'planned',
            time_window_start: '2026-04-09T09:00:00.000Z',
            time_window_end: '2026-04-09T10:00:00.000Z',
          },
          {
            schedule_id: 'proposal:proposal_2',
            point_kind: 'proposal',
            patient_name: '佐藤太郎',
            address: '東京都港区2-2-2',
            lat: 35.2,
            lng: 139.2,
            priority: 'normal',
            schedule_status: 'planned',
            time_window_start: '2026-04-09T10:30:00.000Z',
            time_window_end: '2026-04-09T11:30:00.000Z',
          },
        ],
        site: null,
      },
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [detail, relatedProposal] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialDetailId="proposal_1" />);

    fireEvent.click(screen.getByRole('button', { name: '候補群へ最適順を反映' }));
    expect(fetchMock).not.toHaveBeenCalled();

    const confirmDialog = screen.getByRole('alertdialog', {
      name: '候補群の route_order を反映しますか',
    });
    expect(confirmDialog.textContent).toContain('山田花子');
    expect(confirmDialog.textContent).toContain('佐藤太郎');
    expect(confirmDialog.textContent).toContain('現在 2 → 1');
    expect(confirmDialog.textContent).toContain('現在 1 → 2');
    expect(within(confirmDialog).getByText('車')).toBeTruthy();
    expect(confirmDialog.textContent ?? '').not.toContain('東京都港区2-2-2');
    expect(confirmDialog.textContent ?? '').not.toContain('090-1234-5678');
    expect(confirmDialog.textContent ?? '').not.toContain('アムロジピン');

    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'キャンセル' }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '候補群へ最適順を反映' }));
    const reopenedDialog = screen.getByRole('alertdialog', {
      name: '候補群の route_order を反映しますか',
    });
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: '2件の候補順を反映' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals/reorder',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
        }),
      );
    });
    const reorderRequest = fetchMock.mock.calls.find(
      ([url]) => url === '/api/visit-schedule-proposals/reorder',
    );
    expect(JSON.parse(reorderRequest?.[1]?.body as string)).toEqual({
      route_order_updates: [
        { proposal_id: 'proposal_2', route_order: 1 },
        { proposal_id: 'proposal_1', route_order: 2 },
      ],
      confirmation_context: {
        source: 'proposal_detail_route_preview',
        date: '2026-04-09',
        pharmacist_id: 'pharmacist_1',
        travel_mode: 'DRIVE',
        target_count: 2,
        route_order_diff_count: 2,
      },
    });
  });

  it.each([
    {
      actionLabel: '承認して患者連絡へ進める',
      dialogName: (target: string) => `${target} を承認して患者連絡へ進めますか`,
      finalLabel: '承認して患者連絡へ進める',
      expectedPayload: { action: 'approve' },
    },
    {
      actionLabel: '日時確定する',
      dialogName: (target: string) => `${target} を日時確定しますか`,
      finalLabel: '日時確定する',
      expectedPayload: { action: 'confirm' },
      proposalStatus: 'patient_contact_pending',
      patientContactStatus: 'confirmed',
      initialStatus: 'patient_contact_pending',
    },
  ])(
    'keeps unsafe server messages out of single $actionLabel error toasts',
    async ({
      actionLabel,
      dialogName,
      finalLabel,
      expectedPayload,
      proposalStatus = 'proposed',
      patientContactStatus = 'pending',
      initialStatus,
    }) => {
      const fetchMock = vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({
            message:
              '勤務枠が埋まりました 東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細 proposal_1',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      mockImmediateMutations();
      mockDashboardProposals([
        buildProposal({
          id: 'proposal_1',
          proposal_status: proposalStatus,
          patient_contact_status: patientContactStatus,
        }),
      ]);

      render(<ScheduleProposalsContent initialStatus={initialStatus} />);

      const target = proposalTargetName('山田花子');
      fireEvent.click(screen.getByRole('button', { name: `${target} を${actionLabel}` }));
      const confirmDialog = screen.getByRole('alertdialog', { name: dialogName(target) });
      fireEvent.click(within(confirmDialog).getByRole('button', { name: finalLabel }));

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          'サーバー側の状態変更または入力確認により未更新です。再取得後に候補状態を確認してください。',
        );
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals/proposal_1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(expectedPayload),
        }),
      );
      expect(toastSuccessMock).not.toHaveBeenCalled();
      expectToastMessagesExcludeSensitiveDetails();
      const toastText = JSON.stringify(toastErrorMock.mock.calls);
      expect(toastText).not.toContain('勤務枠が埋まりました');
      expect(toastText).not.toContain('proposal_1');
      expect(screen.queryByText(/勤務枠が埋まりました 東京都港区2-2-2/)).toBeNull();
    },
  );

  it('shows a preset context banner when opened from a focused dashboard link', () => {
    render(
      <ScheduleProposalsContent initialPreset="contact" initialStatus="patient_contact_pending" />,
    );

    expect(screen.getByTestId('proposal-preset-banner')).toBeTruthy();
    expect(screen.getByText('未架電・連絡対応の候補を表示中です。')).toBeTruthy();
  });

  it('passes the contact preset status to the proposals API query state', () => {
    render(
      <ScheduleProposalsContent initialPreset="contact" initialStatus="patient_contact_pending" />,
    );

    expect(
      useRealtimeQueryMock.mock.calls.some(([arg]) => {
        const queryKey = (arg as { queryKey: unknown[] }).queryKey;
        if (queryKey[0] !== 'schedule-proposals-dashboard') return false;
        const params = new URLSearchParams(String(queryKey[2] ?? ''));
        return params.get('status') === 'patient_contact_pending';
      }),
    ).toBe(true);
  });

  it('confirms proposal bulk approval before submitting selected proposals', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables: unknown) => unknown;
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables))
            .catch((error: unknown) => options.onError?.(error));
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: {
            data: [
              buildProposal({ id: 'proposal_1' }),
              buildProposal({
                id: 'proposal_2',
                case_id: 'case_2',
                case_: {
                  patient: {
                    id: 'patient_2',
                    name: '佐藤太郎',
                    residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
                  },
                },
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent />);

    expect(
      (
        screen.getByRole('button', {
          name: '承認できる訪問候補を選択して一括承認',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: '却下できる訪問候補を選択して一括却下',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));

    expect(screen.getByRole('button', { name: '選択中2件の訪問候補を一括却下' })).toBeTruthy();
    const approveButton = screen.getByRole('button', {
      name: '選択中2件の訪問候補を一括承認',
    });
    expect((approveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(approveButton);
    expect(fetchMock).not.toHaveBeenCalled();
    let approveDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括承認しますか',
    });
    expect(within(approveDialog).getByText(/承認後は患者連絡待ちへ進みます/)).toBeTruthy();
    expect(within(approveDialog).getByText('山田花子')).toBeTruthy();
    expect(within(approveDialog).getByText('佐藤太郎')).toBeTruthy();

    fireEvent.click(within(approveDialog).getByRole('button', { name: 'キャンセル' }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(approveButton);
    approveDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括承認しますか',
    });
    fireEvent.click(within(approveDialog).getByRole('button', { name: '2件を一括承認' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/visit-schedule-proposals/proposal_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/visit-schedule-proposals/proposal_2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      }),
    );
  });

  it('shows every eligible proposal in bulk confirmation before submitting', () => {
    mockDashboardProposals(
      Array.from({ length: 7 }, (_, index) =>
        buildProposal({
          id: `proposal_${index + 1}`,
          case_id: `case_${index + 1}`,
          case_: {
            patient: {
              id: `patient_${index + 1}`,
              name: `患者${index + 1}`,
              residences: [
                {
                  address: `東京都千代田区${index + 1}-${index + 1}-${index + 1}`,
                  lat: 35.1 + index / 100,
                  lng: 139.1 + index / 100,
                },
              ],
            },
          },
        }),
      ),
    );

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(screen.getByRole('button', { name: '選択中7件の訪問候補を一括承認' }));

    const approveDialog = screen.getByRole('alertdialog', {
      name: '選択中7件の訪問候補を一括承認しますか',
    });
    const targetList = within(approveDialog).getByRole('list', {
      name: '一括操作の対象候補',
    });
    expect(within(targetList).getAllByRole('listitem')).toHaveLength(7);
    expect(within(targetList).getByText('患者7')).toBeTruthy();
    expect(approveDialog.textContent ?? '').not.toContain('ほか 1 件');
  });

  it('reports partial bulk approval failures, refreshes successes, and keeps failed proposals selected', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/proposal_2')) {
        return new Response(
          JSON.stringify({
            message: '勤務枠が埋まりました 東京都港区2-2-2 090-1234-5678 アムロジピン 処方詳細',
          }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return Response.json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([
      buildProposal({ id: 'proposal_1' }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        time_window_start: '2026-04-09T09:00:00',
        time_window_end: '2026-04-09T10:00:00',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
      buildProposal({
        id: 'proposal_3',
        case_id: 'case_3',
        case_: {
          patient: {
            id: 'patient_3',
            name: '鈴木一郎',
            residences: [{ address: '東京都新宿区3-3-3', lat: 35.3, lng: 139.3 }],
          },
        },
      }),
    ]);

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '選択中3件の訪問候補を一括承認',
      }),
    );
    const approveDialog = screen.getByRole('alertdialog', {
      name: '選択中3件の訪問候補を一括承認しますか',
    });
    fireEvent.click(within(approveDialog).getByRole('button', { name: '3件を一括承認' }));

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        '3件中2件を処理しました。1件は未更新です。選択中の候補を確認して再試行してください。',
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const warningMessage = toastWarningMock.mock.calls[0]?.[0] as string;
    expect(warningMessage).not.toContain('山田花子');
    expect(warningMessage).not.toContain('佐藤太郎');
    expect(warningMessage).not.toContain('鈴木一郎');
    expectToastMessagesExcludeSensitiveDetails();
    expectProposalQueryInvalidations();

    const partialAlert = screen.getByTestId('proposal-bulk-partial-failure');
    expect(within(partialAlert).getByText('佐藤太郎')).toBeTruthy();
    expect(within(partialAlert).getByText(/2026\/04\/09/)).toBeTruthy();
    expect(within(partialAlert).getByText(/薬剤師A/)).toBeTruthy();
    expect(within(partialAlert).getByText(/社用車A/)).toBeTruthy();
    expect(
      within(partialAlert).getByText(
        '未更新理由: サーバー側の状態変更または入力確認により未更新です。再取得後に候補状態を確認してください。',
      ),
    ).toBeTruthy();
    expectAlertExcludesSensitiveDetails(partialAlert);
    expect(
      within(partialAlert).getByRole('button', {
        name: '佐藤太郎 2026/04/09 09:00 - 10:00 / 候補 2 の未更新候補を詳細で確認',
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: proposalCheckboxName('山田花子') })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen
        .getByRole('checkbox', {
          name: proposalCheckboxName('佐藤太郎', '09:00 - 10:00', '2026/04/09', {
            caseId: 'case_2',
            proposalId: 'proposal_2',
          }),
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('checkbox', {
          name: proposalCheckboxName('鈴木一郎', '18:00 - 19:00', '2026/04/09', {
            caseId: 'case_3',
            proposalId: 'proposal_3',
          }),
        })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: '選択中1件の訪問候補を一括承認' })).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: proposalCheckboxName('佐藤太郎', '09:00 - 10:00', '2026/04/09', {
          caseId: 'case_2',
          proposalId: 'proposal_2',
        }),
      }),
    );

    expect(screen.queryByTestId('proposal-bulk-partial-failure')).toBeNull();
    expect(
      screen.getByRole('button', { name: '承認できる訪問候補を選択して一括承認' }),
    ).toBeTruthy();
  });

  it('opens the exact failed proposal from the bulk failure summary', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/proposal_2')) {
        return new Response(JSON.stringify({ message: '候補はすでに更新済みです' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: '勤務枠が埋まりました' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([
      buildProposal({
        id: 'proposal_1',
        case_: {
          patient: {
            id: 'patient_1',
            name: '佐藤太郎',
            residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
          },
        },
        time_window_start: '2026-04-09T09:00:00',
        time_window_end: '2026-04-09T10:00:00',
      }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        time_window_start: '2026-04-09T10:30:00',
        time_window_end: '2026-04-09T11:30:00',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '選択中2件の訪問候補を一括承認',
      }),
    );
    const approveDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括承認しますか',
    });
    fireEvent.click(within(approveDialog).getByRole('button', { name: '2件を一括承認' }));

    const partialAlert = await screen.findByTestId('proposal-bulk-partial-failure');
    expect(
      within(partialAlert).getAllByRole('button', {
        name: /未更新候補を詳細で確認/,
      }),
    ).toHaveLength(2);
    fireEvent.click(
      within(partialAlert).getByRole('button', {
        name: failedProposalDetailButtonName('佐藤太郎', '10:30 - 11:30'),
      }),
    );

    expect(
      within(screen.getByTestId('schedule-proposal-active-row')).getByText('佐藤太郎'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '訪問日時確定フロー' })).toBeTruthy();
    expectRouterReplacedWithSearchParam('detail', 'proposal_2');
    expectRouterReplacedWithSearchParam('focus', 'detail');
  });

  it('confirms proposal bulk rejection before submitting selected proposals', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables: unknown) => unknown;
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables))
            .catch((error: unknown) => options.onError?.(error));
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: {
            data: [
              buildProposal({ id: 'proposal_1' }),
              buildProposal({
                id: 'proposal_2',
                case_id: 'case_2',
                case_: {
                  patient: {
                    id: 'patient_2',
                    name: '佐藤太郎',
                    residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
                  },
                },
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    const rejectButton = screen.getByRole('button', {
      name: '選択中2件の訪問候補を一括却下',
    });

    fireEvent.click(rejectButton);
    expect(fetchMock).not.toHaveBeenCalled();
    const rejectDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括却下しますか',
    });
    expect(within(rejectDialog).getByText(/却下すると選択候補から外れます/)).toBeTruthy();
    expect(within(rejectDialog).getByText('山田花子')).toBeTruthy();
    expect(within(rejectDialog).getByText('佐藤太郎')).toBeTruthy();
    expect(
      within(rejectDialog).getByText(/入力した理由は実行対象 2 件すべてに記録されます/),
    ).toBeTruthy();
    const rejectReasonInput = within(rejectDialog).getByLabelText(
      '却下理由',
    ) as HTMLTextAreaElement;
    const confirmRejectButton = within(rejectDialog).getByRole('button', {
      name: '2件を一括却下',
    }) as HTMLButtonElement;
    expect(rejectReasonInput.getAttribute('aria-invalid')).toBe('true');
    expect(rejectReasonInput.getAttribute('aria-describedby')).toContain(
      'bulk-reject-reason-error',
    );
    expect(within(rejectDialog).getByText('却下理由を入力してください。')).toBeTruthy();
    expect(confirmRejectButton.disabled).toBe(true);

    fireEvent.change(rejectReasonInput, { target: { value: '   ' } });
    expect(confirmRejectButton.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(rejectReasonInput, {
      target: { value: '  患者都合で訪問候補を見直し  ' },
    });
    expect(confirmRejectButton.disabled).toBe(false);

    fireEvent.click(confirmRejectButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/visit-schedule-proposals/proposal_1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          action: 'reject',
          reject_reason: '患者都合で訪問候補を見直し',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/visit-schedule-proposals/proposal_2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          action: 'reject',
          reject_reason: '患者都合で訪問候補を見直し',
        }),
      }),
    );
  });

  it('keeps only failed proposals selected after a partial bulk rejection failure', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/proposal_2')) {
        return new Response(JSON.stringify({ message: '候補はすでに更新済みです' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables: unknown) => unknown;
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables))
            .catch((error: unknown) => options.onError?.(error));
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: {
            data: [
              buildProposal({ id: 'proposal_1' }),
              buildProposal({
                id: 'proposal_2',
                case_id: 'case_2',
                case_: {
                  patient: {
                    id: 'patient_2',
                    name: '佐藤太郎',
                    residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
                  },
                },
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '選択中2件の訪問候補を一括却下',
      }),
    );
    const rejectDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括却下しますか',
    });
    fireEvent.change(within(rejectDialog).getByLabelText('却下理由'), {
      target: { value: '患者都合で訪問候補を見直し' },
    });
    fireEvent.click(within(rejectDialog).getByRole('button', { name: '2件を一括却下' }));

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(
        '2件中1件を処理しました。1件は未更新です。選択中の候補を確認して再試行してください。',
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const warningMessage = toastWarningMock.mock.calls[0]?.[0] as string;
    expect(warningMessage).not.toContain('山田花子');
    expect(warningMessage).not.toContain('佐藤太郎');
    const partialAlert = screen.getByTestId('proposal-bulk-partial-failure');
    expect(within(partialAlert).getByText('佐藤太郎')).toBeTruthy();
    expect(within(partialAlert).getByText(/2026\/04\/09/)).toBeTruthy();
    expect(within(partialAlert).getByText(/薬剤師A/)).toBeTruthy();
    expect(within(partialAlert).getByText(/社用車A/)).toBeTruthy();
    expect(within(partialAlert).getByText(/候補はすでに更新済みです/)).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: proposalCheckboxName('山田花子') })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen
        .getByRole('checkbox', {
          name: proposalCheckboxName('佐藤太郎', '18:00 - 19:00', '2026/04/09', {
            caseId: 'case_2',
            proposalId: 'proposal_2',
          }),
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expectToastMessagesExcludeSensitiveDetails();
    expectProposalQueryInvalidations();
  });

  it('keeps selection and refreshes when every bulk request reaches the server and fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/proposal_2')) {
        return new Response(JSON.stringify({ message: '候補はすでに更新済みです' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: '勤務枠が埋まりました' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([
      buildProposal({ id: 'proposal_1' }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '選択中2件の訪問候補を一括承認',
      }),
    );
    const approveDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括承認しますか',
    });
    fireEvent.click(within(approveDialog).getByRole('button', { name: '2件を一括承認' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '2件を更新できませんでした。選択中の候補を確認して再試行してください。',
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectProposalQueryInvalidations();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    const errorMessage = toastErrorMock.mock.calls[0]?.[0] as string;
    expect(errorMessage).not.toContain('山田花子');
    expect(errorMessage).not.toContain('佐藤太郎');
    expectToastMessagesExcludeSensitiveDetails();
    const partialAlert = screen.getByTestId('proposal-bulk-partial-failure');
    expect(within(partialAlert).getByText('山田花子')).toBeTruthy();
    expect(within(partialAlert).getByText('佐藤太郎')).toBeTruthy();
    expect(within(partialAlert).getByText(/勤務枠が埋まりました/)).toBeTruthy();
    expect(within(partialAlert).getByText(/候補はすでに更新済みです/)).toBeTruthy();
    expect(
      screen
        .getByRole('checkbox', { name: proposalCheckboxName('山田花子') })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('checkbox', {
          name: proposalCheckboxName('佐藤太郎', '18:00 - 19:00', '2026/04/09', {
            caseId: 'case_2',
            proposalId: 'proposal_2',
          }),
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('keeps selection and skips refresh when every bulk request fails before reaching the server', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('Network offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    mockDashboardProposals([
      buildProposal({ id: 'proposal_1' }),
      buildProposal({
        id: 'proposal_2',
        case_id: 'case_2',
        case_: {
          patient: {
            id: 'patient_2',
            name: '佐藤太郎',
            residences: [{ address: '東京都港区2-2-2', lat: 35.2, lng: 139.2 }],
          },
        },
      }),
    ]);

    render(<ScheduleProposalsContent />);

    fireEvent.click(screen.getByRole('checkbox', { name: /表示中の候補をすべて選択/ }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '選択中2件の訪問候補を一括承認',
      }),
    );
    const approveDialog = screen.getByRole('alertdialog', {
      name: '選択中2件の訪問候補を一括承認しますか',
    });
    fireEvent.click(within(approveDialog).getByRole('button', { name: '2件を一括承認' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '2件を更新できませんでした。選択中の候補を確認して再試行してください。',
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expectToastMessagesExcludeSensitiveDetails();
    const partialAlert = screen.getByTestId('proposal-bulk-partial-failure');
    expect(within(partialAlert).getByText('山田花子')).toBeTruthy();
    expect(within(partialAlert).getByText('佐藤太郎')).toBeTruthy();
    expect(
      within(partialAlert).getAllByText(
        '未更新理由: 通信が完了しませんでした。接続を確認して再試行してください。',
      ),
    ).toHaveLength(2);
    expectAlertExcludesSensitiveDetails(partialAlert);
    expect(
      screen
        .getByRole('checkbox', { name: proposalCheckboxName('山田花子') })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('checkbox', {
          name: proposalCheckboxName('佐藤太郎', '18:00 - 19:00', '2026/04/09', {
            caseId: 'case_2',
            proposalId: 'proposal_2',
          }),
        })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows the human approval and phone confirmation flow on proposal cards', () => {
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: {
            data: [
              buildProposal({
                proposal_status: 'patient_contact_pending',
                patient_contact_status: 'attempted',
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialStatus="patient_contact_pending" />);

    expect(screen.getByText('提案から確定まで')).toBeTruthy();
    expect(screen.getAllByText('患者電話確認').length).toBeGreaterThan(0);
    expect(
      screen.getByText('患者へ電話し、結果を「確認済み」で保存すると日時確定できます。'),
    ).toBeTruthy();
    expect(screen.getAllByText('社用車A').length).toBeGreaterThan(0);
  });

  it('does not display or prefill past contact log PHI while preserving new contact attempt input', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    mockImmediateMutations();
    const detail = buildProposalDetail({
      proposal_status: 'patient_contact_pending',
      patient_contact_status: 'attempted',
      contact_logs: [
        {
          id: 'contact_log_1',
          outcome: 'attempted',
          contact_method: 'phone',
          contact_name: '家族A',
          contact_phone: '090-0000-0000',
          note: '折返し希望',
          callback_due_at: '2026-04-09T12:30:00.000Z',
          called_at: '2026-04-09T09:00:00.000Z',
          called_by: 'user_1',
          has_note: true,
        },
      ],
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [detail] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialDetailId="proposal_1" />);

    const detailDialog = screen.getByRole('dialog', { name: '訪問日時確定フロー' });
    expect(detailDialog.textContent ?? '').toContain('最近の連絡履歴');
    expect(detailDialog.textContent ?? '').toContain('連絡メモあり');
    expect(detailDialog.textContent ?? '').not.toContain('家族A');
    expect(detailDialog.textContent ?? '').not.toContain('090-0000-0000');
    expect(detailDialog.textContent ?? '').not.toContain('折返し希望');

    const contactNameInput = within(detailDialog).getByLabelText('対応者名') as HTMLInputElement;
    const contactPhoneInput = within(detailDialog).getByLabelText('連絡先') as HTMLInputElement;
    const contactNoteInput = within(detailDialog).getByLabelText('連絡メモ') as HTMLTextAreaElement;
    expect(contactNameInput.value).toBe('');
    expect(contactPhoneInput.value).toBe('');
    expect(contactNoteInput.value).toBe('');

    fireEvent.change(contactNameInput, { target: { value: '本人' } });
    fireEvent.change(contactPhoneInput, { target: { value: '080-1111-2222' } });
    fireEvent.change(contactNoteInput, { target: { value: '本日16時で了承' } });
    fireEvent.click(within(detailDialog).getByRole('button', { name: /連絡結果を保存/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals/proposal_1',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"contact_name":"本人"'),
        }),
      );
    });
    const requestBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(
          ([url, init]) =>
            String(url).endsWith('/proposal_1') &&
            (init as RequestInit | undefined)?.method === 'PATCH',
        )?.[1]?.body,
      ),
    );
    expect(requestBody).toMatchObject({
      action: 'contact_attempt',
      outcome: 'attempted',
      contact_method: 'phone',
      contact_name: '本人',
      contact_phone: '080-1111-2222',
      note: '本日16時で了承',
    });
    expect(JSON.stringify(requestBody)).not.toContain('家族A');
    expect(JSON.stringify(requestBody)).not.toContain('090-0000-0000');
    expect(JSON.stringify(requestBody)).not.toContain('折返し希望');
  });

  it('surfaces a top-level reproposal action for change-requested details and retries generation without re-recording contact', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [], diagnostics: { accepted: [], rejected: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mockExecutingMutations();
    const detail = buildProposalDetail({
      proposal_status: 'reschedule_pending',
      patient_contact_status: 'change_requested',
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: { data: [detail] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: { data: detail },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent initialDetailId="proposal_1" />);

    const detailDialog = screen.getByRole('dialog', { name: '訪問日時確定フロー' });
    expect(
      within(detailDialog).getByRole('link', { name: '再提案条件を入力' }).getAttribute('href'),
    ).toBe('#schedule-proposal-reproposal');
    expect(within(detailDialog).getByText('変更希望時の再提案')).toBeTruthy();
    expect(
      within(detailDialog).getByRole('button', { name: '記録済み変更希望から再提案' }),
    ).toBeTruthy();
    expect(detailDialog.textContent ?? '').not.toContain('この候補は終了しています');

    fireEvent.click(
      within(detailDialog).getByRole('button', { name: '記録済み変更希望から再提案' }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"idempotency_key":"visit-reproposal:proposal_1:'),
        }),
      );
    });
    expect(
      String(
        fetchMock.mock.calls.find(
          ([url, init]) =>
            url === '/api/visit-schedule-proposals' &&
            (init as RequestInit | undefined)?.method === 'POST',
        )?.[1]?.body,
      ),
    ).toContain('"reproposal_source_proposal_id":"proposal_1"');
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === '/api/visit-schedule-proposals/proposal_1' &&
          (init as RequestInit | undefined)?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('surfaces substitute, urgency, patient-window, and vehicle decisions on proposal cards', () => {
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'schedule-proposals-dashboard') {
        return {
          data: {
            data: [
              buildProposal({
                priority: 'emergency',
                assignment_mode: 'fallback',
                route_order: 2,
                proposal_reason:
                  '緊急訪問のため即応枠を優先 / 患者条件 09:00-12:00 内で配置 / 社用車A を割当',
                escalation_reason: '担当薬剤師の勤務枠が見つからなかったため代替薬剤師を割り当て',
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'schedule-proposal-detail') {
        return {
          data: undefined,
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: undefined,
        isLoading: false,
        connected: true,
      };
    });

    render(<ScheduleProposalsContent />);

    expect(screen.getByText('代替担当')).toBeTruthy();
    expect(screen.getByText('緊急度で前倒し')).toBeTruthy();
    expect(screen.getByText('患者希望枠内')).toBeTruthy();
    expect(screen.getAllByText('社用車A').length).toBeGreaterThan(0);
  });
});
