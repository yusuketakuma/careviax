'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, CircleHelp, CloudOff, Menu, Search } from 'lucide-react';
import { NotificationBell } from '@/components/features/notifications/notification-bell';
import {
  useKeyboardShortcuts,
  type ShortcutDefinition,
} from '@/components/features/keyboard/use-keyboard-shortcuts';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useOfflineStore } from '@/lib/stores/offline-store';
import { useUIStore, type CareMode } from '@/lib/stores/ui-store';

const CARE_MODE_LABELS: Record<string, string> = {
  home_visit: '在宅モード',
  outpatient: '外来モード',
};

const CARE_MODE_OPTIONS: { value: CareMode; label: string }[] = [
  { value: 'home_visit', label: '在宅モード' },
  { value: 'outpatient', label: '外来モード' },
];

export function formatSyncTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const emptySubscribe = () => () => {};

/** SSR とのハイドレーション不一致を避けるためのマウント判定。 */
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** 「同期済み HH:MM」(緑) / オフライン時は「オフライン」(橙)。 */
function HeaderSyncStatus() {
  const online = useNetworkOnline();
  const lastSyncedAt = useOfflineStore((state) => state.lastSyncedAt);
  const hydrated = useHydrated();

  if (!hydrated) return null;

  if (!online) {
    return (
      <span
        className="hidden shrink-0 items-center gap-1 text-xs font-medium text-amber-600 sm:flex"
        data-testid="app-header-sync-status"
      >
        <CloudOff className="size-3.5" aria-hidden="true" />
        オフライン
      </span>
    );
  }

  const syncTime = formatSyncTime(lastSyncedAt);

  return (
    <span
      className="hidden shrink-0 text-xs font-medium text-emerald-600 sm:inline"
      data-testid="app-header-sync-status"
    >
      同期済み{syncTime ? ` ${syncTime}` : ''}
    </span>
  );
}

export function AppHeader() {
  const router = useRouter();
  const orgId = useOrgId();
  const { setSidebarOpen, careMode, setCareMode } = useUIStore();
  const currentUserName = useAuthStore((state) => state.currentUser.name);
  const modeLabel = CARE_MODE_LABELS[careMode] ?? CARE_MODE_LABELS.home_visit;

  const handleCareModeSelect = useCallback(
    (mode: CareMode) => {
      setCareMode(mode);
      // fire-and-forget: サーバー側設定の保存失敗で UI を止めない
      void fetch('/api/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(orgId ? { 'x-org-id': orgId } : {}),
        },
        body: JSON.stringify({ care_mode: mode }),
      })
        .then((res) => {
          if (!res.ok) console.warn(`care_mode の保存に失敗しました (HTTP ${res.status})`);
        })
        .catch((err) => {
          console.warn('care_mode の保存に失敗しました', err);
        });
    },
    [orgId, setCareMode],
  );

  const goToSearch = useCallback(() => {
    router.push('/search');
  }, [router]);

  // "/" でグローバル検索へ(入力中フィールドでは useKeyboardShortcuts 側で抑止される)
  const searchShortcuts = useMemo<ShortcutDefinition[]>(
    () => [{ key: '/', handler: goToSearch, description: '検索へ移動', scope: 'global' }],
    [goToSearch],
  );
  useKeyboardShortcuts(searchShortcuts);

  return (
    <header
      className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur"
      data-testid="app-header"
    >
      <div className="flex min-h-14 items-center gap-3 px-4 md:px-6">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="min-h-[44px] min-w-[44px] shrink-0 xl:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="メニューを開く"
        >
          <Menu className="size-4" aria-hidden="true" />
        </Button>

        {/* モード切替ドロップダウン */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground sm:inline">モード:</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="app-header-mode-trigger"
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] gap-1.5 rounded-md bg-background px-3 text-sm font-medium sm:min-h-9"
                />
              }
            >
              {modeLabel}
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {CARE_MODE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => handleCareModeSelect(option.value)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 常設検索ボックス(md 以上)。クリックで /search へ */}
        <button
          type="button"
          onClick={goToSearch}
          className="hidden min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          data-testid="app-header-search"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">患者・カード・薬剤を検索</span>
          <kbd
            className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            aria-hidden="true"
          >
            /
          </kbd>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-4">
          {/* md 未満は検索アイコンに縮退 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] md:hidden"
            onClick={goToSearch}
            aria-label="検索"
            data-testid="app-header-search-compact"
          >
            <Search className="size-4" aria-hidden="true" />
          </Button>
          <HeaderSyncStatus />
          <NotificationBell />
          <Button
            asChild
            variant="ghost"
            className="min-h-[44px] px-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-9"
          >
            <Link href="/settings" aria-label="ヘルプ">
              <CircleHelp className="size-4 md:hidden" aria-hidden="true" />
              <span className="hidden md:inline">ヘルプ</span>
            </Link>
          </Button>
          {currentUserName ? (
            <span className="hidden min-w-0 flex-col items-start lg:flex">
              <span
                className="max-w-32 truncate text-sm font-semibold text-foreground"
                data-testid="app-header-user-name"
              >
                {currentUserName}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">薬剤師</span>
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
