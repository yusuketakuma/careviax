'use client';

import { ArrowUpDown } from 'lucide-react';
import { BoardSortKey } from '@/phos/contracts/phos_contracts';
import { PhosBoardCopy, PhosBoardSortLabel } from '@/phos/contracts/phos_copy.ja';
import { BOARD_SORT_ORDER } from '@/phos/domain/board/boardFilters';

export type SortSelectProps = {
  sortKey: BoardSortKey;
  onSortChange(sortKey: BoardSortKey): void;
};

export function SortSelect({ sortKey, onSortChange }: SortSelectProps) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground focus-within:ring-3 focus-within:ring-ring/50">
      <ArrowUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{PhosBoardCopy.SORT_LABEL}</span>
      <select
        value={sortKey}
        className="bg-transparent text-sm outline-none"
        onChange={(event) => onSortChange(event.currentTarget.value as BoardSortKey)}
      >
        {BOARD_SORT_ORDER.map((key) => (
          <option key={key} value={key}>
            {PhosBoardSortLabel[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
