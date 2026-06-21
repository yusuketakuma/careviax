'use client';

import { Suspense, useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { AppHeader } from '@/components/layout/app-header';
import { NetworkStatusBanner } from '@/components/layout/network-status-banner';
import { RouteProgress } from '@/components/layout/route-progress';
import { InstallPrompt } from '@/components/features/pwa/install-prompt';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SessionTimeoutModal } from '@/components/auth/session-timeout-modal';
import { MobileOrientationGuard } from '@/components/features/mobile/mobile-orientation-guard';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useUIStore } from '@/lib/stores/ui-store';
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from '@/components/features/keyboard/use-keyboard-shortcuts';
import { ShortcutHelpModal } from '@/components/features/keyboard/shortcut-help-modal';
import { GLOBAL_SHORTCUTS } from '@/components/features/keyboard/global-shortcuts';
import { CommandPalette } from '@/components/features/search/command-palette';
import { useCommandPaletteStore } from '@/lib/stores/command-palette-store';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: React.ReactNode;
}

type ShellViewportState = {
  isReady: boolean;
  isDesktopLayout: boolean;
  isTabletLayout: boolean;
  isCompactLayout: boolean;
};

type QuickCreateTarget = {
  href: string;
  notice?: string;
};

const QUICK_CREATE_TARGET_BY_SEGMENT: Record<string, QuickCreateTarget> = {
  patients: { href: '/patients/new' },
  prescriptions: { href: '/prescriptions/new' },
  referrals: { href: '/referrals/new' },
  reports: {
    href: '/reports',
    notice: '報告書は一覧から対象記録を選択して開始します',
  },
  schedules: {
    href: '/schedules/proposals?workspace=optimizer',
    notice: 'スケジュールは候補作成・週次最適化画面から開始します',
  },
};

export function resolveQuickCreateTarget(pathname: string): QuickCreateTarget {
  const rootSegment = pathname.split('/').filter(Boolean)[0] ?? '';
  return (
    QUICK_CREATE_TARGET_BY_SEGMENT[rootSegment] ?? {
      href: '/patients/new',
      notice: 'この画面には専用の新規作成先がないため、患者新規登録を開きます',
    }
  );
}

/**
 * 末尾セグメント print の帳票印刷ビューと、/visits/[id]/capture(p0_48 モバイル
 * 証跡撮影の没入型画面)は最小シェル(サイドバー・ヘッダーなし)。
 * 例外: /reports/print は p0_47 の帳票・印刷ハブ(画面内に A4 プレビューを持つ
 * 通常ワークフロー画面)のため、フルシェルのまま表示する。
 */
export function shouldUseMinimalShell(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'visits' && segments.length === 3 && segments.at(-1) === 'capture') {
    return true;
  }
  if (pathname === '/reports/print') return false;
  return segments.at(-1) === 'print';
}

/**
 * p0_23 訪問モード Smartphone: /visits/[id]/record はモバイル幅(<md)のみ
 * 没入型(グローバルヘッダ・下部ナビなし。ページ内の専用ヘッダで代替)。
 * ルート単位の最小シェル化はデスクトップ p0_22(3 カラム+サイドバー)への
 * 回帰が大きいため、CSS(max-md:hidden)でモバイル幅のクロームだけ隠す。
 */
export function shouldUseMobileImmersiveShell(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] === 'visits' && segments.length === 3 && segments.at(-1) === 'record';
}

export function deriveShellViewport(target: Pick<Window, 'matchMedia'>): ShellViewportState {
  const isDesktopLayout = target.matchMedia('(min-width: 1280px)').matches;
  const isTabletLayout = target.matchMedia('(min-width: 768px) and (max-width: 1279px)').matches;

  return {
    isReady: true,
    isDesktopLayout,
    isTabletLayout,
    isCompactLayout: !isDesktopLayout,
  };
}

export function resolveSidebarSheetOpen(isCompactViewport: boolean, sidebarOpen: boolean) {
  void isCompactViewport;
  return sidebarOpen;
}

export function shouldRenderCompactSidebarSheet(viewport: ShellViewportState) {
  return viewport.isReady;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const useMinimalShell = shouldUseMinimalShell(pathname);
  // p0_23: 訪問記録入力はモバイル幅のみ没入型(ヘッダ/下部ナビを CSS で隠す)
  const mobileImmersiveShell = shouldUseMobileImmersiveShell(pathname);
  const [viewport, setViewport] = useState<ShellViewportState>({
    isReady: false,
    isDesktopLayout: false,
    isTabletLayout: false,
    isCompactLayout: false,
  });
  const {
    sidebarOpen,
    setSidebarOpen,
    workspaceRailOpen,
    setWorkspaceRailOpen,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    toggleShortcutHelp,
  } = useUIStore();
  const paletteOpen = useCommandPaletteStore((state) => state.open);
  const openPalette = useCommandPaletteStore((state) => state.openPalette);
  const closePalette = useCommandPaletteStore((state) => state.closePalette);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const sidebarSheetOpen = resolveSidebarSheetOpen(viewport.isCompactLayout, sidebarOpen);
  const chromeHidden = useMinimalShell;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const desktopQuery = window.matchMedia('(min-width: 1280px)');
    const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1279px)');
    const syncViewport = () => setViewport(deriveShellViewport(window));

    syncViewport();
    desktopQuery.addEventListener?.('change', syncViewport);
    tabletQuery.addEventListener?.('change', syncViewport);

    return () => {
      desktopQuery.removeEventListener?.('change', syncViewport);
      tabletQuery.removeEventListener?.('change', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!viewport.isReady) return;
    setSidebarOpen(false);
    setWorkspaceRailOpen(false);
  }, [pathname, setSidebarOpen, setWorkspaceRailOpen, viewport.isReady]);

  useEffect(() => {
    if (!sidebarSheetOpen && sidebarWasOpenRef.current) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-testid="app-header-nav-toggle"]')?.focus();
      });
    }
    sidebarWasOpenRef.current = sidebarSheetOpen;
  }, [sidebarSheetOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const main = document.getElementById('main-content');
    if (!main) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (!viewport.isTabletLayout) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!viewport.isTabletLayout || !touchStartRef.current) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
      touchStartRef.current = null;

      if (deltaY > 48) return;

      if (!sidebarOpen && deltaX > 72 && touch.clientX > 120) {
        setSidebarOpen(true);
        return;
      }

      if (sidebarOpen && deltaX < -72) {
        setSidebarOpen(false);
      }
    };

    main.addEventListener('touchstart', handleTouchStart, { passive: true });
    main.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      main.removeEventListener('touchstart', handleTouchStart);
      main.removeEventListener('touchend', handleTouchEnd);
    };
  }, [sidebarOpen, setSidebarOpen, viewport.isTabletLayout]);

  const handleCommandK = useCallback(() => {
    openPalette();
  }, [openPalette]);

  const handleCommandN = useCallback(() => {
    const target = resolveQuickCreateTarget(pathname);

    if (target.notice) {
      toast.info(target.notice);
    }

    setShortcutHelpOpen(false);
    if (target.href !== pathname) {
      router.push(target.href);
    }
  }, [pathname, router, setShortcutHelpOpen]);

  const handleEscape = useCallback(() => {
    if (shortcutHelpOpen) {
      setShortcutHelpOpen(false);
    } else if (workspaceRailOpen) {
      setWorkspaceRailOpen(false);
    } else if (sidebarOpen) {
      setSidebarOpen(false);
    } else {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  }, [
    setShortcutHelpOpen,
    setSidebarOpen,
    setWorkspaceRailOpen,
    shortcutHelpOpen,
    sidebarOpen,
    workspaceRailOpen,
  ]);

  const globalShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      // パレット起動(⌘K / "/")は最小シェル(print/capture 等、CommandPalette 非描画)では登録しない。
      // 登録すると不可視のまま store.open=true になり、通常シェル復帰時に open 状態が漏れる(rev3 #2)。
      ...(useMinimalShell
        ? []
        : [
            {
              key: 'k',
              metaKey: true,
              handler: handleCommandK,
              description: '全体検索',
              scope: 'global' as const,
            },
            {
              // "/" もパレットを開く(唯一の所有者は AppShell)。入力欄では useKeyboardShortcuts が抑止する。
              key: '/',
              handler: handleCommandK,
              description: '全体検索',
              scope: 'global' as const,
            },
          ]),
      {
        key: 'n',
        metaKey: true,
        handler: handleCommandN,
        description: '新規作成',
        scope: 'global' as const,
      },
      {
        key: '?',
        handler: toggleShortcutHelp,
        description: 'ショートカット一覧',
        scope: 'global' as const,
      },
      // パレットが開いている間は Escape を AppShell で登録しない。
      // useKeyboardShortcuts が先に preventDefault/stopPropagation するため、登録したままだと
      // focus が input 外のとき Dialog の native Escape に届かず閉じられなくなる(rev2 #2)。
      ...(paletteOpen
        ? []
        : [
            {
              key: 'Escape',
              handler: handleEscape,
              description: 'モーダルを閉じる',
              scope: 'global' as const,
            },
          ]),
    ],
    [
      handleCommandK,
      handleCommandN,
      toggleShortcutHelp,
      handleEscape,
      paletteOpen,
      useMinimalShell,
    ],
  );

  useKeyboardShortcuts(globalShortcuts);

  // 最小シェルへ遷移したら、もし開いていたパレットを閉じる(不可視 open 状態の漏れ防止, rev3 #2)。
  useEffect(() => {
    if (useMinimalShell && paletteOpen) {
      closePalette();
    }
  }, [useMinimalShell, paletteOpen, closePalette]);

  if (useMinimalShell) {
    return (
      <div className="min-h-screen bg-background" data-testid="app-shell-print-route">
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background print:block print:h-auto print:overflow-visible"
      data-print-container="true"
    >
      {chromeHidden ? null : (
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
      )}
      {/* Navigation drawer. It never reserves layout width; open it from the top bar. */}
      {!chromeHidden && shouldRenderCompactSidebarSheet(viewport) ? (
        <div data-print-skip="true" data-testid="app-sidebar">
          <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarOpen}>
            <SheetContent
              id="app-sidebar-drawer"
              side="left"
              className="w-64 max-w-[86vw] p-0"
              aria-label="ナビゲーション"
              closeLabel="ナビを閉じる"
            >
              <Sidebar className="border-r-0" closeOnNavigate showToggle={false} />
            </SheetContent>
          </Sheet>
        </div>
      ) : null}

      {/* Main content */}
      <main
        className="flex min-w-0 flex-1 flex-col overflow-y-auto print:block print:overflow-visible"
        id="main-content"
        tabIndex={-1}
        data-print-main="true"
        data-testid="app-shell-main"
      >
        {/* Skip to main content link for keyboard users */}
        {chromeHidden ? null : (
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow"
            data-print-skip="true"
          >
            メインコンテンツへスキップ
          </a>
        )}

        {chromeHidden ? null : (
          <div
            data-print-skip="true"
            className={mobileImmersiveShell ? 'max-md:hidden' : undefined}
          >
            <AppHeader />
          </div>
        )}
        {chromeHidden ? null : (
          <div data-print-skip="true">
            <NetworkStatusBanner />
          </div>
        )}
        {chromeHidden ? null : (
          <div data-print-skip="true">
            <MobileOrientationGuard />
          </div>
        )}

        {/* Bottom padding for mobile nav bar */}
        <div
          className={
            chromeHidden
              ? 'flex-1 pb-0'
              : cn(
                  'min-h-0 w-full flex-1 pb-16 md:pb-0 print:pb-0',
                  mobileImmersiveShell && 'max-md:pb-0',
                )
          }
        >
          {children}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      {chromeHidden ? null : (
        <div data-print-skip="true" className={mobileImmersiveShell ? 'max-md:hidden' : undefined}>
          <MobileNav />
        </div>
      )}
      {chromeHidden ? null : (
        <div data-print-skip="true">
          <InstallPrompt />
        </div>
      )}
      {chromeHidden ? null : (
        <div data-print-skip="true">
          <SessionTimeoutModal />
        </div>
      )}

      {/* Keyboard shortcut help modal */}
      {chromeHidden ? null : (
        <div data-print-skip="true">
          <ShortcutHelpModal
            open={shortcutHelpOpen}
            onOpenChange={setShortcutHelpOpen}
            shortcuts={GLOBAL_SHORTCUTS}
          />
        </div>
      )}

      {/* グローバル検索コマンドパレット(⌘K / "/" で開く。AppShell が唯一の描画元) */}
      <div data-print-skip="true">
        <CommandPalette />
      </div>
    </div>
  );
}
