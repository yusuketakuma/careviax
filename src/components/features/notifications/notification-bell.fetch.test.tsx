// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';

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
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
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
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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

const notification = {
  id: 'notification_1',
  type: 'business',
  title: '訪問確認',
  message: '患者さんへの連絡確認があります',
  link: '/notifications',
  created_at: '2026-06-10T08:00:00.000Z',
  is_read: false,
};

function createFetchMock() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
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
    if (url === '/api/notifications') {
      return Promise.resolve(jsonResponse({ data: { message: '1件を既読にしました' } }));
    }
    return Promise.resolve(
      jsonResponse({ data: [], meta: { limit: 20, has_more: false, next_cursor: null } }),
    );
  });
}

describe('NotificationBell fetch contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrowserNotificationPreferenceMock.mockReturnValue(false);
    isBrowserNotificationSupportedMock.mockReturnValue(false);
    uiState.notificationDrawerOpen = true;
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

  it('marks all unread notifications read with a scoped action label', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    fireEvent.click(await screen.findByRole('button', { name: '未読通知をすべて既読' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
        body: JSON.stringify({ ids: ['notification_1'] }),
      }),
    );
    expect(screen.queryByRole('button', { name: '全て既読' })).toBeNull();
  });

  it('keeps notification refresh failures silent without reading failed response bodies', async () => {
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

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('ignores malformed successful notification refresh bodies without surfacing an error', async () => {
    const fetchMock = vi.fn(async () => new Response('not-json', { status: 200 }));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    render(<NotificationBell />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(notification.message)).toBeNull();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('keeps notification refresh network rejections silent', async () => {
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

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('ignores wrong-shaped successful notification refresh bodies', async () => {
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
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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
