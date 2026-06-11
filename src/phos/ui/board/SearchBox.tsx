'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PhosBoardCopy } from '@/phos/contracts/phos_copy.ja';

export type SearchBoxProps = {
  query: string;
  onQueryChange(query: string): void;
};

export function SearchBox({ query, onQueryChange }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const [draftState, setDraftState] = useState({ sourceQuery: query, draft: query });
  const draft = draftState.sourceQuery === query ? draftState.draft : query;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!composingRef.current) onQueryChange(draft);
    }, 300);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [draft, onQueryChange]);

  function commitNow(value: string) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    onQueryChange(value);
  }

  function updateDraft(value: string) {
    setDraftState({ sourceQuery: query, draft: value });
  }

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-sm focus-within:ring-3 focus-within:ring-ring/50">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{PhosBoardCopy.SEARCH_LABEL}</span>
      <input
        ref={inputRef}
        value={draft}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        placeholder={PhosBoardCopy.SEARCH_PLACEHOLDER}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          updateDraft(event.currentTarget.value);
        }}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || composingRef.current) return;
          commitNow(event.currentTarget.value);
        }}
      />
    </label>
  );
}
