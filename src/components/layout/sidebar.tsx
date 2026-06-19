'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useUIStore, type WorkMode } from '@/lib/stores/ui-store';
import { Button } from '@/components/ui/button';
import { SIDEBAR_MAIN_NAV_GROUPS, type LayoutNavItem } from './navigation-config';
import { isLayoutNavItemActive } from './navigation-utils';
import { useNavBadges } from './use-nav-badges';

const WORK_MODE_LABELS: Record<WorkMode, string> = {
  pharmacist: '薬剤師モード',
  clerk_support: '事務サポートモード',
  management: '管理モード',
};

interface SidebarNavItemProps {
  item: LayoutNavItem;
  collapsed: boolean;
  closeOnNavigate?: boolean;
  badgeCount?: number;
}

function getSidebarNavTestId(href: string) {
  if (href === '/dashboard') return 'sidebar-nav-home';
  const slug = href.replace(/^\//, '').replace(/\//g, '-');
  return slug ? `sidebar-nav-${slug}` : undefined;
}

function SidebarNavItem({
  item,
  collapsed,
  closeOnNavigate = false,
  badgeCount,
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const { sidebarPinned, setSidebarOpen } = useUIStore();
  const isActive = isLayoutNavItemActive(pathname, item);
  const Icon = item.icon;
  // 現在地の項目はバッジを出さない(新デザイン 02/08 の挙動)
  const showBadge = !collapsed && !isActive && typeof badgeCount === 'number' && badgeCount > 0;

  return (
    <Link
      href={item.href}
      onClick={() => {
        if (closeOnNavigate || !sidebarPinned) setSidebarOpen(false);
      }}
      data-testid={getSidebarNavTestId(item.href)}
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        isActive
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        collapsed && 'justify-center px-2',
      )}
      aria-current={isActive ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {showBadge && (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none text-white',
            item.badgeTone === 'caution' ? 'bg-state-confirm' : 'bg-state-blocked',
          )}
          data-testid={`sidebar-nav-badge-${item.href.replace(/\//g, '-')}`}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  );
}

interface SidebarProps {
  className?: string;
  closeOnNavigate?: boolean;
  showToggle?: boolean;
}

export function Sidebar({ className, closeOnNavigate = false, showToggle = true }: SidebarProps) {
  const { sidebarOpen, toggleSidebar, workMode, sidebarPinned, setSidebarOpen } = useUIStore();
  const currentUserName = useAuthStore((state) => state.currentUser?.name ?? null);
  const currentUserRole = useAuthStore((state) => state.currentUser?.role ?? null);
  const navBadges = useNavBadges();
  const handleLogout = () => {
    if (closeOnNavigate || !sidebarPinned) setSidebarOpen(false);
    void signOut({ callbackUrl: '/login' });
  };

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200',
        sidebarOpen ? 'w-48 xl:w-56' : 'w-16',
        className,
      )}
      aria-label="メインナビゲーション"
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-sidebar-border px-3',
          sidebarOpen ? 'justify-between' : 'justify-center',
        )}
      >
        {sidebarOpen && (
          <Link
            href="/dashboard"
            className="flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <span className="text-base font-bold tracking-tight text-sidebar-foreground">
              PH-OS
            </span>
            <span className="text-[10px] leading-tight text-sidebar-foreground/55">
              在宅薬局オペレーション
            </span>
          </Link>
        )}
        {showToggle ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="min-h-[44px] min-w-[44px] shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground sm:h-8 sm:min-h-0 sm:w-8 sm:min-w-0"
            aria-label={sidebarOpen ? 'サイドバーを折りたたむ' : 'サイドバーを展開する'}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>

      {/* Main nav: design/images/new のグループ構成(今日/患者/工程/連携/管理) */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="ワークフローナビ">
        {SIDEBAR_MAIN_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label || `group-${groupIndex}`}>
            {groupIndex > 0 && <div className="my-2 border-t border-sidebar-border/60" />}
            {sidebarOpen && group.label && (
              <p className="mb-0.5 px-3 pt-2 text-[11px] font-medium tracking-wider text-sidebar-foreground/50">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5" role="list">
              {group.items.map((item) => (
                <li key={`${group.label}-${item.label}-${item.href}`}>
                  <SidebarNavItem
                    item={item}
                    collapsed={!sidebarOpen}
                    closeOnNavigate={closeOnNavigate}
                    badgeCount={item.badge ?? navBadges[item.href]}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Current user & logout */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        {sidebarOpen && currentUserName ? (
          <div className="flex items-center gap-3 px-3 py-2" data-testid="sidebar-current-user">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-foreground"
              aria-hidden="true"
            >
              {currentUserName.charAt(0)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {currentUserName}
              </span>
              {currentUserRole ? (
                <span
                  className="block text-[11px] text-sidebar-foreground/55"
                  data-testid="sidebar-current-user-role"
                >
                  {memberRoleLabel(currentUserRole)}
                </span>
              ) : null}
              {workMode ? (
                <Link
                  href="/select-mode"
                  onClick={() => {
                    if (closeOnNavigate || !sidebarPinned) setSidebarOpen(false);
                  }}
                  className="block text-[10px] text-sidebar-foreground/45 underline-offset-2 hover:text-sidebar-foreground/70 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  data-testid="sidebar-current-user-mode"
                >
                  {WORK_MODE_LABELS[workMode]}
                </Link>
              ) : null}
            </span>
          </div>
        ) : null}
        {sidebarOpen ? (
          <Link
            href="/select-site"
            onClick={() => {
              if (closeOnNavigate || !sidebarPinned) setSidebarOpen(false);
            }}
            className="mb-1 block rounded-md px-3 py-1 text-[11px] text-sidebar-foreground/55 underline-offset-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            data-testid="sidebar-select-site-link"
          >
            薬局を切り替える
          </Link>
        ) : null}
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            !sidebarOpen && 'justify-center px-2',
          )}
          aria-label="ログアウト"
          title={!sidebarOpen ? 'ログアウト' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {sidebarOpen && <span>ログアウト</span>}
        </button>
      </div>
    </aside>
  );
}
