// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import {
  createFetchMock,
  firstPageNotifications,
  notification,
  olderNotification,
} from './notification-bell.fetch.test-fixtures';

const {
  buildOrgHeadersMock,
  buildOrgJsonHeadersMock,
  getBrowserNotificationPreferenceMock,
  isBrowserNotificationSupportedMock,
  setNotificationDrawerOpenMock,
  showBrowserNotificationMock,
  subscribeSharedRealtimeStreamMock,
  uiState,
} = vi.hoisted(() => ({
  buildOrgHeadersMock: vi.fn((orgId: string) => ({ 'x-test-org-id': orgId })),
  buildOrgJsonHeadersMock: vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-test-json-org-id': orgId,
  })),
  getBrowserNotificationPreferenceMock: vi.fn(() => false),
  isBrowserNotificationSupportedMock: vi.fn(() => false),
  setNotificationDrawerOpenMock: vi.fn(),
  showBrowserNotificationMock: vi.fn(),
  subscribeSharedRealtimeStreamMock: vi.fn(() => vi.fn()),
  uiState: {
    notificationDrawerOpen: true,
    orgId: 'org_1',
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => uiState.orgId,
}));

vi.mock('@/lib/stores/ui-store', () => ({
  useUIStore: () => ({
    notificationDrawerOpen: uiState.notificationDrawerOpen,
    setNotificationDrawerOpen: setNotificationDrawerOpenMock,
  }),
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/browser-notifications', () => ({
  getBrowserNotificationPreference: getBrowserNotificationPreferenceMock,
  isBrowserNotificationSupported: isBrowserNotificationSupportedMock,
  showBrowserNotification: showBrowserNotificationMock,
}));

vi.mock('@/lib/realtime/shared-event-stream', () => ({
  subscribeSharedRealtimeStream: subscribeSharedRealtimeStreamMock,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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

import { NotificationBell } from './notification-bell';

setupDomTestEnv();

describe('NotificationBell fetch contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrowserNotificationPreferenceMock.mockReturnValue(false);
    isBrowserNotificationSupportedMock.mockReturnValue(false);
    uiState.notificationDrawerOpen = true;
    uiState.orgId = 'org_1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads notification summary and drawer items through shared paths and org headers', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?summary=1', {
        headers: { 'x-test-org-id': 'org_1' },
      }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=20', {
        headers: { 'x-test-org-id': 'org_1' },
      }),
    );
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('shows the empty state only after a successful zero-item response', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 0 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    expect(await screen.findByText('通知はありません')).not.toBeNull();
    expect(screen.queryByText('通知を取得できません')).toBeNull();
    expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe('通知');
  });

  it('distinguishes summary preparation and loading from an authoritative count', async () => {
    let resolveSummary: ((response: Response) => void) | undefined;
    const summaryResponse = new Promise<Response>((resolve) => {
      resolveSummary = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') return summaryResponse;
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
      '通知 未読件数を準備中',
    );
    await waitFor(() =>
      expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
        '通知 未読件数を読み込み中',
      ),
    );

    act(() => {
      resolveSummary?.(jsonResponse({ data: { unreadCount: 0 } }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
        '通知',
      ),
    );
  });

  it('isolates deferred responses when the organization changes', async () => {
    let resolveOrgOneList: ((response: Response) => void) | undefined;
    const orgOneListResponse = new Promise<Response>((resolve) => {
      resolveOrgOneList = resolve;
    });
    const orgTwoNotification = {
      ...notification,
      id: 'notification_org_2',
      message: '組織2の通知です',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      const orgId = headers?.['x-test-org-id'];
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: orgId === 'org_2' ? 1 : 0 } }));
      }
      if (url === '/api/notifications?limit=20') {
        if (orgId === 'org_1') return orgOneListResponse;
        return Promise.resolve(
          jsonResponse({
            data: [orgTwoNotification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<NotificationBell />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=20', {
        headers: { 'x-test-org-id': 'org_1' },
      }),
    );

    uiState.orgId = 'org_2';
    rerender(<NotificationBell />);

    expect(await screen.findByText(orgTwoNotification.message)).not.toBeNull();
    act(() => {
      resolveOrgOneList?.(
        jsonResponse({
          data: [notification],
          meta: { limit: 20, has_more: false, next_cursor: null },
        }),
      );
    });
    await waitFor(() => expect(screen.queryByText(notification.message)).toBeNull());
    expect(screen.getByText(orgTwoNotification.message)).not.toBeNull();
    expect(subscribeSharedRealtimeStreamMock.mock.results[0]?.value).toHaveBeenCalledOnce();
  });

  it('keeps the authoritative unread total separate from the loaded page count', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 21 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: firstPageNotifications,
            meta: { limit: 20, has_more: true, next_cursor: 'notification_20' },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() =>
      expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
        '通知 21件の未読',
      ),
    );
    const liveStatus = screen.getByText('未読 21 件 / 読込済み 20 件（一部表示）');
    expect(liveStatus.getAttribute('aria-live')).toBe('polite');
    expect(liveStatus.getAttribute('aria-atomic')).toBe('true');
    expect(screen.getByRole('button', { name: 'さらに読み込む' }).className).toContain('min-h-11');
  });

  it('replaces a refreshed first page while preserving realtime arrivals during the request', async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    let listRequests = 0;
    const replacementNotification = {
      ...olderNotification,
      id: 'notification_replacement',
      message: '更新後の通知です',
    };
    const realtimeNotification = {
      ...notification,
      id: 'notification_realtime',
      message: '更新中に届いた通知です',
      created_at: '2026-06-11T08:00:00.000Z',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 2 } }));
      }
      if (url === '/api/notifications?limit=20') {
        listRequests += 1;
        if (listRequests === 1) {
          return Promise.resolve(
            jsonResponse({
              data: [notification],
              meta: { limit: 20, has_more: false, next_cursor: null },
            }),
          );
        }
        return refreshResponse;
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    expect(await screen.findByText(notification.message)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    await waitFor(() => expect(listRequests).toBe(2));
    const subscribeCalls = subscribeSharedRealtimeStreamMock.mock.calls as unknown as Array<
      [{ onEvent?: (event: unknown) => void }]
    >;
    act(() => {
      subscribeCalls[0]?.[0].onEvent?.([realtimeNotification]);
    });

    act(() => {
      resolveRefresh?.(
        jsonResponse({
          data: [replacementNotification],
          meta: { limit: 20, has_more: false, next_cursor: null },
        }),
      );
    });

    expect(await screen.findByText(replacementNotification.message)).not.toBeNull();
    expect(screen.getByText(realtimeNotification.message)).not.toBeNull();
    expect(screen.queryByText(notification.message)).toBeNull();
  });

  it('loads the next cursor page and deduplicates loaded notifications', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 21 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: firstPageNotifications,
            meta: { limit: 20, has_more: true, next_cursor: 'notification_20' },
          }),
        );
      }
      if (url === '/api/notifications?limit=20&cursor=notification_20') {
        return Promise.resolve(
          jsonResponse({
            data: [firstPageNotifications[19], olderNotification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=20&cursor=notification_20', {
        headers: { 'x-test-org-id': 'org_1' },
      }),
    );
    expect(await screen.findByText(olderNotification.message)).not.toBeNull();
    expect(screen.getAllByText(notification.message)).toHaveLength(1);
    expect(screen.getByText('未読 21 件 / 読込済み 21 件')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull();
  });

  it('retains a loaded page when the next page fails and retries the same cursor', async () => {
    let cursorAttempts = 0;
    const failedBodyMock = vi.fn(async () => 'patient:secret');
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 21 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: firstPageNotifications,
            meta: { limit: 20, has_more: true, next_cursor: 'notification_20' },
          }),
        );
      }
      if (url === '/api/notifications?limit=20&cursor=notification_20') {
        cursorAttempts += 1;
        if (cursorAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: failedBodyMock,
          } as unknown as Response);
        }
        return Promise.resolve(
          jsonResponse({
            data: [olderNotification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }));
    expect(await screen.findByText('通知を取得できません')).not.toBeNull();
    expect(screen.getByText(notification.message)).not.toBeNull();
    expect(screen.getByText('未読 21 件 / 読込済み 20 件（一部表示）')).not.toBeNull();
    expect(failedBodyMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText(olderNotification.message)).not.toBeNull();
    expect(cursorAttempts).toBe(2);
    expect(screen.queryByText('通知を取得できません')).toBeNull();
  });

  it('rejects a repeated next cursor instead of allowing a pagination cycle', async () => {
    const secondPage = Array.from({ length: 20 }, (_, index) => ({
      ...notification,
      id: `notification_${index + 21}`,
      title: `追加通知 ${index + 21}`,
      message: `追加通知メッセージ ${index + 21}`,
      created_at: `2026-06-08T${String(index).padStart(2, '0')}:00:00.000Z`,
    }));
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 40 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: firstPageNotifications,
            meta: { limit: 20, has_more: true, next_cursor: 'notification_20' },
          }),
        );
      }
      if (url === '/api/notifications?limit=20&cursor=notification_20') {
        return Promise.resolve(
          jsonResponse({
            data: secondPage,
            meta: { limit: 20, has_more: true, next_cursor: 'notification_20' },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: 'さらに読み込む' }));

    expect(await screen.findByText('通知を取得できません')).not.toBeNull();
    expect(screen.queryByText(secondPage[0].message)).toBeNull();
    expect(screen.queryByRole('button', { name: 'さらに読み込む' })).toBeNull();
  });

  it('marks a notification read through the shared collection path and JSON org headers', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: '既読にする' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
        body: JSON.stringify({ ids: ['notification_1'] }),
      }),
    );
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('rolls back a single optimistic read when PATCH fails without reading the failed body', async () => {
    const failedBodyMock = vi.fn(async () => 'patient:山田太郎 medication:ワルファリン');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications' && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: failedBodyMock,
        } as unknown as Response);
      }
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [notification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: '既読にする' }));

    expect(await screen.findByText('既読状態を更新できません')).not.toBeNull();
    expect(screen.getByRole('button', { name: '既読にする' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '再試行' })).not.toBeNull();
    expect(failedBodyMock).not.toHaveBeenCalled();
    expect(JSON.stringify(document.body.textContent)).not.toContain('山田太郎');
    expect(JSON.stringify(document.body.textContent)).not.toContain('ワルファリン');
  });

  it('rolls back a single optimistic read when a successful PATCH acknowledgement is malformed', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ data: { unexpected: true } }));
      }
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [notification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: '既読にする' }));

    expect(await screen.findByText('既読状態を更新できません')).not.toBeNull();
    expect(screen.getByRole('button', { name: '既読にする' })).not.toBeNull();
  });

  it.each(['全て既読にしました', '2件を既読にしました'])(
    'rejects the structurally valid but operation-invalid acknowledgement %s',
    async (message) => {
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/notifications' && init?.method === 'PATCH') {
          return Promise.resolve(jsonResponse({ data: { message } }));
        }
        if (url === '/api/notifications?summary=1') {
          return Promise.resolve(jsonResponse({ data: { unreadCount: 1 } }));
        }
        if (url === '/api/notifications?limit=20') {
          return Promise.resolve(
            jsonResponse({
              data: [notification],
              meta: { limit: 20, has_more: false, next_cursor: null },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: { message: '1件を既読にしました' } }));
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<NotificationBell />);

      fireEvent.click(await screen.findByRole('button', { name: '既読にする' }));

      expect(await screen.findByText('既読状態を更新できません')).not.toBeNull();
      expect(screen.getByRole('button', { name: '既読にする' })).not.toBeNull();
    },
  );

  it('marks all authoritative unread notifications read with the server all contract', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await screen.findByRole('button', { name: '既読にする' });
    fireEvent.click(await screen.findByRole('button', { name: '未読通知をすべて既読' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
        body: JSON.stringify({ all: true }),
      }),
    );
    expect(screen.queryByRole('button', { name: '全て既読' })).toBeNull();
  });

  it('retries a failed mark-all with the same all contract and preserves rollback', async () => {
    let patchAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications' && init?.method === 'PATCH') {
        patchAttempts += 1;
        if (patchAttempts === 1) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        return Promise.resolve(jsonResponse({ data: { message: '全て既読にしました' } }));
      }
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: patchAttempts >= 2 ? 0 : 1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [{ ...notification, is_read: patchAttempts >= 2 }],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await screen.findByRole('button', { name: '既読にする' });
    fireEvent.click(await screen.findByRole('button', { name: '未読通知をすべて既読' }));
    expect(await screen.findByText('既読状態を更新できません')).not.toBeNull();
    expect(screen.getByRole('button', { name: '既読にする' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    await waitFor(() => expect(patchAttempts).toBe(2));
    const patchBodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === '/api/notifications' && init?.method === 'PATCH')
      .map(([, init]) => init?.body);
    expect(patchBodies).toEqual([JSON.stringify({ all: true }), JSON.stringify({ all: true })]);
    await waitFor(() => expect(screen.queryByText('既読状態を更新できません')).toBeNull());
    expect(screen.queryByRole('button', { name: '既読にする' })).toBeNull();
  });

  it('shows fixed retry states for refresh failures without reading failed response bodies', async () => {
    const textMock = vi.fn(async () => 'patient:山田太郎 medication:ワルファリン');
    const fetchMock = vi.fn(
      async () => ({ ok: false, status: 500, text: textMock }) as unknown as Response,
    );
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?summary=1', {
        headers: { 'x-test-org-id': 'org_1' },
      });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications?limit=20', {
        headers: { 'x-test-org-id': 'org_1' },
      });
    });

    expect(textMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(notification.message)).toBeNull();
    expect(screen.queryByText('通知はありません')).toBeNull();
    expect(screen.getByText('未読件数を取得できません')).not.toBeNull();
    expect(screen.getByText('通知を取得できません')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: '再試行' })).toHaveLength(2);
    expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
      '通知 未読件数は取得できません',
    );

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('shows retry states for malformed successful notification refresh bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('not-json', { status: 200 }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(notification.message)).toBeNull();
    expect(screen.queryByText('通知はありません')).toBeNull();
    expect(screen.getByText('未読件数を取得できません')).not.toBeNull();
    expect(screen.getByText('通知を取得できません')).not.toBeNull();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('keeps network rejection details private while exposing fixed recovery copy', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('patient:山田太郎 medication:ワルファリン');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(notification.message)).toBeNull();
    expect(screen.queryByText('通知はありません')).toBeNull();
    expect(screen.getByText('未読件数を取得できません')).not.toBeNull();
    expect(screen.getByText('通知を取得できません')).not.toBeNull();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('rejects wrong-shaped successful notification refresh bodies as unavailable', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: '6' } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(jsonResponse({ data: {} }));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('app-header-notifications').textContent).toBe('通知');
    expect(screen.queryByText(notification.message)).toBeNull();
    expect(screen.queryByText('通知はありません')).toBeNull();
    expect(screen.getByText('未読件数を取得できません')).not.toBeNull();
    expect(screen.getByText('通知を取得できません')).not.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it.each([
    ['legacy list envelope', { data: [notification] }],
    [
      'unsafe external notification link',
      {
        data: [{ ...notification, link: 'https://example.invalid/notification' }],
        meta: { limit: 20, has_more: false, next_cursor: null },
      },
    ],
  ])('ignores %s before populating the drawer', async (_label, listPayload) => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(jsonResponse(listPayload));
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(notification.message)).toBeNull();
  });

  it('ignores a negative unread summary before changing the badge state', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: -1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('app-header-notifications').textContent).toBe('通知');
  });

  it('does not overwrite a newer same-ID realtime state when mark-all rolls back', async () => {
    let resolvePatch: ((response: Response) => void) | undefined;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const realtimeNotification = {
      ...notification,
      title: '更新済み通知',
      message: '操作中に更新された通知です',
      created_at: '2026-06-11T08:00:00.000Z',
      is_read: true,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications' && init?.method === 'PATCH') return patchResponse;
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: 2 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: [notification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await screen.findByRole('button', { name: '既読にする' });
    fireEvent.click(await screen.findByRole('button', { name: '未読通知をすべて既読' }));
    await waitFor(() => expect(subscribeSharedRealtimeStreamMock).toHaveBeenCalledOnce());
    const subscribeCalls = subscribeSharedRealtimeStreamMock.mock.calls as unknown as Array<
      [{ onEvent?: (event: unknown) => void }]
    >;

    act(() => {
      subscribeCalls[0]?.[0].onEvent?.([realtimeNotification]);
    });
    expect(await screen.findByText(realtimeNotification.message)).not.toBeNull();

    act(() => {
      resolvePatch?.(new Response(null, { status: 503 }));
    });

    expect(await screen.findByText('既読状態を更新できません')).not.toBeNull();
    expect(screen.getByText(realtimeNotification.message)).not.toBeNull();
    expect(screen.queryByText(notification.message)).toBeNull();
    expect(screen.queryByRole('button', { name: '既読にする' })).toBeNull();
  });

  it('reconciles a successful mark-all with a concurrent realtime notification', async () => {
    let resolvePatch: ((response: Response) => void) | undefined;
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    let patchResolved = false;
    const realtimeNotification = {
      ...olderNotification,
      id: 'notification_realtime_success',
      message: '既読処理中に届いた通知です',
      created_at: '2026-06-11T08:00:00.000Z',
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/notifications' && init?.method === 'PATCH') return patchResponse;
      if (url === '/api/notifications?summary=1') {
        return Promise.resolve(jsonResponse({ data: { unreadCount: patchResolved ? 0 : 1 } }));
      }
      if (url === '/api/notifications?limit=20') {
        return Promise.resolve(
          jsonResponse({
            data: patchResolved
              ? [
                  { ...notification, is_read: true },
                  { ...realtimeNotification, is_read: true },
                ]
              : [notification],
            meta: { limit: 20, has_more: false, next_cursor: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { message: '既読にしました' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await screen.findByRole('button', { name: '既読にする' });
    fireEvent.click(await screen.findByRole('button', { name: '未読通知をすべて既読' }));
    const subscribeCalls = subscribeSharedRealtimeStreamMock.mock.calls as unknown as Array<
      [{ onEvent?: (event: unknown) => void }]
    >;
    act(() => {
      subscribeCalls[0]?.[0].onEvent?.([realtimeNotification]);
    });
    expect(await screen.findByText(realtimeNotification.message)).not.toBeNull();

    patchResolved = true;
    act(() => {
      resolvePatch?.(jsonResponse({ data: { message: '全て既読にしました' } }));
    });

    await waitFor(() =>
      expect(screen.getByTestId('app-header-notifications').getAttribute('aria-label')).toBe(
        '通知',
      ),
    );
    expect(screen.getByText(realtimeNotification.message)).not.toBeNull();
    expect(screen.queryByRole('button', { name: '既読にする' })).toBeNull();
    expect(screen.getByText('未読 0 件 / 読込済み 2 件')).not.toBeNull();
  });

  it('hidden-tab OS 通知では raw title/message/link を helper へ渡さない', async () => {
    getBrowserNotificationPreferenceMock.mockReturnValue(true);
    isBrowserNotificationSupportedMock.mockReturnValue(true);
    uiState.notificationDrawerOpen = false;
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    vi.stubGlobal(
      'Notification',
      class Notification {
        static permission = 'granted';
      },
    );
    const phiNotification = {
      id: 'notification_phi_1',
      type: 'urgent',
      title: '山田 太郎さんの疑義照会',
      message: 'ワルファリン用量を確認してください',
      link: '/patients/patient_1/prescriptions/rx_1',
      created_at: '2026-07-06T00:00:00.000Z',
      is_read: false,
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ data: { unreadCount: 0 } })));
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(subscribeSharedRealtimeStreamMock).toHaveBeenCalledOnce());
    const subscribeCalls = subscribeSharedRealtimeStreamMock.mock.calls as unknown as Array<
      [{ onEvent?: (event: unknown) => void }]
    >;
    const subscription = subscribeCalls[0]?.[0];

    act(() => {
      subscription?.onEvent?.([phiNotification]);
    });

    await waitFor(() =>
      expect(showBrowserNotificationMock).toHaveBeenCalledWith({
        tag: 'notification_phi_1',
        type: 'urgent',
      }),
    );

    const serialized = JSON.stringify(showBrowserNotificationMock.mock.calls);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('太郎');
    expect(serialized).not.toContain('ワルファリン');
    expect(serialized).not.toContain('patient_1');
    expect(serialized).not.toContain('/patients/');
    expect(serialized).not.toContain('/prescriptions/');
  });
});
