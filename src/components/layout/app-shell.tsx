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
    href: '/schedules#planner',
    notice: 'スケジュールは一覧画面の新規予定エリアを開きます',
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
  return isCompactViewport && sidebarOpen;
}

export function shouldRenderCompactSidebarSheet(viewport: ShellViewportState) {
  return viewport.isReady && viewport.isCompactLayout;
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
    sidebarPinned,
    setSidebarOpen,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    toggleShortcutHelp,
  } = useUIStore();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const mobileSidebarOpen = resolveSidebarSheetOpen(viewport.isCompactLayout, sidebarOpen);
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
    setSidebarOpen(viewport.isDesktopLayout && sidebarPinned);
  }, [viewport.isDesktopLayout, viewport.isReady, sidebarPinned, setSidebarOpen]);

  useEffect(() => {
    if (!viewport.isReady || !viewport.isCompactLayout) return;
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen, viewport.isCompactLayout, viewport.isReady]);

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
    router.push('/search');
  }, [router]);

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
    } else {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  }, [shortcutHelpOpen, setShortcutHelpOpen]);

  const globalShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      {
        key: 'k',
        metaKey: true,
        handler: handleCommandK,
        description: '全体検索',
        scope: 'global' as const,
      },
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
      {
        key: 'Escape',
        handler: handleEscape,
        description: 'モーダルを閉じる',
        scope: 'global' as const,
      },
    ],
    [handleCommandK, handleCommandN, toggleShortcutHelp, handleEscape],
  );

  useKeyboardShortcuts(globalShortcuts);

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
      className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible"
      data-print-container="true"
    >
      {chromeHidden ? null : (
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
      )}
      {/* Desktop sidebar — always visible on xl+ */}
      {chromeHidden ? null : (
        <div
          className="hidden xl:flex xl:shrink-0"
          data-print-skip="true"
          data-testid="app-sidebar"
        >
          <Sidebar />
        </div>
      )}

      {/* Tablet/mobile sidebar — Sheet overlay */}
      {!chromeHidden && shouldRenderCompactSidebarSheet(viewport) ? (
        <div className="xl:hidden" data-print-skip="true">
          <Sheet open={mobileSidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-48 p-0">
              <Sidebar className="border-r-0" closeOnNavigate />
            </SheetContent>
          </Sheet>
        </div>
      ) : null}

      {/* Main content */}
      <main
        className="flex flex-1 flex-col overflow-y-auto print:block print:overflow-visible"
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
              : cn('flex-1 pb-16 md:pb-0 print:pb-0', mobileImmersiveShell && 'max-md:pb-0')
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
    </div>
  );
}
