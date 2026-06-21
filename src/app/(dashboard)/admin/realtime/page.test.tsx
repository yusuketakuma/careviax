// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import RealtimePage from './page';

setupDomTestEnv();

const WORKFLOW_DATA = {
  data: {
    route_control: {
      locked_schedules: 1,
      pending_override_requests: 2,
      emergency_impact_items: 3,
    },
    workflow_exceptions: {
      open: 4,
    },
    unified_workbench: [
      {
        id: 'workbench_1',
        queue_label: '監査',
        title: '処方監査',
        summary: '確認が必要です',
        priority: 'urgent',
        due_at: '2026-06-17T00:00:00.000Z',
        action_href: '/workflow',
        action_label: '開く',
        patient_name: '田中 一郎',
        badges: ['監査'],
      },
    ],
  },
};

const NOTIFICATIONS_DATA = {
  data: [
    {
      id: 'notification_1',
      type: 'urgent',
      title: '緊急通知',
      message: '確認してください',
      link: '/notifications',
      is_read: false,
      created_at: '2026-06-17T00:00:00.000Z',
    },
  ],
};

describe('RealtimePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ setQueryData: vi.fn() });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const [scope] = queryKey;
      if (scope === 'admin-realtime-workflow') {
        return { data: WORKFLOW_DATA, connected: true };
      }
      if (scope === 'admin-realtime-notifications') {
        return { data: NOTIFICATIONS_DATA, connected: true };
      }
      throw new Error(`Unexpected query key: ${JSON.stringify(queryKey)}`);
    });
  });

  it('uses the shared realtime query policy for workflow and notification streams', () => {
    render(<RealtimePage />);

    expect(screen.getByText('リアルタイム運用監視')).toBeTruthy();
    expect(screen.getByText('SSE 接続中です。新着通知は即時反映されます。')).toBeTruthy();
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-realtime-workflow', 'org_1'],
        invalidateOn: ['workflow_refresh', 'cycle_transition'],
        fallbackRefetchInterval: 15_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-realtime-notifications', 'org_1'],
        invalidateOn: false,
        fallbackRefetchInterval: 60_000,
        onRealtimeEvent: expect.any(Function),
      }),
    );
  });

  it('merges notification stream items into the admin realtime cache', () => {
    const setQueryData = vi.fn();
    useQueryClientMock.mockReturnValue({ setQueryData });

    render(<RealtimePage />);

    const notificationsCall = useRealtimeQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'admin-realtime-notifications',
    );
    const onRealtimeEvent = notificationsCall?.[0].onRealtimeEvent as
      | ((event: unknown) => void)
      | undefined;
    expect(onRealtimeEvent).toBeTypeOf('function');

    onRealtimeEvent?.([
      {
        id: 'notification_2',
        type: 'business',
        title: '新着',
        message: '新しい通知です',
        link: '/notifications',
        is_read: false,
        created_at: '2026-06-17T01:00:00.000Z',
      },
    ]);

    expect(setQueryData).toHaveBeenCalledWith(
      ['admin-realtime-notifications', 'org_1'],
      expect.any(Function),
    );
    const updater = setQueryData.mock.calls[0]?.[1] as
      | ((current: { data: typeof NOTIFICATIONS_DATA.data }) => {
          data: typeof NOTIFICATIONS_DATA.data;
        })
      | undefined;
    const currentItems = [
      ...Array.from({ length: 13 }, (_, index) => ({
        ...NOTIFICATIONS_DATA.data[0],
        id: `old_${index}`,
        title: `old ${index}`,
        created_at: new Date(Date.UTC(2026, 5, 17, 0, index)).toISOString(),
      })),
      {
        ...NOTIFICATIONS_DATA.data[0],
        id: 'notification_2',
        title: '古い新着',
        created_at: '2026-06-17T00:30:00.000Z',
      },
    ];
    const merged = updater?.({ data: currentItems }).data ?? [];
    expect(merged).toHaveLength(12);
    expect(merged.slice(0, 3).map((item) => item.id)).toEqual([
      'notification_2',
      'old_12',
      'old_11',
    ]);
    expect(merged[0]?.title).toBe('新着');
  });

  it('disables admin realtime queries until org is available', () => {
    useOrgIdMock.mockReturnValue('');

    render(<RealtimePage />);

    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-realtime-workflow', ''],
        enabled: false,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-realtime-notifications', ''],
        enabled: false,
      }),
    );
  });

  it('ignores malformed notification realtime payloads', () => {
    const setQueryData = vi.fn();
    useQueryClientMock.mockReturnValue({ setQueryData });

    render(<RealtimePage />);

    const notificationsCall = useRealtimeQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'admin-realtime-notifications',
    );
    const onRealtimeEvent = notificationsCall?.[0].onRealtimeEvent as
      | ((event: unknown) => void)
      | undefined;
    onRealtimeEvent?.({ type: 'ignored' });

    expect(setQueryData).not.toHaveBeenCalled();
  });

  it('shows ErrorState (not a false-empty) with retry when the notifications query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const [scope] = queryKey;
      if (scope === 'admin-realtime-workflow') {
        return { data: WORKFLOW_DATA, connected: true };
      }
      // 通知取得が失敗 → 空状態ではなく ErrorState + 再読み込み。
      return { data: undefined, isError: true, refetch, connected: false };
    });

    render(<RealtimePage />);

    expect(screen.getByText('サーバーエラーが発生しました')).toBeTruthy();
    // false-empty（「未読通知はありません」）を出していないこと。
    expect(screen.queryByText('未読通知はありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows ErrorState (not a false-empty) with retry when the workflow query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      const [scope] = queryKey;
      if (scope === 'admin-realtime-notifications') {
        return { data: NOTIFICATIONS_DATA, connected: true };
      }
      // ワークフロー取得が失敗 → ワークベンチは空状態ではなく ErrorState + 再読み込み。
      return { data: undefined, isError: true, refetch, connected: false };
    });

    render(<RealtimePage />);

    // ワークフロー失敗は KPI グリッドとワークベンチの両方を ErrorState 化する。
    expect(screen.getAllByText('サーバーエラーが発生しました').length).toBeGreaterThanOrEqual(1);
    // false-empty（「未処理項目はありません」）と KPI の false-zero を出していないこと。
    expect(screen.queryByText('未処理項目はありません')).toBeNull();

    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    expect(refetch).toHaveBeenCalled();
  });
});
