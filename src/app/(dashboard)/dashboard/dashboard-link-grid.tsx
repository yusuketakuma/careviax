'use client';

import Link from 'next/link';
import { ArrowRight, CircleDashed, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { HelpPopover } from '@/components/ui/help-popover';
import { cn } from '@/lib/utils';

type DashboardLinkGridItem = {
  key: string;
  title: string;
  description: string;
  href: string;
};

type DashboardLinkGridProps = {
  links: readonly DashboardLinkGridItem[];
  iconMap: Record<string, LucideIcon>;
  compact?: boolean;
  className?: string;
  dataTestId?: string;
};

export function DashboardLinkGrid({
  links,
  iconMap,
  compact = false,
  className,
  dataTestId,
}: DashboardLinkGridProps) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'grid gap-3 md:grid-cols-2',
        compact ? 'xl:grid-cols-2' : 'xl:grid-cols-4',
        className
      )}
    >
      {links.map((item) => {
        const Icon = iconMap[item.key] ?? CircleDashed;

        return (
          <Card
            key={item.key}
            className="h-full border-border/70 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <CardContent
              className={cn(
                'flex h-full flex-col',
                compact ? 'gap-2.5 p-3.5' : 'gap-3 p-4'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={cn(
                    'inline-flex items-center justify-center rounded-lg bg-primary/10 text-primary',
                    compact ? 'size-9' : 'size-10'
                  )}
                >
                  <Icon className={cn(compact ? 'size-[1.125rem]' : 'size-5')} aria-hidden="true" />
                </div>
                <HelpPopover title={item.title} description={item.description} />
              </div>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06]"
                aria-label={`${item.title}を開く`}
              >
                <h3
                  className={cn(
                    'font-semibold text-foreground',
                    compact ? 'text-[0.95rem]' : 'text-sm'
                  )}
                >
                  {item.title}
                </h3>
                <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
