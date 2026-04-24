'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/breadcrumb';
import { NotificationBell } from '@/components/features/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { labelForSegment } from '@/lib/navigation/route-labels';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';
import { TOP_WORKFLOW_LINKS } from './navigation-config';
import { isTopWorkflowLinkActive } from './navigation-utils';

export function AppHeader() {
  const pathname = usePathname();
  const { setSidebarOpen } = useUIStore();

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [];

    segments.forEach((segment, index) => {
      if (index === 0 && segment === 'dashboard') return;
      const href =
        index < segments.length - 1 ? `/${segments.slice(0, index + 1).join('/')}` : undefined;

      items.push({
        label: labelForSegment(segment, segments[index - 1]),
        href,
      });
    });

    return items;
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="メニューを開く"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>
          <Breadcrumb items={breadcrumbs} />
        </div>
        <nav className="hidden shrink-0 items-center gap-1 md:flex" aria-label="トップ業務メニュー">
          {TOP_WORKFLOW_LINKS.map((item) => {
            const isActive = isTopWorkflowLinkActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
