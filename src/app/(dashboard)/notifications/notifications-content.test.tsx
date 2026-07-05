// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { toast } from 'sonner';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useOfflineStoreMock = vi.hoisted(() => vi.fn());
const refreshSyncCountMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-test-org-id': orgId })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'Content-Type': 'application/json', 'x-test-json-org-id': orgId })),
);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: useOfflineStoreMock,
}));

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { NotificationsContent } from './notifications-content';

setupDomTestEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOTIFICATIONS = [
  {
    id: 'notification_1',
    type: 'urgent',
    event_type: 'medication_run_out',
    title: '薬が切れそうです',
    message: '田中 一郎様:前回薬は本日まで。訪問予定を確認してください。',
    link: '/patients/patient_1',
    is_read: false,
    created_at: '2026-06-10T08:00:00.000Z',
  },
  {
    id: 'notification_2',
    type: 'business',
    event_type: 'schedule_patient_confirmation',
    title: '患者さんへ日程確認が必要です',
    message: '佐藤 花子様:候補日時を確認してください。',
    link: '/schedules/proposals',
    is_read: false,
    created_at: '2026-06-10T07:00:00.000Z',
  },
  {
    id: 'notification_3',
    type: 'business',
    event_type: 'prescription_diff_review',
    title: '処方変更があります',
    message: '鈴木 一郎様:追加2件・中止1件。差分確認をお願いします。',
    link: '/patients/patient_2/prescriptions',
    is_read: true,
    created_at: '2026-06-10T06:00:00.000Z',
  },
];

describe('NotificationsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn(), push: vi.fn() });
    usePathnameMock.mockReturnValue('/notifications');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn(), setQueryData: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useRealtimeEventsMock.mockReturnValue({ connected: false });
    refreshSyncCountMock.mockResolvedValue(undefined);
    useOfflineStoreMock.mockImplementation(
      (
        selector: (state: {
          pendingSyncCount: number;
          refreshSyncCount: () => Promise<void>;
        }) => unknown,
      ) => selector({ pendingSyncCount: 2, refreshSyncCount: refreshSyncCountMock }),
    );
    useQueryMock.mockReturnValue({
      data: { data: NOTIFICATIONS },
      isLoading: false,
    });
  });

  it('renders the p0_04 inbox: heading, filter chips, badge cards, and open buttons', () => {
    render(<NotificationsContent />);

    expect(screen.getByRole('heading', { name: 'お知らせ', level: 1 })).toBeTruthy();
    expect(screen.getByText('急ぎの確認、返信待ち、未同期をまとめて見ます。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '全て既読にする' }).className).toContain('min-h-11');

    for (const chip of ['すべて', '急ぎ', '薬剤師確認', '事務で対応', '返信待ち', '未同期']) {
      expect(screen.getByRole('button', { name: new RegExp(chip) })).toBeTruthy();
    }

    expect(screen.getByText('薬が切れそうです')).toBeTruthy();
    expect(
      screen.getByText('田中 一郎様:前回薬は本日まで。訪問予定を確認してください。'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '開く' }).length).toBeGreaterThanOrEqual(3);

    // 未同期の合成行(offline-store 由来)
    expect(screen.getByText('送信できていない記録があります')).toBeTruthy();
  });

  it('bootstraps the offline pending-sync count on mount so a fresh load does not hide unsynced records (N22)', () => {
    render(<NotificationsContent />);

    // マウント時に IndexedDB の実状態を読み込むため refreshSyncCount を呼ぶ。これがないと
    // 直接遷移/リロードで pendingSyncCount が初期値 0 のまま「未同期」行が抑制されてしまう。
    expect(refreshSyncCountMock).toHaveBeenCalledTimes(1);
  });

  it('filters cards by the selected category chip', () => {
    render(<NotificationsContent />);

    fireEvent.click(screen.getByRole('button', { name: /薬剤師確認/ }));

    expect(screen.getByText('処方変更があります')).toBeTruthy();
    expect(screen.queryByText('薬が切れそうです')).toBeNull();
    expect(screen.queryByText('患者さんへ日程確認が必要です')).toBeNull();
  });

  it('marks a notification read and navigates when opened', () => {
    const push = vi.fn();
    const mutate = vi.fn();
    useRouterMock.mockReturnValue({ replace: vi.fn(), push });
    useMutationMock.mockReturnValue({ mutate, isPending: false });
    useOfflineStoreMock.mockImplementation(
      (
        selector: (state: {
          pendingSyncCount: number;
          refreshSyncCount: () => Promise<void>;
        }) => unknown,
      ) => selector({ pendingSyncCount: 0, refreshSyncCount: refreshSyncCountMock }),
    );

    render(<NotificationsContent />);

    const [firstOpen] = screen.getAllByRole('button', { name: '開く' });
    fireEvent.click(firstOpen);

    expect(push).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith(['notification_1']);
  });

  it('pauses inbox polling while the shared realtime stream is connected', () => {
    useRealtimeEventsMock.mockReturnValue({ connected: true });

    render(<NotificationsContent />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ refetchInterval: false }));
  });

  it('disables realtime inbox loading until org is available', () => {
    useOrgIdMock.mockReturnValue('');

    render(<NotificationsContent />);

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('keeps the inbox shell and shows skeleton rows while the inbox is loading', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<NotificationsContent />);

    expect(screen.getByRole('heading', { name: 'お知らせ', level: 1 })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'お知らせ一覧を読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.getByTestId('notifications-inbox-loading')).toBeTruthy();
    expect(screen.queryByTestId('notifications-inbox')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '全て既読にする' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('loads notifications through the shared path and org header helpers', async () => {
    const notificationsPayload = { data: [] };
    const fetchMock = stubJsonFetch(notificationsPayload);

    render(<NotificationsContent />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryFn: () => Promise<unknown> }
      | undefined;
    await expect(queryOptions?.queryFn()).resolves.toEqual(notificationsPayload);

    expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=50', {
      headers: { 'x-test-org-id': 'org_1' },
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('marks notifications read through the shared collection path and JSON org headers', async () => {
    const fetchMock = stubJsonFetch({});

    render(<NotificationsContent />);

    const mutationOptions = useMutationMock.mock.calls.at(-1)?.[0] as
      | { mutationFn: (ids: string[]) => Promise<void> }
      | undefined;
    await mutationOptions?.mutationFn(['notification/1?x=y#frag']);

    expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
      body: JSON.stringify({ ids: ['notification/1?x=y#frag'] }),
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('surfaces API error messages when marking notifications read fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: '通知の既読化権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    render(<NotificationsContent />);

    const mutationOptions = useMutationMock.mock.calls.at(-1)?.[0] as
      | {
          mutationFn: (ids: string[]) => Promise<void>;
          onError: (error: unknown) => void;
        }
      | undefined;
    await expect(mutationOptions?.mutationFn(['notification_1'])).rejects.toThrow(
      '通知の既読化権限がありません',
    );
    mutationOptions?.onError(new Error('通知の既読化権限がありません'));

    expect(fetch).toHaveBeenCalledWith('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
      body: JSON.stringify({ ids: ['notification_1'] }),
    });
    expect(toast.error).toHaveBeenCalledWith('通知の既読化権限がありません');
  });

  it('shows an error state instead of an empty inbox when notifications fail to load', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<NotificationsContent />);

    expect(screen.getByRole('heading', { name: 'お知らせを表示できません' })).toBeTruthy();
    expect(screen.queryByText('この分類のお知らせはありません')).toBeNull();
    expect(screen.queryByText('送信できていない記録があります')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '全て既読にする' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('merges notification stream items into the inbox cache', () => {
    const setQueryData = vi.fn();
    let realtimeOptions: { onEvent: (event: unknown) => void } | null = null;
    const getRealtimeOptions = () => {
      if (!realtimeOptions) throw new Error('realtime options were not captured');
      return realtimeOptions;
    };
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn(), setQueryData });
    useRealtimeEventsMock.mockImplementation((options: { onEvent: (event: unknown) => void }) => {
      realtimeOptions = options;
      return { connected: true };
    });

    render(<NotificationsContent />);
    getRealtimeOptions().onEvent([
      {
        id: 'notification_4',
        type: 'business',
        title: '新しい通知',
        message: '新着です',
        link: '/notifications',
        is_read: false,
        created_at: '2026-06-10T09:00:00.000Z',
      },
    ]);

    expect(setQueryData).toHaveBeenCalledWith(
      ['notifications', 'inbox', 'org_1'],
      expect.any(Function),
    );
    const updater = setQueryData.mock.calls[0]?.[1] as
      | ((current: { data: typeof NOTIFICATIONS }) => { data: typeof NOTIFICATIONS })
      | undefined;
    const currentItems = [
      ...Array.from({ length: 51 }, (_, index) => ({
        ...NOTIFICATIONS[0],
        id: `old_${index}`,
        title: `old ${index}`,
        created_at: new Date(Date.UTC(2026, 5, 10, 0, index)).toISOString(),
      })),
      {
        ...NOTIFICATIONS[0],
        id: 'notification_4',
        title: '古い通知',
        created_at: '2026-06-10T08:30:00.000Z',
      },
    ];
    const merged = updater?.({ data: currentItems }).data ?? [];
    expect(merged).toHaveLength(50);
    expect(merged.slice(0, 3).map((item) => item.id)).toEqual([
      'notification_4',
      'old_50',
      'old_49',
    ]);
    expect(merged[0]?.title).toBe('新しい通知');
  });
});
