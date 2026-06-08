'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { CardTileDims } from '@/phos/contracts/phos_design_tokens';
import { PhosActionLabel, PhosRejectReasonLabel } from '@/phos/contracts/phos_copy.ja';
import { ActionPhase } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  ActionReasonInput,
  BlockerView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';

export type NextActionPanelProps = {
  cardId: string;
  nextAction: NextActionView;
  blockers: BlockerView[];
  actionPhase?: ActionPhase;
  actionMessage?: string;
  onExecute(cardId: string, action: ActionCode, reason?: ActionReasonInput): void;
};

export function NextActionPanel({
  cardId,
  nextAction,
  blockers,
  actionPhase,
  actionMessage,
  onExecute,
}: NextActionPanelProps) {
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const actionLabel = PhosActionLabel[nextAction.code];
  const blockingCount = blockers.filter((blocker) => blocker.active).length;
  const isSubmitting = actionPhase === ActionPhase.SUBMITTING;
  const reasonRequired = nextAction.reason_required === true;
  const trimmedReasonNote = reasonNote.trim();
  const canExecute = nextAction.enabled && !isSubmitting && (!reasonRequired || reasonCode);

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

      {reasonRequired ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-background px-3 py-3">
          <label className="block text-sm font-medium text-foreground" htmlFor={`${cardId}-reason`}>
            理由
          </label>
          <select
            id={`${cardId}-reason`}
            className="min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="">選択してください</option>
            {Object.entries(PhosRejectReasonLabel).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor={`${cardId}-reason-note`}
          >
            補足
          </label>
          <textarea
            id={`${cardId}-reason-note`}
            className="min-h-20 w-full resize-y rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            value={reasonNote}
            onChange={(event) => setReasonNote(event.target.value)}
          />
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
          onExecute(
            cardId,
            nextAction.code,
            reasonRequired
              ? {
                  reason_code: reasonCode,
                  ...(trimmedReasonNote ? { reason_note: trimmedReasonNote } : {}),
                }
              : undefined,
          );
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
