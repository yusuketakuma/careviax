'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  UserCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { Button } from '@/components/ui/button';
import {
  SIDEBAR_ADMIN_NAV_GROUPS,
  SIDEBAR_MAIN_NAV_GROUPS,
  SIDEBAR_WORKBENCH_NAV_ITEMS,
  type LayoutNavGroup,
  type LayoutNavItem,
} from './navigation-config';
import { isLayoutNavItemActive } from './navigation-utils';

interface SidebarNavItemProps {
  item: LayoutNavItem;
  collapsed: boolean;
  closeOnNavigate?: boolean;
}

function SidebarNavItem({ item, collapsed, closeOnNavigate = false }: SidebarNavItemProps) {
  const pathname = usePathname();
  const { sidebarPinned, setSidebarOpen } = useUIStore();
  const isActive = isLayoutNavItemActive(pathname, item);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={() => {
        if (closeOnNavigate || !sidebarPinned) setSidebarOpen(false);
      }}
      data-testid={
        item.href === '/dashboard'
          ? 'sidebar-nav-home'
          : item.href === '/patients'
            ? 'sidebar-nav-patients'
            : undefined
      }
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
        collapsed && 'justify-center px-2',
      )}
      aria-current={isActive ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function SidebarAdminGroup({
  group,
  collapsed,
  closeOnNavigate = false,
}: {
  group: LayoutNavGroup;
  collapsed: boolean;
  closeOnNavigate?: boolean;
}) {
  const pathname = usePathname();
  const hasActiveChild = group.items.some((item) => {
    return isLayoutNavItemActive(pathname, item);
  });
  const [open, setOpen] = useState(hasActiveChild);

  if (collapsed) {
    return (
      <>
        {group.items.map((item) => (
          <li key={item.href}>
            <SidebarNavItem item={item} collapsed closeOnNavigate={closeOnNavigate} />
          </li>
        ))}
      </>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full min-h-[32px] items-center gap-2 rounded-md px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          hasActiveChild && 'text-foreground',
        )}
        aria-expanded={open}
      >
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform', !open && '-rotate-90')}
          aria-hidden="true"
        />
        <span>{group.label}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 pl-2" role="list">
          {group.items.map((item) => (
            <li key={item.href}>
              <SidebarNavItem item={item} collapsed={false} closeOnNavigate={closeOnNavigate} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface SidebarProps {
  className?: string;
  closeOnNavigate?: boolean;
}

export function Sidebar({ className, closeOnNavigate = false }: SidebarProps) {
  const { sidebarOpen, sidebarPinned, toggleSidebar, toggleSidebarPinned } = useUIStore();

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-sidebar transition-all duration-200',
        sidebarOpen ? 'w-48 xl:w-56' : 'w-16',
        className,
      )}
      aria-label="メインナビゲーション"
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-border px-3',
          sidebarOpen ? 'justify-between' : 'justify-center',
        )}
      >
        {sidebarOpen && (
          <Link
            href="/dashboard"
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-base font-bold tracking-tight text-primary">PH-OS</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="min-h-[44px] min-w-[44px] shrink-0 sm:h-8 sm:min-h-0 sm:w-8 sm:min-w-0"
          aria-label={sidebarOpen ? 'サイドバーを折りたたむ' : 'サイドバーを展開する'}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebarPinned}
          className={cn('w-full justify-start gap-2', !sidebarOpen && 'justify-center px-2')}
          aria-label={sidebarPinned ? 'サイドバー固定を解除' : 'サイドバーを固定'}
          title={!sidebarOpen ? (sidebarPinned ? '固定中' : '固定する') : undefined}
        >
          {sidebarPinned ? (
            <Pin className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PinOff className="h-4 w-4" aria-hidden="true" />
          )}
          {sidebarOpen && <span>{sidebarPinned ? '固定中' : '固定する'}</span>}
        </Button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="ワークフローナビ">
        {SIDEBAR_MAIN_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label}>
            {groupIndex > 0 && <div className="my-2 border-t border-border/50" />}
            {sidebarOpen && (
              <p className="mb-0.5 px-3 pt-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
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
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="my-2 border-t border-border" />

        {sidebarOpen && (
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            ワークベンチ
          </p>
        )}
        <ul className="space-y-0.5" role="list">
          {SIDEBAR_WORKBENCH_NAV_ITEMS.map((item) => (
            <li key={`workbench-${item.label}-${item.href}`}>
              <SidebarNavItem
                item={item}
                collapsed={!sidebarOpen}
                closeOnNavigate={closeOnNavigate}
              />
            </li>
          ))}
        </ul>

        <div className="my-2 border-t border-border" />

        {sidebarOpen && (
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            管理
          </p>
        )}
        <ul className="space-y-0.5" role="list">
          {SIDEBAR_ADMIN_NAV_GROUPS.map((group) => (
            <SidebarAdminGroup
              key={group.label}
              group={group}
              collapsed={!sidebarOpen}
              closeOnNavigate={closeOnNavigate}
            />
          ))}
        </ul>
      </nav>

      {/* User settings & logout */}
      <div className="shrink-0 border-t border-border p-2">
        <Link
          href="/settings"
          className={cn(
            'flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !sidebarOpen && 'justify-center px-2',
          )}
          title={!sidebarOpen ? '設定' : undefined}
        >
          <UserCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          {sidebarOpen && <span>設定</span>}
        </Link>
        <button
          type="button"
          className={cn(
            'flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
