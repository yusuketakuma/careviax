'use client';

import { ExternalLink } from 'lucide-react';
import { PhosSourceDrawerCopy, PhosSourceRefKindLabel } from '@/phos/contracts/phos_copy.ja';
import type { SourceRef } from '@/phos/contracts/phos_contracts';

export type SourceRefListProps = {
  sources: SourceRef[];
  emptyText?: string;
};

function safeSourceHref(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const normalized = uri.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized;
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function SourceRefList({
  sources,
  emptyText = PhosSourceDrawerCopy.EMPTY,
}: SourceRefListProps) {
  if (sources.length === 0) {
    return (
      <p className="rounded-md border border-border/70 bg-card px-3 py-3 text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/70 rounded-md border border-border/70 bg-card">
      {sources.map((source) => {
        const href = safeSourceHref(source.uri);
        return (
          <li key={`${source.kind}:${source.ref_id}`} className="px-3 py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-foreground">{source.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {PhosSourceRefKindLabel[source.kind]}
                </p>
                {source.captured_at ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {PhosSourceDrawerCopy.CAPTURED_AT}: {source.captured_at}
                  </p>
                ) : null}
              </div>
              {href ? (
                <a
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {PhosSourceDrawerCopy.ORIGINAL}
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
