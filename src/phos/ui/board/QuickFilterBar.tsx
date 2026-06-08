'use client';

import { BoardQuickFilter } from '@/phos/contracts/phos_contracts';
import { PhosBoardQuickFilterLabel } from '@/phos/contracts/phos_copy.ja';
import type { BoardFilterCounts } from '@/phos/domain/board/boardFilters';
import { BOARD_QUICK_FILTER_ORDER } from '@/phos/domain/board/boardFilters';

export type QuickFilterBarProps = {
  activeFilter: BoardQuickFilter;
  counts: BoardFilterCounts['quickFilters'];
  onFilterChange(filter: BoardQuickFilter): void;
};

export function QuickFilterBar({ activeFilter, counts, onFilterChange }: QuickFilterBarProps) {
  return (
    <nav aria-label="QuickFilters" className="flex flex-wrap gap-2">
      {BOARD_QUICK_FILTER_ORDER.map((filter) => {
        const isActive = activeFilter === filter;
        return (
          <button
            key={filter}
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-pressed={isActive}
            onClick={() => onFilterChange(filter)}
          >
            <span>{PhosBoardQuickFilterLabel[filter]}</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {counts[filter]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
