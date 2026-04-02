'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, Car, Home, Menu, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui-store';

interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  activePrefixes?: string[];
  excludePrefixes?: string[];
  badge?: number;
}

const bottomNavItems: BottomNavItem[] = [
  { label: 'ホーム', href: '/dashboard', icon: Home },
  {
    label: '本日の訪問',
    href: '/visits',
    icon: Car,
    activePrefixes: ['/visits', '/my-day'],
    excludePrefixes: ['/visits/handoffs'],
  },
  { label: '患者', href: '/patients', icon: Users },
  { label: 'スケジュール', href: '/schedules', icon: Calendar },
];

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function MobileNav() {
  const pathname = usePathname();
  const { setSidebarOpen, toggleSidebar } = useUIStore();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="モバイルナビゲーション"
    >
      <ul className="flex h-16 items-stretch" role="list">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const activePrefixes = item.activePrefixes ?? [item.href];
          const isExcluded =
            item.excludePrefixes?.some((prefix) => matchesPathPrefix(pathname, prefix)) ?? false;
          const isActive =
            !isExcluded &&
            activePrefixes.some((prefix) =>
              prefix === '/dashboard'
                ? pathname === '/dashboard'
                : matchesPathPrefix(pathname, prefix)
            );

          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'relative flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'min-h-[44px]',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.badge != null && item.badge > 0 && (
                    <span
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold text-destructive-foreground"
                      aria-label={`${item.badge}件の未読通知`}
                    >
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}

        {/* Menu button opens sidebar sheet on mobile */}
        <li className="flex flex-1">
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'min-h-[44px]'
            )}
            aria-label="メニューを開く"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            <span>メニュー</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
