import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type FilterSummaryItem = {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
};

type FilterSummaryBarProps = {
  items: FilterSummaryItem[];
  className?: string;
  actions?: ReactNode;
};

export function FilterSummaryBar({ items, className, actions }: FilterSummaryBarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <Badge
            key={item.label}
            variant={item.tone === 'danger' ? 'destructive' : 'outline'}
            className={cn(item.tone === 'warning' && 'border-state-confirm/40 text-state-confirm')}
          >
            {item.label} {item.value}
          </Badge>
        ))}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
