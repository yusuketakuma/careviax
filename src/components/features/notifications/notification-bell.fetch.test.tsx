// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const {
  buildOrgHeadersMock,
  buildOrgJsonHeadersMock,
  setNotificationDrawerOpenMock,
  subscribeSharedRealtimeStreamMock,
  uiState,
} = vi.hoisted(() => ({
  buildOrgHeadersMock: vi.fn((orgId: string) => ({ 'x-test-org-id': orgId })),
  buildOrgJsonHeadersMock: vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-test-json-org-id': orgId,
  })),
  setNotificationDrawerOpenMock: vi.fn(),
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
  getBrowserNotificationPreference: () => false,
  isBrowserNotificationSupported: () => false,
  showBrowserNotification: vi.fn(),
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
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: { unreadCount: 1 } }),
      } as Partial<Response> as Response);
    }
    if (url === '/api/notifications?limit=20') {
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [notification] }),
      } as Partial<Response> as Response);
    }
    return Promise.resolve({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    } as Partial<Response> as Response);
  });
}

describe('NotificationBell fetch contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
