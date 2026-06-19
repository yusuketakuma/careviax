// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AppHeader, formatSyncTime } from './app-header';

setupDomTestEnv();

const mockRouterPush = vi.fn();
const mockSetSidebarOpen = vi.fn();
const mockSetWorkspaceRailOpen = vi.fn();
const toastErrorMock = vi.hoisted(() => vi.fn());
let mockOnline = true;
let mockLastSyncedAt: string | null = '2026-06-11T09:42:00';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}));

const mockUseUIStore = vi.fn();

vi.mock('@/lib/stores/ui-store', () => ({
  useUIStore: () => mockUseUIStore(),
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { currentUser: { name: string }; orgId: string }) => unknown) =>
    selector({ currentUser: { name: '山田 太郎' }, orgId: 'org_1' }),
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: (selector: (state: { lastSyncedAt: string | null }) => unknown) =>
    selector({ lastSyncedAt: mockLastSyncedAt }),
}));

vi.mock('@/lib/hooks/use-network-online', () => ({
  useNetworkOnline: () => mockOnline,
}));

vi.mock('@/components/features/notifications/notification-bell', () => ({
  NotificationBell: () => <button type="button">通知 6</button>,
}));

// base-ui の DropdownMenu は jsdom でポップアップ操作が安定しないため、
// トリガー/項目を素のボタンとして描画するモックでヘッダー側のロジックを検証する。
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: (allProps: { children?: React.ReactNode; render?: React.ReactElement }) => {
    const { children, ...props } = allProps;
    delete props.render;
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  },
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const mockFetch = vi.fn();

function uiStoreState(overrides?: Partial<Record<string, unknown>>) {
  return {
    sidebarOpen: false,
    setSidebarOpen: mockSetSidebarOpen,
    workspaceRailOpen: false,
    workspaceRailAvailable: true,
    setWorkspaceRailOpen: mockSetWorkspaceRailOpen,
    careMode: 'home_visit',
    setCareMode: vi.fn(),
    ...overrides,
  };
}

describe('AppHeader', () => {
  beforeEach(() => {
    mockOnline = true;
    mockLastSyncedAt = '2026-06-11T09:42:00';
    mockRouterPush.mockClear();
    mockSetSidebarOpen.mockClear();
    mockSetWorkspaceRailOpen.mockClear();
    toastErrorMock.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    mockUseUIStore.mockReturnValue(uiStoreState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows mode dropdown, search box, sync status, notification, settings and user', () => {
    render(<AppHeader />);

    const trigger = screen.getByTestId('app-header-mode-trigger');
    expect(trigger.textContent).toContain('在宅モード');
    expect(screen.getByText('モード:')).toBeTruthy();

    const search = screen.getByTestId('app-header-search');
    expect(search.textContent).toContain('患者・カード・薬剤を検索');
    expect(search.textContent).toContain('/');

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toBe('同期済み 09:42');
    expect(sync.className).toContain('text-state-done');

    const communication = screen.getByTestId('app-header-communication');
    expect(communication.getAttribute('href')).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_general&context=header_communication',
    );
    expect(communication.className).toContain('min-w-[44px]');
    expect(screen.getByRole('button', { name: '通知 6' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '設定' }).getAttribute('href')).toBe('/settings');
    expect(screen.getByTestId('app-header-user-name').textContent).toBe('山田 太郎');
  });

  it('opens the on-demand side panels from the header buttons', () => {
    render(<AppHeader />);

    fireEvent.click(screen.getByTestId('app-header-nav-toggle'));
    expect(mockSetSidebarOpen).toHaveBeenCalledWith(true);
    expect(mockSetWorkspaceRailOpen).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByTestId('app-header-workspace-rail-toggle'));
    expect(mockSetWorkspaceRailOpen).toHaveBeenCalledWith(true);
  });

  it('disables the auxiliary panel button when the current screen has no rail', () => {
    mockUseUIStore.mockReturnValue(uiStoreState({ workspaceRailAvailable: false }));
    render(<AppHeader />);

    const button = screen.getByTestId('app-header-workspace-rail-toggle');
    expect(button.hasAttribute('disabled')).toBe(true);

    fireEvent.click(button);
    expect(mockSetWorkspaceRailOpen).not.toHaveBeenCalledWith(true);
  });

  it('reflects the expanded state for the on-demand drawer buttons', () => {
    mockUseUIStore.mockReturnValue(
      uiStoreState({ sidebarOpen: true, workspaceRailOpen: true, workspaceRailAvailable: true }),
    );
    render(<AppHeader />);

    expect(screen.getByTestId('app-header-nav-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByTestId('app-header-workspace-rail-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('places the auxiliary panel button immediately after the current user in the right cluster', () => {
    render(<AppHeader />);

    const userName = screen.getByTestId('app-header-user-name');
    const button = screen.getByTestId('app-header-workspace-rail-toggle');

    expect(
      userName.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the mobile header row compact instead of pushing right-side controls off screen', () => {
    render(<AppHeader />);

    const headerRow = screen.getByTestId('app-header').firstElementChild as HTMLElement;
    expect(headerRow.className).toContain('min-w-0');
    expect(headerRow.className).toContain('gap-2');
    expect(headerRow.className).toContain('px-2');

    const actions = screen.getByTestId('app-header-search-compact').parentElement as HTMLElement;
    expect(actions.className).toContain('min-w-0');
    expect(actions.className).toContain('gap-1');
  });

  it('shows 外来モード on the trigger when careMode is outpatient', () => {
    mockUseUIStore.mockReturnValue(uiStoreState({ careMode: 'outpatient' }));
    render(<AppHeader />);

    expect(screen.getByTestId('app-header-mode-trigger').textContent).toContain('外来モード');
  });

  it('defaults to 在宅モード when careMode is unset', () => {
    mockUseUIStore.mockReturnValue(uiStoreState({ careMode: undefined }));
    render(<AppHeader />);

    expect(screen.getByTestId('app-header-mode-trigger').textContent).toContain('在宅モード');
  });

  it('selecting a mode updates the ui store and fires PATCH /api/me/preferences', () => {
    const setCareMode = vi.fn();
    mockUseUIStore.mockReturnValue(uiStoreState({ setCareMode }));
    render(<AppHeader />);

    fireEvent.click(screen.getByRole('button', { name: '外来モード' }));

    expect(setCareMode).toHaveBeenCalledWith('outpatient');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/me/preferences',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ care_mode: 'outpatient' }),
      }),
    );
  });

  it('rolls back the care mode and shows feedback when preference saving fails', async () => {
    const setCareMode = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    mockUseUIStore.mockReturnValue(uiStoreState({ careMode: 'home_visit', setCareMode }));
    render(<AppHeader />);

    fireEvent.click(screen.getByRole('button', { name: '外来モード' }));

    expect(setCareMode).toHaveBeenCalledWith('outpatient');
    await waitFor(() => {
      expect(setCareMode).toHaveBeenLastCalledWith('home_visit');
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      'モード設定を保存できませんでした。再度お試しください。',
    );
  });

  it('navigates to /search when the search box is clicked', () => {
    render(<AppHeader />);

    fireEvent.click(screen.getByTestId('app-header-search'));

    expect(mockRouterPush).toHaveBeenCalledWith('/search');
  });

  it('navigates to /search on the "/" shortcut, but not while typing in a field', () => {
    render(
      <div>
        <AppHeader />
        <input aria-label="自由記入" />
      </div>,
    );

    fireEvent.keyDown(document.body, { key: '/' });
    expect(mockRouterPush).toHaveBeenCalledWith('/search');

    mockRouterPush.mockClear();
    const input = screen.getByRole('textbox', { name: '自由記入' });
    input.focus();
    fireEvent.keyDown(input, { key: '/' });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('shows オフライン (blocked) instead of the sync time when offline', () => {
    mockOnline = false;
    render(<AppHeader />);

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toContain('オフライン');
    expect(sync.className).toContain('text-state-blocked');
  });

  it('renders 同期済み without a time when no sync timestamp exists yet', () => {
    mockLastSyncedAt = null;
    render(<AppHeader />);

    expect(screen.getByTestId('app-header-sync-status').textContent).toBe('同期済み');
  });

  it('does not render the legacy top workflow shortcut nav', () => {
    render(<AppHeader />);

    expect(screen.queryByRole('navigation', { name: 'トップ業務メニュー' })).toBeNull();
    expect(screen.queryByText('業務本流')).toBeNull();
  });
});

describe('formatSyncTime', () => {
  it('formats an ISO timestamp as HH:MM', () => {
    expect(formatSyncTime('2026-06-11T09:05:00')).toBe('09:05');
  });

  it('returns null for empty or invalid input', () => {
    expect(formatSyncTime(null)).toBeNull();
    expect(formatSyncTime('not-a-date')).toBeNull();
  });
});
