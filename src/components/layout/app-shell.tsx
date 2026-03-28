'use client';

import { Suspense, useEffect, useRef, useMemo, useCallback } from 'react';
import { AppHeader } from '@/components/layout/app-header';
import { GlobalSearchModal } from '@/components/layout/global-search-modal';
import { NetworkStatusBanner } from '@/components/layout/network-status-banner';
import { RouteProgress } from '@/components/layout/route-progress';
import { InstallPrompt } from '@/components/features/pwa/install-prompt';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SessionTimeoutModal } from '@/components/auth/session-timeout-modal';
import { MobileOrientationGuard } from '@/components/features/mobile/mobile-orientation-guard';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useUIStore } from '@/lib/stores/ui-store';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';
import { ShortcutHelpModal } from '@/components/features/keyboard/shortcut-help-modal';
import { GLOBAL_SHORTCUTS } from '@/components/features/keyboard/global-shortcuts';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface AppShellProps {
  children: React.ReactNode;
}

const NEW_ROUTE_BY_SEGMENT: Record<string, string> = {
  patients: '/patients/new',
  prescriptions: '/prescriptions/new',
  referrals: '/referrals/new',
  reports: '/reports/new',
  schedules: '/schedules/new',
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    sidebarOpen,
    sidebarPinned,
    setSidebarOpen,
    globalSearchOpen,
    setGlobalSearchOpen,
    shortcutHelpOpen,
    setShortcutHelpOpen,
    toggleShortcutHelp,
  } = useUIStore();
  const initializedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (initializedRef.current || typeof window === 'undefined') return;
    initializedRef.current = true;

    const isTabletLayout = window.matchMedia('(min-width: 768px) and (max-width: 1279px)').matches;
    const isDesktopLayout = window.matchMedia('(min-width: 1280px)').matches;
    setSidebarOpen(isDesktopLayout && !isTabletLayout && sidebarPinned);
  }, [setSidebarOpen, sidebarPinned]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const main = document.getElementById('main-content');
    if (!main) return;

    const isTabletLayout = () =>
      window.matchMedia('(min-width: 768px) and (max-width: 1279px)').matches;

    const handleTouchStart = (event: TouchEvent) => {
      if (!isTabletLayout()) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!isTabletLayout() || !touchStartRef.current) return;

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
  }, [sidebarOpen, setSidebarOpen]);

  const handleCommandK = useCallback(() => {
    setGlobalSearchOpen(true);
  }, [setGlobalSearchOpen]);

  const handleCommandN = useCallback(() => {
    const rootSegment = pathname.split('/').filter(Boolean)[0] ?? '';
    const target = NEW_ROUTE_BY_SEGMENT[rootSegment] ?? '/patients/new';

    if (!NEW_ROUTE_BY_SEGMENT[rootSegment]) {
      toast.info('この画面には専用の新規作成先がないため、患者新規登録を開きます');
    }

    setGlobalSearchOpen(false);
    setShortcutHelpOpen(false);
    if (target !== pathname) {
      router.push(target);
    }
  }, [pathname, router, setGlobalSearchOpen, setShortcutHelpOpen]);

  const handleEscape = useCallback(() => {
    if (globalSearchOpen) {
      setGlobalSearchOpen(false);
    } else if (shortcutHelpOpen) {
      setShortcutHelpOpen(false);
    } else {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  }, [globalSearchOpen, setGlobalSearchOpen, shortcutHelpOpen, setShortcutHelpOpen]);

  const globalShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'k', metaKey: true, handler: handleCommandK, description: 'グローバル検索', scope: 'global' as const },
      { key: 'n', metaKey: true, handler: handleCommandN, description: '新規作成', scope: 'global' as const },
      { key: '?', handler: toggleShortcutHelp, description: 'ショートカット一覧', scope: 'global' as const },
      { key: 'Escape', handler: handleEscape, description: 'モーダルを閉じる', scope: 'global' as const },
    ],
    [handleCommandK, handleCommandN, toggleShortcutHelp, handleEscape],
  );

  useKeyboardShortcuts(globalShortcuts);

  return (
    <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto print:overflow-visible" data-print-container="true">
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      {/* Desktop sidebar — always visible on xl+ */}
      <div className="hidden xl:flex xl:shrink-0" data-print-skip="true">
        <Sidebar />
      </div>

      {/* Tablet/mobile sidebar — Sheet overlay */}
      <div className="xl:hidden" data-print-skip="true">
        <Sheet
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
        >
          <SheetContent side="left" className="w-56 p-0">
            <Sidebar className="border-r-0" />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <main
        className="flex flex-1 flex-col overflow-y-auto print:block print:overflow-visible"
        id="main-content"
        tabIndex={-1}
        data-print-main="true"
      >
        {/* Skip to main content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow"
          data-print-skip="true"
        >
          メインコンテンツへスキップ
        </a>

        <div data-print-skip="true">
          <AppHeader />
        </div>
        <div data-print-skip="true">
          <NetworkStatusBanner />
        </div>
        <div data-print-skip="true">
          <MobileOrientationGuard />
        </div>

        {/* Bottom padding for mobile nav bar */}
        <div className="flex-1 pb-16 md:pb-0 print:pb-0">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <div data-print-skip="true">
        <MobileNav />
      </div>
      <div data-print-skip="true">
        <InstallPrompt />
      </div>
      <div data-print-skip="true">
        <SessionTimeoutModal />
      </div>

      {/* Keyboard shortcut help modal */}
      <div data-print-skip="true">
        <ShortcutHelpModal
          open={shortcutHelpOpen}
          onOpenChange={setShortcutHelpOpen}
          shortcuts={GLOBAL_SHORTCUTS}
        />
      </div>
      <div data-print-skip="true">
        <GlobalSearchModal
          open={globalSearchOpen}
          onOpenChange={setGlobalSearchOpen}
          pathname={pathname}
        />
      </div>
    </div>
  );
}
