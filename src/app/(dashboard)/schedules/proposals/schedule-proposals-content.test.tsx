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
      ['tasks', 'visit-contact-followup', 'org_1'],
    ]),
  );
  expect(invalidateQueriesMock).toHaveBeenCalledTimes(5);
}

function expectToastMessagesExcludeSensitiveDetails() {
  const toastText = JSON.stringify([
    toastSuccessMock.mock.calls,
    toastWarningMock.mock.calls,
    toastErrorMock.mock.calls,
  ]);
  expect(toastText).not.toContain('東京都港区2-2-2');
  expect(toastText).not.toContain('090-1234-5678');
  expect(toastText).not.toContain('アムロジピン');
  expect(toastText).not.toContain('処方詳細');
}

describe('ScheduleProposalsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
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

  it('shows a preset context banner when opened from a focused dashboard link', () => {
    render(
      <ScheduleProposalsContent initialPreset="contact" initialStatus="patient_contact_pending" />,
    );

    expect(screen.getByTestId('proposal-preset-banner')).toBeTruthy();
    expect(screen.getByText('未架電・連絡対応の候補を表示中です。')).toBeTruthy();
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
    expect(within(partialAlert).getByText(/勤務枠が埋まりました/)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: '山田花子 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('checkbox', { name: '佐藤太郎 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('checkbox', { name: '鈴木一郎 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: '選択中1件の訪問候補を一括承認' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: '佐藤太郎 の候補を選択' }));

    expect(screen.queryByTestId('proposal-bulk-partial-failure')).toBeNull();
    expect(
      screen.getByRole('button', { name: '承認できる訪問候補を選択して一括承認' }),
    ).toBeTruthy();
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
      screen.getByRole('checkbox', { name: '山田花子 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('checkbox', { name: '佐藤太郎 の候補を選択' }).getAttribute('aria-checked'),
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
      screen.getByRole('checkbox', { name: '山田花子 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('checkbox', { name: '佐藤太郎 の候補を選択' }).getAttribute('aria-checked'),
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
    expect(within(partialAlert).getAllByText(/Network offline/)).toHaveLength(2);
    expect(
      screen.getByRole('checkbox', { name: '山田花子 の候補を選択' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('checkbox', { name: '佐藤太郎 の候補を選択' }).getAttribute('aria-checked'),
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
