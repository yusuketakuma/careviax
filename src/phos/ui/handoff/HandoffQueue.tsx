'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  PhosActionLabel,
  PhosHandoffPanelCopy,
  PhosHandoffReturnReasonLabel,
  PhosHandoffStatusLabel,
  PhosHandoffUrgencyLabel,
} from '@/phos/contracts/phos_copy.ja';
import { HandoffStatus } from '@/phos/contracts/phos_contracts';
import type { ActionCode, HandoffView } from '@/phos/contracts/phos_contracts';
import { sortHandoffQueue } from '@/phos/domain/handoff/handoffLifecycle';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type HandoffQueueProps = {
  handoffs: HandoffView[];
  onOpenCard(cardId: string): void;
  onOpenReview(handoffId: string): void;
  onResolve(handoffId: string, resolvedActionCode: ActionCode): void;
  onReturn(handoffId: string, reasonCode: string, note: string): void;
};

function isConfirmShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

export function HandoffQueue({
  handoffs,
  onOpenCard,
  onOpenReview,
  onResolve,
  onReturn,
}: HandoffQueueProps) {
  const returnReasonOptions = Object.entries(PhosHandoffReturnReasonLabel);
  const [returningId, setReturningId] = useState<string | undefined>();
  const [returnReason, setReturnReason] = useState(returnReasonOptions[0]?.[0] ?? '');
  const [returnNote, setReturnNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const activeHandoffs = sortHandoffQueue(
    handoffs.filter(
      (handoff) =>
        handoff.status === HandoffStatus.OPEN || handoff.status === HandoffStatus.IN_REVIEW,
    ),
  );

  function submitReturn(handoffId: string) {
    if (!returnReason.trim() || !returnNote.trim()) {
      setError(PhosHandoffPanelCopy.RETURN_REQUIRED_ERROR);
      return;
    }
    onReturn(handoffId, returnReason.trim(), returnNote.trim());
  }

  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">薬剤師判断待ち</h2>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {activeHandoffs.length}件
        </span>
      </div>
      {activeHandoffs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">判断待ちの確認依頼はありません。</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {activeHandoffs.map((handoff) => {
            const canResolve =
              handoff.status === HandoffStatus.IN_REVIEW && Boolean(handoff.requested_action);
            const returnOpen = returningId === handoff.handoff_id;

            return (
              <li key={handoff.handoff_id} className="rounded-md border border-border/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{handoff.patient_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{handoff.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PhosHandoffUrgencyLabel[handoff.urgency]} /{' '}
                      {PhosHandoffStatusLabel[handoff.status]} / {handoff.age_minutes}分
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {handoff.status === HandoffStatus.OPEN ? (
                      <button
                        type="button"
                        className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() => onOpenReview(handoff.handoff_id)}
                      >
                        {PhosHandoffPanelCopy.START_REVIEW}
                      </button>
                    ) : null}
                    {handoff.status === HandoffStatus.IN_REVIEW ? (
                      <>
                        <button
                          type="button"
                          className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
                          data-enabled={canResolve ? 'true' : 'false'}
                          aria-disabled={!canResolve}
                          aria-label={
                            canResolve
                              ? PhosHandoffPanelCopy.RESOLVE_ARIA
                              : PhosHandoffPanelCopy.RESOLVE_UNCONFIGURED_ARIA
                          }
                          onClick={() => {
                            if (!handoff.requested_action) return;
                            onResolve(handoff.handoff_id, handoff.requested_action);
                          }}
                        >
                          {handoff.requested_action
                            ? PhosActionLabel[handoff.requested_action]
                            : PhosHandoffPanelCopy.NO_RESOLVE_ACTION}
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={() => {
                            setReturningId(handoff.handoff_id);
                            setReturnReason(returnReasonOptions[0]?.[0] ?? '');
                            setError(undefined);
                          }}
                        >
                          {PhosHandoffPanelCopy.RETURN_BUTTON}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => onOpenCard(handoff.card_id)}
                    >
                      カードを開く
                    </button>
                  </div>
                </div>
                {handoff.source_refs.length > 0 ? (
                  <div className="mt-2 border-t border-border/70 pt-2">
                    <SourceRefList sources={handoff.source_refs} />
                  </div>
                ) : null}
                {returnOpen ? (
                  <div
                    className="mt-3 rounded-md border border-border/70 bg-background p-3"
                    onKeyDown={(event) => {
                      if (!isConfirmShortcut(event)) return;
                      event.preventDefault();
                      submitReturn(handoff.handoff_id);
                    }}
                  >
                    <label
                      className="text-sm font-medium text-foreground"
                      htmlFor="queue-return-reason"
                    >
                      {PhosHandoffPanelCopy.RETURN_REASON_LABEL}
                    </label>
                    <select
                      id="queue-return-reason"
                      className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={returnReason}
                      onChange={(event) => {
                        setReturnReason(event.target.value);
                        setError(undefined);
                      }}
                    >
                      {returnReasonOptions.map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <label
                      className="mt-3 block text-sm font-medium text-foreground"
                      htmlFor="queue-return-note"
                    >
                      {PhosHandoffPanelCopy.RETURN_NOTE_LABEL}
                    </label>
                    <textarea
                      id="queue-return-note"
                      className="mt-2 min-h-24 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={returnNote}
                      onChange={(event) => {
                        setReturnNote(event.target.value);
                        setError(undefined);
                      }}
                    />
                    {error ? (
                      <p
                        role="alert"
                        className="mt-2 text-sm"
                        style={{ color: warningFeedbackStyle.color }}
                      >
                        {error}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="mt-3 min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => submitReturn(handoff.handoff_id)}
                    >
                      {PhosHandoffPanelCopy.RETURN_SUBMIT}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
