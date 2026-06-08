'use client';

import { useState } from 'react';
import {
  PhosActionLabel,
  PhosHandoffStatusLabel,
  PhosHandoffUrgencyLabel,
} from '@/phos/contracts/phos_copy.ja';
import { HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { ActionCode, HandoffView, SourceRef } from '@/phos/contracts/phos_contracts';
import { sortHandoffQueue } from '@/phos/domain/handoff/handoffLifecycle';

export type HandoffCreateInput = {
  reason_code: string;
  summary: string;
  urgency: HandoffUrgency;
};

export type HandoffPanelProps = {
  handoffs: HandoffView[];
  createSources?: SourceRef[];
  onCreate?(input: HandoffCreateInput): void;
  onOpenReview(handoffId: string): void;
  onResolve(handoffId: string, resolvedActionCode: ActionCode): void;
  onReturn(handoffId: string, reasonCode: string, note: string): void;
};

function SourceRefList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 border-t border-border/70 pt-2">
      {sources.map((source) => (
        <li key={`${source.kind}:${source.ref_id}`} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{source.label}</span>
          <span> / {source.kind}</span>
          {source.captured_at ? <span> / {source.captured_at}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function HandoffPanel({
  handoffs,
  createSources = [],
  onCreate,
  onOpenReview,
  onResolve,
  onReturn,
}: HandoffPanelProps) {
  const [returningId, setReturningId] = useState<string | undefined>();
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [createReason, setCreateReason] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createUrgency, setCreateUrgency] = useState<HandoffUrgency>(HandoffUrgency.NORMAL);
  const [createError, setCreateError] = useState<string | undefined>();
  const sortedHandoffs = sortHandoffQueue(handoffs);

  return (
    <aside className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">薬剤師確認依頼</h3>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {handoffs.length}件
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
            }}
          >
            確認依頼を作成
          </button>
          {createOpen ? (
            <div className="mt-3 rounded-md border border-border/70 bg-background p-3">
              <label className="text-sm font-medium text-foreground" htmlFor="handoff-reason">
                理由コード
              </label>
              <input
                id="handoff-reason"
                className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                value={createReason}
                onChange={(event) => {
                  setCreateReason(event.target.value);
                  setCreateError(undefined);
                }}
              />
              <label
                className="mt-3 block text-sm font-medium text-foreground"
                htmlFor="handoff-summary"
              >
                確認内容
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
                緊急度
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
              <SourceRefList sources={createSources} />
              {createError ? <p className="mt-2 text-sm text-amber-950">{createError}</p> : null}
              <button
                type="button"
                className="mt-3 min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => {
                  if (!createReason.trim() || !createSummary.trim()) {
                    setCreateError('理由コードと確認内容を入力してください。');
                    return;
                  }
                  if (createSources.length === 0) {
                    setCreateError('確認元の参照が必要です。');
                    return;
                  }
                  onCreate({
                    reason_code: createReason.trim(),
                    summary: createSummary.trim(),
                    urgency: createUrgency,
                  });
                }}
              >
                作成する
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {sortedHandoffs.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">確認依頼はありません。</p>
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
                    {handoff.source_refs.length}参照
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
                      確認を開始
                    </button>
                  ) : null}

                  {handoff.status === HandoffStatus.IN_REVIEW ? (
                    <>
                      <button
                        type="button"
                        className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:bg-muted data-[enabled=false]:text-muted-foreground"
                        data-enabled={canResolve ? 'true' : 'false'}
                        aria-label={
                          canResolve ? '確認依頼を解決する' : '確認依頼を解決する（操作未指定）'
                        }
                        onClick={() => {
                          if (!handoff.requested_action) return;
                          onResolve(handoff.handoff_id, handoff.requested_action);
                        }}
                      >
                        {handoff.requested_action
                          ? PhosActionLabel[handoff.requested_action]
                          : '解決操作なし'}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                        onClick={() => {
                          setReturningId(handoff.handoff_id);
                          setError(undefined);
                        }}
                      >
                        事務へ戻す
                      </button>
                    </>
                  ) : null}
                </div>

                {returnOpen ? (
                  <div className="mt-3 rounded-md border border-border/70 bg-card p-3">
                    <label className="text-sm font-medium text-foreground" htmlFor="return-reason">
                      差し戻し理由コード
                    </label>
                    <input
                      id="return-reason"
                      className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={reasonCode}
                      onChange={(event) => {
                        setReasonCode(event.target.value);
                        setError(undefined);
                      }}
                    />
                    <label
                      className="mt-3 block text-sm font-medium text-foreground"
                      htmlFor="return-note"
                    >
                      差し戻しメモ
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
                    {error ? <p className="mt-2 text-sm text-amber-950">{error}</p> : null}
                    <button
                      type="button"
                      className="mt-3 min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        if (!reasonCode.trim() || !note.trim()) {
                          setError('差し戻し理由とメモを入力してください。');
                          return;
                        }
                        onReturn(handoff.handoff_id, reasonCode.trim(), note.trim());
                      }}
                    >
                      差し戻す
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
