'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { CardTileDims } from '@/phos/contracts/phos_design_tokens';
import { PhosActionLabel } from '@/phos/contracts/phos_copy.ja';
import { ActionPhase } from '@/phos/contracts/phos_contracts';
import type { ActionCode, BlockerView, NextActionView } from '@/phos/contracts/phos_contracts';

export type NextActionPanelProps = {
  cardId: string;
  nextAction: NextActionView;
  blockers: BlockerView[];
  actionPhase?: ActionPhase;
  actionMessage?: string;
  onExecute(cardId: string, action: ActionCode): void;
};

export function NextActionPanel({
  cardId,
  nextAction,
  blockers,
  actionPhase,
  actionMessage,
  onExecute,
}: NextActionPanelProps) {
  const actionLabel = PhosActionLabel[nextAction.code];
  const blockingCount = blockers.filter((blocker) => blocker.active).length;
  const isSubmitting = actionPhase === ActionPhase.SUBMITTING;
  const canExecute = nextAction.enabled && !isSubmitting;

  return (
    <aside className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">次の操作</h3>
        <p className="mt-1 text-sm text-muted-foreground">{actionLabel}</p>
      </div>

      {actionMessage ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{actionMessage}</span>
        </div>
      ) : null}

      <button
        type="button"
        className="w-full rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
        style={{ minHeight: CardTileDims.primaryButtonHeight }}
        data-enabled={canExecute ? 'true' : 'false'}
        aria-label={
          canExecute
            ? actionLabel
            : isSubmitting
              ? `${actionLabel}（送信中）`
              : `${actionLabel}（実行不可）`
        }
        onClick={() => {
          if (!canExecute) return;
          onExecute(cardId, nextAction.code);
        }}
      >
        <span className="inline-flex items-center justify-center gap-2">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {actionLabel}
        </span>
      </button>

      {actionPhase ? (
        <p className="text-xs text-muted-foreground">操作状態: {actionPhase}</p>
      ) : null}

      <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
        <p className="font-medium text-foreground">ブロッカー</p>
        <p className="mt-1 text-muted-foreground">
          {blockingCount > 0
            ? `${blockingCount}件の確認が必要です。`
            : '未解消のブロッカーはありません。'}
        </p>
      </div>
    </aside>
  );
}
