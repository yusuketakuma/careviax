'use client';

import type {
  ActionCode,
  ActionReasonInput,
  BoardQuickFilter,
  BoardSortKey,
  CapacityResponse,
  CardBoardItemView,
  TriageLane,
} from '@/phos/contracts/phos_contracts';
import { BoardDensity } from '@/phos/contracts/phos_contracts';
import { cn } from '@/lib/utils';
import {
  PhosBoardCopy,
  PhosBoardDensityLabel,
  PhosEmptyState,
} from '@/phos/contracts/phos_copy.ja';
import type { BoardFilterCounts } from '@/phos/domain/board/boardFilters';
import { CardTile } from './CardTile';
import { CapacityBar } from './CapacityBar';
import { QuickFilterBar } from './QuickFilterBar';
import { SearchBox } from './SearchBox';
import { SortSelect } from './SortSelect';
import { TriageRail } from './TriageRail';

export type CardBoardProps = {
  items: CardBoardItemView[];
  totalItemCount: number;
  phase?: 'LOADING' | 'READY';
  selectedCardId?: string;
  density: BoardDensity;
  searchQuery: string;
  sortKey: BoardSortKey;
  quickFilter: BoardQuickFilter;
  triageLane?: TriageLane;
  counts: BoardFilterCounts;
  capacity?: CapacityResponse;
  capacityPhase?: 'IDLE' | 'LOADING' | 'ERROR';
  capacityError?: string;
  onSearchQueryChange(query: string): void;
  onSortChange(sortKey: BoardSortKey): void;
  onDensityChange(density: BoardDensity): void;
  onQuickFilterChange(filter: BoardQuickFilter): void;
  onTriageLaneChange(lane?: TriageLane): void;
  onResetFilters(): void;
  onOpen(cardId: string): void;
  onPrimaryAction(cardId: string, action: ActionCode, reason?: ActionReasonInput): void;
};

export function CardBoard({
  items,
  totalItemCount,
  phase = 'READY',
  selectedCardId,
  density,
  searchQuery,
  sortKey,
  quickFilter,
  triageLane,
  counts,
  capacity,
  capacityPhase = 'IDLE',
  capacityError,
  onSearchQueryChange,
  onSortChange,
  onDensityChange,
  onQuickFilterChange,
  onTriageLaneChange,
  onResetFilters,
  onOpen,
  onPrimaryAction,
}: CardBoardProps) {
  const hasFilterResult = items.length > 0;
  const hasAnyItems = totalItemCount > 0;
  const isLoading = phase === 'LOADING';
  const isCompact = density === BoardDensity.COMPACT;

  return (
    <section
      aria-labelledby="phos-card-board-title"
      className="overflow-hidden rounded-lg border border-border/70 bg-card"
      data-phos-board-root="true"
      tabIndex={-1}
    >
      <div className="border-b border-border/70 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="phos-card-board-title" className="text-lg font-semibold text-foreground">
              PH-OS
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">本日の対応カード</p>
          </div>
          <p className="rounded-md border border-border/70 bg-muted/35 px-2.5 py-1 text-sm text-muted-foreground">
            {items.length} / {totalItemCount}件
          </p>
        </div>
        <div className="mt-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <SearchBox query={searchQuery} onQueryChange={onSearchQueryChange} />
            <SortSelect sortKey={sortKey} onSortChange={onSortChange} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {PhosBoardCopy.DENSITY_LABEL}
            </span>
            {Object.values(BoardDensity).map((nextDensity) => (
              <button
                key={nextDensity}
                type="button"
                className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
                aria-pressed={density === nextDensity}
                onClick={() => onDensityChange(nextDensity)}
              >
                {PhosBoardDensityLabel[nextDensity]}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <QuickFilterBar
              activeFilter={quickFilter}
              counts={counts.quickFilters}
              onFilterChange={onQuickFilterChange}
            />
          </div>
        </div>
        {capacity || capacityPhase !== 'IDLE' ? (
          <div className="mt-4">
            <CapacityBar capacity={capacity} phase={capacityPhase} errorMessage={capacityError} />
          </div>
        ) : null}
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <TriageRail
            activeLane={triageLane}
            counts={counts.triageLanes}
            onLaneChange={onTriageLaneChange}
          />

          <div>
            {isLoading ? (
              <div
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5"
                aria-label="カード読み込み中"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="min-h-[120px] animate-pulse rounded-lg border border-border/70 bg-muted/35"
                  />
                ))}
              </div>
            ) : !hasAnyItems ? (
              <div className="rounded-md border border-dashed border-border/70 bg-background p-6 text-sm text-muted-foreground">
                {PhosEmptyState.EMPTY_TODAY_NONE}
              </div>
            ) : !hasFilterResult ? (
              <div className="rounded-md border border-dashed border-border/70 bg-background p-6">
                <h3 className="text-base font-semibold text-foreground">
                  {PhosEmptyState.CARD_EMPTY_TITLE}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {PhosEmptyState.CARD_EMPTY_BODY}
                </p>
                <button
                  type="button"
                  className="mt-4 min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => onResetFilters()}
                >
                  {PhosBoardCopy.RESET_FILTERS}
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  'grid gap-3 sm:grid-cols-2',
                  isCompact ? 'xl:grid-cols-5 2xl:grid-cols-6' : 'xl:grid-cols-4 2xl:grid-cols-5',
                )}
              >
                {items.map((item) => (
                  <CardTile
                    key={item.card.card_id}
                    card={item.card}
                    next_action={item.next_action}
                    blocker_summary={item.card.blocker_summary}
                    tags={item.card.tags}
                    density={density}
                    selected={item.card.card_id === selectedCardId}
                    onOpen={onOpen}
                    onPrimaryAction={onPrimaryAction}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
