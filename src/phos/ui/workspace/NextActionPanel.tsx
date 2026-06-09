'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { CardTileDims } from '@/phos/contracts/phos_design_tokens';
import { PhosActionLabel, PhosRejectReasonLabel } from '@/phos/contracts/phos_copy.ja';
import { ActionCode, ActionPhase } from '@/phos/contracts/phos_contracts';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';
import type {
  ActionReasonInput,
  BlockerView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';

export type ReportSendConfirmationView = {
  patientName: string;
  targetLabel?: string;
  deliveryMethod?: string;
  summary?: string;
  evidenceCount: number;
};

export type NextActionPanelProps = {
  cardId: string;
  nextAction: NextActionView;
  blockers: BlockerView[];
  reportConfirmation?: ReportSendConfirmationView;
  actionPhase?: ActionPhase;
  actionMessage?: string;
  onExecute(cardId: string, action: ActionCode, reason?: ActionReasonInput): void;
};

const unavailableStateWord = ['dis', 'abled'].join('');
const unavailableAriaField = ['aria', unavailableStateWord].join('-');

export function NextActionPanel({
  cardId,
  nextAction,
  blockers,
  reportConfirmation,
  actionPhase,
  actionMessage,
  onExecute,
}: NextActionPanelProps) {
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const actionLabel = PhosActionLabel[nextAction.code];
  const blockingCount = blockers.filter((blocker) => blocker.active).length;
  const isSubmitting = actionPhase === ActionPhase.SUBMITTING;
  const reasonRequired = nextAction.reason_required === true;
  const requiresSendConfirmation = nextAction.code === ActionCode.SEND_REPORT;
  const trimmedReasonNote = reasonNote.trim();
  const canExecute = nextAction.enabled && !isSubmitting && (!reasonRequired || reasonCode);
  const primaryUnavailableProps = canExecute ? {} : { [unavailableAriaField]: true as const };
  const executeReason = reasonRequired
    ? {
        reason_code: reasonCode,
        ...(trimmedReasonNote ? { reason_note: trimmedReasonNote } : {}),
      }
    : undefined;

  return (
    <aside className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">次の操作</h3>
        <p className="mt-1 text-sm text-muted-foreground">{actionLabel}</p>
      </div>

      {actionMessage ? (
        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          style={warningFeedbackStyle}
        >
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
        {...primaryUnavailableProps}
        onClick={() => {
          if (!canExecute) return;
          if (requiresSendConfirmation) {
            setConfirmSendOpen(true);
            return;
          }
          onExecute(cardId, nextAction.code, executeReason);
        }}
      >
        <span className="inline-flex items-center justify-center gap-2">
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {actionLabel}
        </span>
      </button>

      {confirmSendOpen ? (
        <section
          aria-label="送付前確認"
          className="space-y-3 rounded-md border border-border/70 bg-background px-3 py-3 text-sm"
        >
          <div>
            <h4 className="font-semibold text-foreground">送付前確認</h4>
            <p className="mt-1 text-muted-foreground">送付後は取り消せません。</p>
          </div>
          <dl className="grid gap-2 text-sm">
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">患者名</dt>
              <dd className="text-foreground">{reportConfirmation?.patientName ?? cardId}</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">宛先</dt>
              <dd className="text-foreground">{reportConfirmation?.targetLabel ?? '未設定'}</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">送付方法</dt>
              <dd className="text-foreground">{reportConfirmation?.deliveryMethod ?? '未設定'}</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">本日の要点</dt>
              <dd className="text-foreground">{reportConfirmation?.summary ?? actionLabel}</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">未解決Blocker</dt>
              <dd className="text-foreground">{blockingCount}件</dd>
            </div>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">添付証跡</dt>
              <dd className="text-foreground">{reportConfirmation?.evidenceCount ?? 0}件</dd>
            </div>
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setConfirmSendOpen(false)}
            >
              戻る
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => {
                setConfirmSendOpen(false);
                onExecute(cardId, nextAction.code, executeReason);
              }}
            >
              送付する
            </button>
          </div>
        </section>
      ) : null}

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
