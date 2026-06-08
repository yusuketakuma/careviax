'use client';

import { PhosHandoffUrgencyLabel } from '@/phos/contracts/phos_copy.ja';
import { HandoffStatus } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';
import { sortHandoffQueue } from '@/phos/domain/handoff/handoffLifecycle';

export type HandoffQueueProps = {
  handoffs: HandoffView[];
  onOpenCard(cardId: string): void;
  onOpenReview(handoffId: string): void;
};

export function HandoffQueue({ handoffs, onOpenCard, onOpenReview }: HandoffQueueProps) {
  const openHandoffs = sortHandoffQueue(
    handoffs.filter((handoff) => handoff.status === HandoffStatus.OPEN),
  );

  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">薬剤師判断待ち</h2>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {openHandoffs.length}件
        </span>
      </div>
      {openHandoffs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">判断待ちの確認依頼はありません。</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {openHandoffs.map((handoff) => (
            <li key={handoff.handoff_id} className="rounded-md border border-border/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{handoff.patient_name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{handoff.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {PhosHandoffUrgencyLabel[handoff.urgency]} / {handoff.age_minutes}分
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => onOpenReview(handoff.handoff_id)}
                  >
                    確認を開始
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => onOpenCard(handoff.card_id)}
                  >
                    カードを開く
                  </button>
                </div>
              </div>
              <ul className="mt-2 space-y-1 border-t border-border/70 pt-2">
                {handoff.source_refs.map((source) => (
                  <li
                    key={`${handoff.handoff_id}:${source.kind}:${source.ref_id}`}
                    className="text-xs text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">{source.label}</span>
                    <span> / {source.kind}</span>
                    {source.captured_at ? <span> / {source.captured_at}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
