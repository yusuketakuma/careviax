// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import { ExternalViewerContent } from './external-viewer-content';

setupDomTestEnv();

type QueryConfig<TData = unknown> = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TData>;
  enabled?: boolean;
};

function getQueryConfigs() {
  return useQueryMock.mock.calls.map(([config]) => config) as Array<QueryConfig>;
}

describe('ExternalViewerContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('shows the home context banner for self report focus', () => {
    render(<ExternalViewerContent initialFocus="self_reports" initialContext="dashboard_home" />);

    expect(screen.getByTestId('external-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから自己申告キューにフォーカスして開いています。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '外部連携サマリー' })).toBeTruthy();
    expect(screen.getByText('有効な共有')).toBeTruthy();
    expect(screen.getByText('自己申告')).toBeTruthy();
    expect(screen.getByText('地域フォロー')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '共有とフォロー' })).toBeTruthy();
  });

  it('keeps external read queries on org-scoped endpoints through the shared JSON helper', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const payload = url.startsWith('/api/patient-self-reports')
        ? { data: [], meta: { has_more: false, next_cursor: null } }
        : url === '/api/external-access'
          ? { data: [], meta: { has_more: false, next_cursor: null } }
          : {
              data: [
                {
                  id: 'activity_1',
                  title: '地域ケア会議',
                  activity_type: 'conference',
                  partner_name: '地域包括支援センター',
                  follow_up_required: true,
                  referrals_generated: 2,
                  activity_date: '2026-07-12T01:00:00.000Z',
                  org_id: 'provider-only',
                  description: 'provider-only free text',
                },
              ],
              meta: { limit: 8, has_more: false, next_cursor: null },
            };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ExternalViewerContent />);

    const [grantsQuery, selfReportsQuery, activitiesQuery] = getQueryConfigs();

    expect(grantsQuery?.queryKey).toEqual(['external-access-grants', 'org_1']);
    expect(selfReportsQuery?.queryKey).toEqual([
      'patient-self-reports',
      'org_1',
      'external-dashboard',
    ]);
    expect(activitiesQuery?.queryKey).toEqual(['community-activities', 'org_1', 'follow-up']);

    await grantsQuery?.queryFn();
    await selfReportsQuery?.queryFn();
    await expect(activitiesQuery?.queryFn()).resolves.toEqual({
      data: [
        {
          id: 'activity_1',
          title: '地域ケア会議',
          activity_type: 'conference',
          partner_name: '地域包括支援センター',
          follow_up_required: true,
          referrals_generated: 2,
          activity_date: '2026-07-12T01:00:00.000Z',
        },
      ],
      meta: { limit: 8, has_more: false, next_cursor: null },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/external-access', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/patient-self-reports?limit=12', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/community-activities?limit=8&follow_up_required=true',
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], hasMore: false, nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(grantsQuery?.queryFn()).rejects.toThrow('外部共有の取得に失敗しました');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], hasMore: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(selfReportsQuery?.queryFn()).rejects.toThrow('自己申告の取得に失敗しました');
  });

  it('sends the self report version timestamp when updating status', async () => {
    const fetchMock = stubJsonFetch({ data: { id: 'report_1' } });

    render(<ExternalViewerContent />);

    const updateMutation = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (variables: {
        id: string;
        status: 'triaged' | 'resolved' | 'dismissed';
        updated_at: string;
      }) => Promise<unknown>;
    };

    await updateMutation.mutationFn({
      id: 'report_1',
      status: 'resolved',
      updated_at: '2026-03-28T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/patient-self-reports/report_1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        status: 'resolved',
        updated_at: '2026-03-28T00:00:00.000Z',
      }),
    });
  });

  it('uses safe recovery copy when self-report status update fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-self-reports/report_1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ message: '自己申告は既に処理済みです' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ExternalViewerContent />);

    const updateMutation = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (variables: {
        id: string;
        status: 'triaged' | 'resolved' | 'dismissed';
        updated_at: string;
      }) => Promise<unknown>;
      onError?: (error: Error) => void;
    };

    let caughtError: unknown;
    try {
      await updateMutation.mutationFn({
        id: 'report_1',
        status: 'resolved',
        updated_at: '2026-03-28T00:00:00.000Z',
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('自己申告は既に処理済みです');
    updateMutation.onError?.(caughtError as Error);
    expect(toastErrorMock).toHaveBeenCalledWith('自己申告の更新に失敗しました');
    expect(toastErrorMock).not.toHaveBeenCalledWith('自己申告は既に処理済みです');
  });

  it('uses safe recovery copy when self-report task creation fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patient-self-reports/report_1/convert-to-task' && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '同じ自己申告のタスクが既に存在します' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ExternalViewerContent />);

    const createTaskMutation = useMutationMock.mock.calls[1]?.[0] as {
      mutationFn: (report: { id: string; updated_at: string }) => Promise<unknown>;
      onError?: (error: Error) => void;
    };

    let caughtError: unknown;
    try {
      await createTaskMutation.mutationFn({
        id: 'report_1',
        updated_at: '2026-03-28T01:02:03.000Z',
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('同じ自己申告のタスクが既に存在します');
    createTaskMutation.onError?.(caughtError as Error);
    expect(toastErrorMock).toHaveBeenCalledWith('自己申告のタスク化に失敗しました');
    expect(toastErrorMock).not.toHaveBeenCalledWith('同じ自己申告のタスクが既に存在します');
  });

  it('rejects legacy successful mutation envelopes without issuing a follow-up PATCH', async () => {
    useMutationMock
      .mockReturnValueOnce({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
      .mockReturnValueOnce({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'resolved' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task_1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ExternalViewerContent />);

    const updateMutation = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (variables: {
        id: string;
        status: 'resolved';
        updated_at: string;
      }) => Promise<unknown>;
    };
    const createTaskMutation = useMutationMock.mock.calls[1]?.[0] as {
      mutationFn: (report: { id: string; updated_at: string }) => Promise<unknown>;
    };

    await expect(
      updateMutation.mutationFn({
        id: 'report_1',
        status: 'resolved',
        updated_at: '2026-03-28T01:02:03.000Z',
      }),
    ).rejects.toThrow('自己申告の更新に失敗しました');
    await expect(
      createTaskMutation.mutationFn({
        id: 'report_1',
        updated_at: '2026-03-28T01:02:03.000Z',
      }),
    ).rejects.toThrow('自己申告のタスク化に失敗しました');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses one dedicated conversion request and invalidates both source queues', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    const fetchMock = stubJsonFetch({
      data: {
        task_id: 'task_1',
        task_display_id: 'TSK-0001',
        task_status: 'pending',
        report_status: 'converted_to_task',
        already_converted: false,
      },
    });

    render(<ExternalViewerContent />);

    const createTaskMutation = useMutationMock.mock.calls[1]?.[0] as {
      mutationFn: (report: { id: string; updated_at: string }) => Promise<unknown>;
      onSuccess?: () => Promise<void>;
    };

    await createTaskMutation.mutationFn({
      id: 'report_1',
      updated_at: '2026-03-28T01:02:03.000Z',
    });
    await createTaskMutation.onSuccess?.();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/patient-self-reports/report_1/convert-to-task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({ updated_at: '2026-03-28T01:02:03.000Z' }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['patient-self-reports', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks', 'org_1'] });
    expect(toastSuccessMock).toHaveBeenCalledWith('自己申告をタスク化しました');
  });

  it('uses safe recovery copy for self-report mutation error toasts', () => {
    const mutationConfigs: Array<{ onError?: (error: Error) => void }> = [];
    const baseMutation = useMutationMock.getMockImplementation();
    useMutationMock.mockImplementation((config: { onError?: (error: Error) => void }) => {
      mutationConfigs.push(config);
      return baseMutation?.(config);
    });

    render(<ExternalViewerContent />);

    const findMutationByFallback = (fallback: string) => {
      const config = mutationConfigs.find((candidate) =>
        String(candidate.onError).includes(fallback),
      );
      expect(config).toBeTruthy();
      return config;
    };

    const cases = [
      {
        config: findMutationByFallback('自己申告の更新に失敗しました'),
        serverMessage: '自己申告APIからの詳細エラー',
        fallback: '自己申告の更新に失敗しました',
      },
      {
        config: findMutationByFallback('自己申告のタスク化に失敗しました'),
        serverMessage: 'タスクAPIからの詳細エラー',
        fallback: '自己申告のタスク化に失敗しました',
      },
    ];

    for (const { config, serverMessage, fallback } of cases) {
      config?.onError?.(new Error(serverMessage));
      expect(toastErrorMock).toHaveBeenLastCalledWith(fallback);
      expect(toastErrorMock).not.toHaveBeenLastCalledWith(serverMessage);
      config?.onError?.(new Error(''));
      expect(toastErrorMock).toHaveBeenLastCalledWith(fallback);
    }
  });

  it('passes the visible report version timestamp when the triage button is clicked', () => {
    const updateMutate = vi.fn();
    const createTaskMutate = vi.fn();
    useMutationMock
      .mockReturnValueOnce({
        mutate: updateMutate,
        mutateAsync: vi.fn(),
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: createTaskMutate,
        mutateAsync: vi.fn(),
        isPending: false,
      });
    useQueryMock
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              category: 'adherence',
              subject: '飲み忘れ',
              status: 'submitted',
              reported_by_name: '家族A',
              requested_callback: true,
              created_at: '2026-03-28T00:00:00.000Z',
              updated_at: '2026-03-28T01:02:03.000Z',
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      });

    render(<ExternalViewerContent />);

    // 自己申告のステータスは生 enum ('submitted') ではなく日本語ラベルで表示する。
    expect(screen.getByText('未対応')).toBeTruthy();
    expect(screen.queryByText('submitted')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '受理' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'report_1',
      status: 'triaged',
      updated_at: '2026-03-28T01:02:03.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: 'タスク化' }));
    expect(createTaskMutate).toHaveBeenCalledWith({
      id: 'report_1',
      updated_at: '2026-03-28T01:02:03.000Z',
    });
  });

  it('moves the requested focus queue to the first work panel', () => {
    useQueryMock
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'grant_1',
              patient_id: 'patient_1',
              patient: { name: '患者A' },
              granted_to_name: '家族A',
              granted_to_contact_masked: null,
              scope: { medications: true },
              expires_at: '2026-04-01T00:00:00.000Z',
              accessed_at: null,
              created_at: '2026-03-28T00:00:00.000Z',
              self_report_summary: { total: 0, open: 0, latest_at: null },
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              category: '服薬相談',
              subject: '残薬が増えた',
              status: 'submitted',
              reported_by_name: '家族A',
              requested_callback: true,
              created_at: '2026-03-28T00:00:00.000Z',
              updated_at: '2026-03-28T01:02:03.000Z',
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      });

    render(<ExternalViewerContent initialFocus="self_reports" />);

    const workQueue = screen.getByTestId('external-work-queue');
    const panelGrid = workQueue.lastElementChild;
    const firstPanel = workQueue.querySelector('[data-testid="external-self-report-queue"]');

    expect(firstPanel).toBe(panelGrid?.firstElementChild);
  });

  it('shows a retryable error state instead of a false empty when the share query fails', () => {
    const grantsRefetch = vi.fn();
    useQueryMock
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: grantsRefetch,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      });

    render(<ExternalViewerContent />);

    // 取得失敗を「有効な共有リンクはありません」という false empty に潰さない。
    expect(screen.queryByText('有効な共有リンクはありません')).toBeNull();
    expect(screen.getByText('外部共有を表示できません')).toBeTruthy();

    // 再試行ボタンは refetch を呼ぶ。
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(grantsRefetch).toHaveBeenCalledTimes(1);

    // サマリーは誤った 0 ではなく「—」と取得失敗の注記を出す。
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('取得に失敗しました')).toBeTruthy();
    expect(screen.queryByText('OTP共有と外部連携導線')).toBeNull();
  });

  it('uses a screen-specific loading status for each work panel skeleton', () => {
    useQueryMock
      .mockReturnValueOnce({
        data: undefined,
        isLoading: true,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      });

    render(<ExternalViewerContent />);

    expect(screen.getByRole('status', { name: '外部連携パネルを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中' })).toBeNull();
  });

  it('keeps independent panels working when only one query fails', () => {
    useQueryMock
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

    render(<ExternalViewerContent />);

    // 失敗した地域活動パネルだけがエラー表示。共有・自己申告は通常の空表示を維持。
    expect(screen.getByText('地域活動を表示できません')).toBeTruthy();
    expect(screen.getByText('有効な共有リンクはありません')).toBeTruthy();
    expect(screen.getByText('自己申告はありません')).toBeTruthy();
    expect(screen.queryByText('要フォロー活動はありません')).toBeNull();
  });
});
