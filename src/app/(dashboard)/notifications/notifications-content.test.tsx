// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useOfflineStoreMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
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

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: useOfflineStoreMock,
}));

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

import { NotificationsContent } from './notifications-content';

setupDomTestEnv();

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
    useOfflineStoreMock.mockImplementation(
      (selector: (state: { pendingSyncCount: number }) => unknown) =>
        selector({ pendingSyncCount: 2 }),
    );
    useQueryMock.mockReturnValue({
      data: { data: NOTIFICATIONS },
      isLoading: false,
    });
  });

  it('renders the p0_04 inbox: heading, filter chips, badge cards, and open buttons', () => {
    render(<NotificationsContent />);

    expect(screen.getByRole('heading', { name: 'お知らせ' })).toBeTruthy();
    expect(screen.getByText('急ぎの確認、返信待ち、未同期をまとめて見ます。')).toBeTruthy();

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
      (selector: (state: { pendingSyncCount: number }) => unknown) =>
        selector({ pendingSyncCount: 0 }),
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
