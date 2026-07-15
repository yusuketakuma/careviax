// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { AppHeader, formatSyncTime, projectHeaderSyncStatus } from './app-header';

setupDomTestEnv();

const mockRouterPush = vi.fn();
const mockOpenPalette = vi.fn();
const mockSetSidebarOpen = vi.fn();
const mockSetWorkspaceRailOpen = vi.fn();
const toastErrorMock = vi.hoisted(() => vi.fn());
let mockOnline = true;
let mockLastSyncedAt: string | null = '2026-06-11T09:42:00';
let mockHasHydratedSyncState = true;
let mockIsSyncing = false;
let mockSyncFailed = false;
let mockPendingSyncCount = 0;
let mockConflictCount = 0;
let mockPathname = '/dashboard';

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
  usePathname: () => mockPathname,
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
  useOfflineStore: (
    selector: (state: {
      hasHydratedSyncState: boolean;
      isSyncing: boolean;
      syncFailed: boolean;
      syncStateRefreshFailed: boolean;
      pendingSyncCount: number;
      pendingQueue: Array<{ conflict_state?: string; lastError?: string }>;
      syncConflicts: unknown[];
      lastSyncedAt: string | null;
    }) => unknown,
  ) =>
    selector({
      hasHydratedSyncState: mockHasHydratedSyncState,
      isSyncing: mockIsSyncing,
      syncFailed: mockSyncFailed,
      syncStateRefreshFailed: false,
      pendingSyncCount: mockPendingSyncCount,
      pendingQueue: [],
      syncConflicts: Array.from({ length: mockConflictCount }),
      lastSyncedAt: mockLastSyncedAt,
    }),
}));

vi.mock('@/lib/stores/command-palette-store', () => ({
  useCommandPaletteStore: (selector: (state: { openPalette: () => void }) => unknown) =>
    selector({ openPalette: mockOpenPalette }),
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
    mockHasHydratedSyncState = true;
    mockIsSyncing = false;
    mockSyncFailed = false;
    mockPendingSyncCount = 0;
    mockConflictCount = 0;
    mockPathname = '/dashboard';
    mockRouterPush.mockClear();
    mockOpenPalette.mockClear();
    mockSetSidebarOpen.mockClear();
    mockSetWorkspaceRailOpen.mockClear();
    toastErrorMock.mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonResponse({}));
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

    const brand = screen.getByTestId('app-header-brand');
    expect(brand.getAttribute('href')).toBe('/dashboard');
    expect(brand.textContent).toContain('PH-OS');
    expect(screen.getByTestId('app-header-current-page').textContent).toBe('ホーム');

    const search = screen.getByTestId('app-header-search');
    // 検索ボックスのコピーは active カテゴリ由来(現在は薬剤のみ active、PHI カテゴリは deferred)。
    expect(search.textContent).toContain('薬剤');
    expect(search.textContent).toContain('を検索');
    expect(search.textContent).toContain('/');

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toBe('同期済み最終成功 09:42');
    expect(sync.className).toContain('text-state-done');
    expect(sync.className).toContain('hidden');
    expect(sync.className).toContain('md:flex');
    expect(screen.getByRole('link', { name: /同期済み.*同期状況を開く/ })).toBe(sync);
    expect(sync.getAttribute('href')).toBe('/offline-sync');

    const communication = screen.getByTestId('app-header-communication');
    expect(communication.getAttribute('href')).toBe(
      '/tasks?work_request=1&work_request_type=staff_work_request_general&context=header_communication',
    );
    expect(communication.className).toContain('min-w-[44px]');
    expect(screen.getByRole('button', { name: '通知 6' })).toBeTruthy();
    const settings = screen.getByRole('link', { name: '設定' });
    expect(settings.getAttribute('href')).toBe('/settings');
    expect(settings.className).toContain('hidden');
    expect(settings.className).toContain('md:inline-flex');
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

    const header = screen.getByTestId('app-header');
    const headerRow = header.firstElementChild as HTMLElement;
    expect(header.className).toContain('h-[var(--app-header-height)]');
    expect(header.className).toContain('shrink-0');
    expect(headerRow.className).toContain('h-full');
    expect(headerRow.className).not.toContain('min-h-14');
    expect(headerRow.className).toContain('min-w-0');
    expect(headerRow.className).toContain('gap-2');
    expect(headerRow.className).toContain('px-2');

    const actions = screen.getByTestId('app-header-search-compact').parentElement as HTMLElement;
    expect(actions.className).toContain('min-w-0');
    expect(actions.className).toContain('gap-1');

    expect(screen.getByTestId('app-header-mode-trigger').textContent).toContain('在宅');
    expect(screen.getByTestId('app-header-sync-status').className).toContain('hidden');
    expect(screen.getByTestId('app-header-sync-status').className).toContain('md:flex');
    expect(screen.getByRole('link', { name: '設定' }).className).toContain('hidden');
    expect(screen.getByTestId('app-header-current-page').className).toContain('truncate');
  });

  it('updates the current-page context without exposing a dynamic patient identifier', () => {
    mockPathname = '/patients/patient-secret-123';
    render(<AppHeader />);

    const currentPage = screen.getByTestId('app-header-current-page');
    expect(currentPage.textContent).toBe('患者');
    expect(currentPage.textContent).not.toContain('patient-secret-123');
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
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
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

  it('opens the command palette when the search box is clicked', () => {
    render(<AppHeader />);

    fireEvent.click(screen.getByTestId('app-header-search'));

    // F-009: ヘッダ検索ボックスは /search への遷移ではなくパレットを開く。
    expect(mockOpenPalette).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('opens the command palette from the compact search button', () => {
    render(<AppHeader />);

    fireEvent.click(screen.getByTestId('app-header-search-compact'));

    expect(mockOpenPalette).toHaveBeenCalledTimes(1);
  });

  it('labels the search box from active category labels (all categories active)', () => {
    render(<AppHeader />);

    const box = screen.getByTestId('app-header-search');
    expect(box.textContent).toContain('患者');
    expect(box.textContent).toContain('薬剤');
    expect(box.textContent).toContain('を検索');
  });

  it('does not register a global "/" shortcut (ownership moved to AppShell)', () => {
    render(
      <div>
        <AppHeader />
        <input aria-label="自由記入" />
      </div>,
    );

    // AppHeader はグローバルショートカットを登録しない。"/" 押下でパレットは開かない。
    fireEvent.keyDown(document.body, { key: '/' });
    expect(mockOpenPalette).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('shows オフライン (blocked) instead of the sync time when offline', () => {
    mockOnline = false;
    render(<AppHeader />);

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toContain('オフライン');
    expect(sync.className).toContain('text-state-blocked');
  });

  it('does not render 同期済み when no successful sync timestamp exists yet', () => {
    mockLastSyncedAt = null;
    render(<AppHeader />);

    expect(screen.getByTestId('app-header-sync-status').textContent).toBe('同期状況を確認中');
  });

  it('shows one pending status and suppresses stale success evidence', () => {
    mockPendingSyncCount = 3;
    render(<AppHeader />);

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toContain('同期待ち');
    expect(sync.textContent).toContain('3');
    expect(sync.textContent).not.toContain('同期済み');
    expect(sync.textContent).not.toContain('最終成功');
    expect(screen.getAllByTestId('app-header-sync-status')).toHaveLength(1);
    expect(sync.className).toContain('flex');
    expect(sync.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(sync.className).toContain('min-w-[44px]');
  });

  it('shows conflicts and failures before pending or syncing states', () => {
    expect(
      projectHeaderSyncStatus({
        online: true,
        hasHydratedSyncState: true,
        isSyncing: true,
        syncFailed: true,
        pendingSyncCount: 2,
        conflictCount: 1,
        lastSyncedAt: mockLastSyncedAt,
      }),
    ).toBe('conflict');

    mockConflictCount = 1;
    mockSyncFailed = true;
    mockIsSyncing = true;
    mockPendingSyncCount = 2;
    render(<AppHeader />);
    expect(screen.getByTestId('app-header-sync-status').textContent).toContain('競合あり');
  });

  it('shows a failed status before pending work and links to recovery', () => {
    mockSyncFailed = true;
    mockPendingSyncCount = 2;
    render(<AppHeader />);

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toContain('同期失敗');
    expect(sync.getAttribute('href')).toBe('/offline-sync');
    expect(sync.getAttribute('aria-label')).toContain('同期に失敗しました');
  });

  it('shows syncing only after hydration and without a simultaneous success label', () => {
    mockIsSyncing = true;
    mockPendingSyncCount = 1;
    render(<AppHeader />);

    const sync = screen.getByTestId('app-header-sync-status');
    expect(sync.textContent).toContain('同期中');
    expect(sync.textContent).not.toContain('同期済み');
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
