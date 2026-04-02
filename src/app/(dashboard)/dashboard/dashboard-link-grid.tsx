'use client';

import Link from 'next/link';
import { ArrowRight, CircleDashed, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
          <Link key={item.key} href={item.href} className="group">
            <Card className="h-full border-border/70 transition-colors group-hover:border-primary/40 group-hover:bg-muted/30">
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
                  <ArrowRight
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
                <div className="space-y-1">
                  <h3 className={cn('font-semibold text-foreground', compact ? 'text-[0.95rem]' : 'text-sm')}>
                    {item.title}
                  </h3>
                  <p
                    className={cn(
                      'text-muted-foreground',
                      compact ? 'text-[0.82rem] leading-5' : 'text-sm leading-6'
                    )}
                  >
                    {item.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
