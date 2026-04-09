'use client';

import { useState } from 'react';

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function sameOrder(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function moveRouteItem(ids: string[], itemId: string, direction: 'up' | 'down') {
  const index = ids.indexOf(itemId);
  if (index === -1) return ids;
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next;
}

export function countRouteOrderDiff(currentIds: string[], nextIds: string[]) {
  const currentIndexById = new Map(currentIds.map((id, index) => [id, index]));
  return nextIds.filter((id, index) => currentIndexById.get(id) !== index).length;
}

export function useRouteOrderDraft(args: {
  sourceKey: string;
  optimizedIds: string[];
  currentIds?: string[];
}) {
  const optimizedIds = uniqueIds(args.optimizedIds);
  const currentIds = uniqueIds(args.currentIds ?? args.optimizedIds);
  const [draftState, setDraftState] = useState<{ key: string; ids: string[] } | null>(null);

  const draftIds = draftState?.key === args.sourceKey ? draftState.ids : optimizedIds;
  const manualDirty = !sameOrder(draftIds, optimizedIds);
  const differsFromCurrent = !sameOrder(draftIds, currentIds);
  const diffCount = countRouteOrderDiff(currentIds, draftIds);

  const moveItem = (itemId: string, direction: 'up' | 'down') => {
    setDraftState((current) => {
      const baseIds = current?.key === args.sourceKey ? current.ids : optimizedIds;
      return {
        key: args.sourceKey,
        ids: moveRouteItem(baseIds, itemId, direction),
      };
    });
  };

  const resetToOptimized = () => {
    setDraftState({
      key: args.sourceKey,
      ids: optimizedIds,
    });
  };

  return {
    currentIds,
    draftIds,
    diffCount,
    manualDirty,
    differsFromCurrent,
    moveItem,
    resetToOptimized,
  };
}
