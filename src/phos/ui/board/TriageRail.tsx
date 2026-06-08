'use client';

import type { TriageLane } from '@/phos/contracts/phos_contracts';
import { PhosTriageLaneLabel } from '@/phos/contracts/phos_copy.ja';
import type { BoardFilterCounts } from '@/phos/domain/board/boardFilters';
import { TRIAGE_LANE_ORDER } from '@/phos/domain/board/boardFilters';

export type TriageRailProps = {
  activeLane?: TriageLane;
  counts: BoardFilterCounts['triageLanes'];
  onLaneChange(lane?: TriageLane): void;
};

export function TriageRail({ activeLane, counts, onLaneChange }: TriageRailProps) {
  return (
    <aside aria-label="TriageRail" className="space-y-2">
      {TRIAGE_LANE_ORDER.map((lane) => {
        const isActive = activeLane === lane;
        return (
          <button
            key={lane}
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border/70 bg-background px-3 text-left text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-pressed={isActive}
            onClick={() => onLaneChange(isActive ? undefined : lane)}
          >
            <span>{PhosTriageLaneLabel[lane]}</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {counts[lane]}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
