// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  deriveShellViewport,
  resolveQuickCreateTarget,
  resolveSidebarSheetOpen,
  shouldUseMinimalShell,
  shouldRenderCompactSidebarSheet,
} from './app-shell';

setupDomTestEnv();

// AppShell が useKeyboardShortcuts に渡すグローバルショートカット定義を捕捉する。
const {
  capturedShortcuts,
  mockOpenPalette,
  mockClosePalette,
  mockSetShortcutHelpOpen,
  paletteState,
  nav,
} = vi.hoisted(() => ({
  capturedShortcuts: [] as Array<{ key: string; metaKey?: boolean; handler: () => void }>,
  mockOpenPalette: vi.fn(),
  mockClosePalette: vi.fn(),
  mockSetShortcutHelpOpen: vi.fn(),
  paletteState: { open: false },
  nav: { pathname: '/dashboard' },
}));

vi.mock('@/components/features/keyboard/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: (shortcuts: typeof capturedShortcuts) => {
    capturedShortcuts.length = 0;
    capturedShortcuts.push(...shortcuts);
  },
}));
vi.mock('@/lib/stores/command-palette-store', () => ({
  useCommandPaletteStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      open: paletteState.open,
      openPalette: mockOpenPalette,
      closePalette: mockClosePalette,
    }),
}));
vi.mock('@/lib/stores/ui-store', () => ({
  useUIStore: () => ({
    sidebarOpen: false,
    setSidebarOpen: vi.fn(),
    workspaceRailOpen: false,
    setWorkspaceRailOpen: vi.fn(),
    shortcutHelpOpen: false,
    setShortcutHelpOpen: mockSetShortcutHelpOpen,
    toggleShortcutHelp: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/layout/app-header', () => ({ AppHeader: () => null }));
vi.mock('@/components/layout/network-status-banner', () => ({ NetworkStatusBanner: () => null }));
vi.mock('@/components/layout/route-progress', () => ({ RouteProgress: () => null }));
vi.mock('@/components/features/pwa/install-prompt', () => ({ InstallPrompt: () => null }));
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/mobile-nav', () => ({ MobileNav: () => null }));
vi.mock('@/components/auth/session-timeout-modal', () => ({ SessionTimeoutModal: () => null }));
vi.mock('@/components/features/mobile/mobile-orientation-guard', () => ({
  MobileOrientationGuard: () => null,
}));
vi.mock('@/components/features/keyboard/shortcut-help-modal', () => ({
  ShortcutHelpModal: () => null,
}));
vi.mock('@/components/features/search/command-palette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('resolveQuickCreateTarget', () => {
  it('keeps real create routes for primary modules', () => {
    expect(resolveQuickCreateTarget('/patients')).toEqual({ href: '/patients/new' });
    expect(resolveQuickCreateTarget('/prescriptions')).toEqual({ href: '/prescriptions/new' });
  });

  it('avoids dead routes for reports and schedules', () => {
    expect(resolveQuickCreateTarget('/reports')).toEqual({
      href: '/reports',
      notice: '報告書は一覧から対象記録を選択して開始します',
    });
    expect(resolveQuickCreateTarget('/schedules')).toEqual({
      href: '/schedules/proposals?workspace=optimizer',
      notice: 'スケジュールは候補作成・週次最適化画面から開始します',
    });
  });

  it('falls back to patient creation when a module has no dedicated create screen', () => {
    expect(resolveQuickCreateTarget('/workflow')).toEqual({
      href: '/patients/new',
      notice: 'この画面には専用の新規作成先がないため、患者新規登録を開きます',
    });
  });
});

describe('resolveSidebarSheetOpen', () => {
  it('allows the sidebar drawer to open from the top bar on desktop', () => {
    expect(resolveSidebarSheetOpen(false, true)).toBe(true);
  });

  it('opens the sidebar drawer only when requested', () => {
    expect(resolveSidebarSheetOpen(true, true)).toBe(true);
    expect(resolveSidebarSheetOpen(true, false)).toBe(false);
  });
});

describe('shouldUseMinimalShell', () => {
  it('switches print routes to the minimal shell', () => {
    expect(shouldUseMinimalShell('/reports/report_1/print')).toBe(true);
    expect(shouldUseMinimalShell('/patients/p1/medications/print')).toBe(true);
  });

  it('keeps normal workflow routes on the full shell', () => {
    expect(shouldUseMinimalShell('/reports/report_1')).toBe(false);
    expect(shouldUseMinimalShell('/patients/p1')).toBe(false);
  });

  it('keeps the print hub (/reports/print) on the full shell', () => {
    expect(shouldUseMinimalShell('/reports/print')).toBe(false);
  });
});

describe('deriveShellViewport', () => {
  it('flags resolved desktop viewports as ready and non-compact', () => {
    const viewport = deriveShellViewport({
      matchMedia: (query) =>
        ({
          matches: query === '(min-width: 1280px)',
        }) as MediaQueryList,
    });

    expect(viewport).toEqual({
      isReady: true,
      isDesktopLayout: true,
      isTabletLayout: false,
      isCompactLayout: false,
    });
  });
});

describe('shouldRenderCompactSidebarSheet', () => {
  it('keeps the drawer mount point unmounted until viewport hydration completes', () => {
    expect(
      shouldRenderCompactSidebarSheet({
        isReady: false,
        isDesktopLayout: false,
        isTabletLayout: false,
        isCompactLayout: false,
      }),
    ).toBe(false);
  });

  it('renders the drawer mount point after viewport hydration on desktop too', () => {
    expect(
      shouldRenderCompactSidebarSheet({
        isReady: true,
        isDesktopLayout: true,
        isTabletLayout: false,
        isCompactLayout: false,
      }),
    ).toBe(true);
  });
});

describe('AppShell global search shortcuts', () => {
  it('owns Cmd/Ctrl+K and "/" and wires both to open the command palette', async () => {
    const { AppShell } = await import('./app-shell');
    capturedShortcuts.length = 0;
    mockOpenPalette.mockClear();

    render(<AppShell>content</AppShell>);

    const cmdK = capturedShortcuts.find((s) => s.key === 'k' && s.metaKey === true);
    const slash = capturedShortcuts.find((s) => s.key === '/');
    expect(cmdK, 'Cmd/Ctrl+K shortcut is registered').toBeTruthy();
    expect(slash, '"/" shortcut is registered (AppShell owns it)').toBeTruthy();
    // "/" must not carry a meta modifier (it is the bare-key global search opener).
    expect(slash?.metaKey ?? false).toBe(false);

    cmdK?.handler();
    expect(mockOpenPalette).toHaveBeenCalledTimes(1);
    slash?.handler();
    expect(mockOpenPalette).toHaveBeenCalledTimes(2);
  });

  it('registers the global Escape shortcut when the palette is closed', async () => {
    paletteState.open = false;
    const { AppShell } = await import('./app-shell');
    capturedShortcuts.length = 0;
    render(<AppShell>content</AppShell>);
    expect(capturedShortcuts.some((s) => s.key === 'Escape')).toBe(true);
  });

  it('does NOT register the global Escape shortcut while the palette is open', async () => {
    // rev2 #2: 開いている間 AppShell が Escape を奪うと、useKeyboardShortcuts の
    // preventDefault/stopPropagation で Dialog の native Escape に届かず閉じられない。
    paletteState.open = true;
    const { AppShell } = await import('./app-shell');
    capturedShortcuts.length = 0;
    render(<AppShell>content</AppShell>);
    expect(capturedShortcuts.some((s) => s.key === 'Escape')).toBe(false);
    // ⌘K / "/" は開いていても所有し続ける(再フォーカス用)。
    expect(capturedShortcuts.some((s) => s.key === 'k' && s.metaKey)).toBe(true);
    paletteState.open = false; // reset for other tests
  });

  it('does NOT register palette shortcuts on a minimal-shell route, and closes a leaked open palette', async () => {
    // rev3 #2: print/capture 等の最小シェルでは CommandPalette を描画しないため、
    // ⌘K/"/" を登録しない(不可視 open を作らない)。進入時に開いていたら closePalette。
    nav.pathname = '/reports/report_1/print'; // shouldUseMinimalShell=true
    paletteState.open = true;
    mockClosePalette.mockClear();
    const { AppShell } = await import('./app-shell');
    capturedShortcuts.length = 0;
    render(<AppShell>content</AppShell>);

    expect(capturedShortcuts.some((s) => s.key === 'k' && s.metaKey)).toBe(false);
    expect(capturedShortcuts.some((s) => s.key === '/')).toBe(false);
    // 最小シェル進入時に開いていたパレットは閉じる。
    expect(mockClosePalette).toHaveBeenCalled();

    nav.pathname = '/dashboard'; // reset
    paletteState.open = false;
  });

  it('exposes keyboard-only skip actions for main, search, and shortcut help', async () => {
    const { AppShell } = await import('./app-shell');
    mockOpenPalette.mockClear();
    mockSetShortcutHelpOpen.mockClear();

    render(<AppShell>content</AppShell>);

    expect(screen.getByRole('navigation', { name: 'キーボード操作' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '検索を開く' }));
    expect(mockOpenPalette).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'キーボード操作を見る' }));
    expect(mockSetShortcutHelpOpen).toHaveBeenCalledWith(true);
  });
});
