'use client';

import { useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PhosSourceDrawerCopy } from '@/phos/contracts/phos_copy.ja';
import type { SourceRef } from '@/phos/contracts/phos_contracts';
import { SourceRefList } from './SourceRefList';

export type SourceDrawerTriggerProps = {
  sources: SourceRef[];
};

export function SourceDrawerTrigger({ sources }: SourceDrawerTriggerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) return;
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  }

  return (
    <aside className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{PhosSourceDrawerCopy.TITLE}</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {sources.length}
          {PhosSourceDrawerCopy.COUNT_SUFFIX}
        </span>
      </div>

      <button
        ref={triggerRef}
        type="button"
        className="mt-3 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-controls="phos-source-drawer"
        onClick={() => handleOpenChange(true)}
      >
        {PhosSourceDrawerCopy.OPEN}
      </button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          id="phos-source-drawer"
          side="right"
          className="w-[min(92vw,460px)] sm:max-w-md"
          aria-label={PhosSourceDrawerCopy.TITLE}
        >
          <SheetHeader className="border-b border-border/70">
            <SheetTitle>{PhosSourceDrawerCopy.TITLE}</SheetTitle>
            <p className="text-sm text-muted-foreground">{PhosSourceDrawerCopy.DESCRIPTION}</p>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <SourceRefList sources={sources} />
          </div>
        </SheetContent>
      </Sheet>
    </aside>
  );
}
