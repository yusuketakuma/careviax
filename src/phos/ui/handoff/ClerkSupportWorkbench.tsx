'use client';

import { HandoffStatus } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';

export type ClerkSupportWorkbenchProps = {
  handoffs: HandoffView[];
  onOpenCard(cardId: string): void;
};

export function ClerkSupportWorkbench({ handoffs, onOpenCard }: ClerkSupportWorkbenchProps) {
  const returnedHandoffs = handoffs.filter((handoff) => handoff.status === HandoffStatus.RETURNED);

  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">事務 Support Workbench</h2>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {returnedHandoffs.length}件
        </span>
      </div>
      {returnedHandoffs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">事務へ戻された確認依頼はありません。</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {returnedHandoffs.map((handoff) => (
            <li key={handoff.handoff_id} className="rounded-md border border-border/70 p-3">
              <p className="font-medium text-foreground">{handoff.patient_name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{handoff.summary}</p>
              <p className="mt-2 text-sm text-foreground">
                {handoff.return_reason_code ?? '理由未設定'}
              </p>
              {handoff.return_note ? (
                <p className="mt-1 text-sm text-muted-foreground">{handoff.return_note}</p>
              ) : null}
              <button
                type="button"
                className="mt-3 min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onOpenCard(handoff.card_id)}
              >
                カードを開く
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
