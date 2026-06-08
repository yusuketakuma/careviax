'use client';

import { useState } from 'react';
import type { SourceRef } from '@/phos/contracts/phos_contracts';

export type SourceDrawerTriggerProps = {
  sources: SourceRef[];
};

export function SourceDrawerTrigger({ sources }: SourceDrawerTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <aside className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">参照情報</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {sources.length}件
        </span>
      </div>

      <button
        type="button"
        className="mt-3 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '参照情報を閉じる' : '参照情報を開く'}
      </button>

      {open ? (
        sources.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">参照情報はありません。</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70 rounded-md border border-border/70 bg-background">
            {sources.map((source) => (
              <li key={`${source.kind}:${source.ref_id}`} className="px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{source.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {source.kind} / {source.ref_id}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </aside>
  );
}
