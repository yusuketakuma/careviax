'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  PhosActionLabel,
  PhosHandoffCreateReasonLabel,
  PhosHandoffPanelCopy,
  PhosHandoffReturnReasonLabel,
  PhosHandoffStatusLabel,
  PhosHandoffUrgencyLabel,
} from '@/phos/contracts/phos_copy.ja';
import { HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { ActionCode, HandoffView, SourceRef } from '@/phos/contracts/phos_contracts';
import { sortHandoffQueue } from '@/phos/domain/handoff/handoffLifecycle';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type HandoffCreateInput = {
  reason_code: string;
  summary: string;
  urgency: HandoffUrgency;
  requested_action?: ActionCode;
};

export type HandoffPanelProps = {
  handoffs: HandoffView[];
  createSources?: SourceRef[];
  createRequestedActions?: ActionCode[];
  onCreate?(input: HandoffCreateInput): void;
  onOpenReview(handoffId: string): void;
  onResolve(handoffId: string, resolvedActionCode: ActionCode): void;
  onReturn(handoffId: string, reasonCode: string, note: string): void;
};

function isConfirmShortcut(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

export function HandoffPanel({
  handoffs,
  createSources = [],
  createRequestedActions = [],
  onCreate,
  onOpenReview,
  onResolve,
  onReturn,
}: HandoffPanelProps) {
  const createReasonOptions = Object.entries(PhosHandoffCreateReasonLabel);
  const returnReasonOptions = Object.entries(PhosHandoffReturnReasonLabel);
  const requestedActionOptions = Array.from(new Set(createRequestedActions));
  const [returningId, setReturningId] = useState<string | undefined>();
  const [reasonCode, setReasonCode] = useState(returnReasonOptions[0]?.[0] ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createReason, setCreateReason] = useState(createReasonOptions[0]?.[0] ?? '');
  const [createSummary, setCreateSummary] = useState('');
  const [createUrgency, setCreateUrgency] = useState<HandoffUrgency>(HandoffUrgency.NORMAL);
  const [createRequestedAction, setCreateRequestedAction] = useState<ActionCode | ''>(
    requestedActionOptions[0] ?? '',
  );
  const [createError, setCreateError] = useState<string | undefined>();
  const sortedHandoffs = sortHandoffQueue(handoffs);

  function submitCreate() {
    if (!onCreate) return;
    if (!createReason.trim() || !createSummary.trim()) {
      setCreateError(PhosHandoffPanelCopy.CREATE_REQUIRED_ERROR);
      return;
    }
    if (createSources.length === 0) {
      setCreateError(PhosHandoffPanelCopy.SOURCE_REQUIRED_ERROR);
      return;
    }
    onCreate({
      reason_code: createReason.trim(),
      summary: createSummary.trim(),
      urgency: createUrgency,
      ...(createRequestedAction ? { requested_action: createRequestedAction } : {}),
    });
  }

  function submitReturn(handoffId: string) {
    if (!reasonCode.trim() || !note.trim()) {
      setError(PhosHandoffPanelCopy.RETURN_REQUIRED_ERROR);
      return;
    }
    onReturn(handoffId, reasonCode.trim(), note.trim());
  }

  return (
    <aside className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">{PhosHandoffPanelCopy.TITLE}</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {handoffs.length}
          {PhosHandoffPanelCopy.COUNT_SUFFIX}
        </span>
      </div>
      {onCreate ? (
        <div className="mt-3 border-b border-border/70 pb-3">
          <button
            type="button"
            className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => {
              setCreateOpen((current) => !current);
              setCreateError(undefined);
              setCreateReason(createReasonOptions[0]?.[0] ?? '');
              setCreateRequestedAction(requestedActionOptions[0] ?? '');
            }}
          >
            {PhosHandoffPanelCopy.CREATE_BUTTON}
          </button>
          {createOpen ? (
            <div
              className="mt-3 rounded-md border border-border/70 bg-background p-3"
              onKeyDown={(event) => {
                if (!isConfirmShortcut(event)) return;
                event.preventDefault();
                submitCreate();
              }}
            >
              <label className="text-sm font-medium text-foreground" htmlFor="handoff-reason">
                {PhosHandoffPanelCopy.CREATE_REASON_LABEL}
              </label>
              <select
                id="handoff-reason"
                className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={createReason}
                onChange={(event) => {
                  setCreateReason(event.target.value);
                  setCreateError(undefined);
                }}
              >
                {createReasonOptions.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <label
                className="mt-3 block text-sm font-medium text-foreground"
                htmlFor="handoff-summary"
              >
                {PhosHandoffPanelCopy.CREATE_SUMMARY_LABEL}
              </label>
              <textarea
                id="handoff-summary"
                className="mt-2 min-h-24 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={createSummary}
                onChange={(event) => {
                  setCreateSummary(event.target.value);
                  setCreateError(undefined);
                }}
              />
              <label
                className="mt-3 block text-sm font-medium text-foreground"
                htmlFor="handoff-urgency"
              >
                {PhosHandoffPanelCopy.URGENCY_LABEL}
              </label>
              <select
                id="handoff-urgency"
                className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={createUrgency}
                onChange={(event) => {
                  setCreateUrgency(event.target.value as HandoffUrgency);
                  setCreateError(undefined);
                }}
              >
                {Object.values(HandoffUrgency).map((urgency) => (
                  <option key={urgency} value={urgency}>
                    {PhosHandoffUrgencyLabel[urgency]}
                  </option>
                ))}
              </select>
              <label
                className="mt-3 block text-sm font-medium text-foreground"
                htmlFor="handoff-requested-action"
              >
                {PhosHandoffPanelCopy.REQUESTED_ACTION_LABEL}
              </label>
              <select
                id="handoff-requested-action"
                className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={createRequestedAction}
                onChange={(event) => {
                  setCreateRequestedAction(event.target.value as ActionCode | '');
                  setCreateError(undefined);
                }}
              >
                <option value="">{PhosHandoffPanelCopy.REQUESTED_ACTION_REVIEW_ONLY}</option>
                {requestedActionOptions.map((action) => (
                  <option key={action} value={action}>
                    {PhosActionLabel[action]}
                  </option>
                ))}
              </select>
              <SourceRefList sources={createSources} />
              {createError ? (
                <p className="mt-2 text-sm" style={{ color: warningFeedbackStyle.color }}>
                  {createError}
                </p>
              ) : null}
              <button
                type="button"
                className="mt-3 min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={submitCreate}
              >
                {PhosHandoffPanelCopy.CREATE_SUBMIT}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {sortedHandoffs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{PhosHandoffPanelCopy.EMPTY}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {sortedHandoffs.map((handoff) => {
            const canResolve =
              handoff.status === HandoffStatus.IN_REVIEW && Boolean(handoff.requested_action);
            const returnOpen = returningId === handoff.handoff_id;
            return (
              <li
                key={handoff.handoff_id}
                className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">{handoff.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {PhosHandoffUrgencyLabel[handoff.urgency]} /{' '}
                      {PhosHandoffStatusLabel[handoff.status]} / {handoff.age_minutes}分
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {handoff.source_refs.length}
                    {PhosHandoffPanelCopy.SOURCE_COUNT_SUFFIX}
                  </span>
                </div>
                <SourceRefList sources={handoff.source_refs} />

                <div className="mt-3 flex flex-wrap gap-2">
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
                          setError(undefined);
                          setReasonCode(returnReasonOptions[0]?.[0] ?? '');
                        }}
                      >
                        {PhosHandoffPanelCopy.RETURN_BUTTON}
                      </button>
                    </>
                  ) : null}
                </div>

                {returnOpen ? (
                  <div
                    className="mt-3 rounded-md border border-border/70 bg-card p-3"
                    onKeyDown={(event) => {
                      if (!isConfirmShortcut(event)) return;
                      event.preventDefault();
                      submitReturn(handoff.handoff_id);
                    }}
                  >
                    <label className="text-sm font-medium text-foreground" htmlFor="return-reason">
                      {PhosHandoffPanelCopy.RETURN_REASON_LABEL}
                    </label>
                    <select
                      id="return-reason"
                      className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={reasonCode}
                      onChange={(event) => {
                        setReasonCode(event.target.value);
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
                      htmlFor="return-note"
                    >
                      {PhosHandoffPanelCopy.RETURN_NOTE_LABEL}
                    </label>
                    <textarea
                      id="return-note"
                      className="mt-2 min-h-24 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={note}
                      onChange={(event) => {
                        setNote(event.target.value);
                        setError(undefined);
                      }}
                    />
                    {error ? (
                      <p className="mt-2 text-sm" style={{ color: warningFeedbackStyle.color }}>
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
    </aside>
  );
}
