'use client';

import { useState } from 'react';
import { ReportDeliveryStatus, type ReportDeliveryView } from '@/phos/contracts/phos_contracts';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type ReportDeliveryReplyInput = {
  result_status:
    | typeof ReportDeliveryStatus.REPLIED
    | typeof ReportDeliveryStatus.ACTION_REQUIRED
    | typeof ReportDeliveryStatus.ACTION_DONE;
  reply_summary: string;
  action_required_note?: string;
};

export type ReportDeliveryActionDoneInput = {
  action_note: string;
};

export type ReportDeliveryQueueProps = {
  deliveries: ReportDeliveryView[];
  onOpenCard(cardId: string): void;
  onRegisterReply?(delivery: ReportDeliveryView, input: ReportDeliveryReplyInput): void;
  onMarkActionDone?(delivery: ReportDeliveryView, input: ReportDeliveryActionDoneInput): void;
  submittingDeliveryId?: string;
};

function formatMethod(method: ReportDeliveryView['delivery_method']): string {
  switch (method) {
    case 'FAX':
      return 'FAX';
    case 'EMAIL':
      return 'メール';
    case 'PHONE':
      return '電話';
    case 'HAND_DELIVERY':
      return '手渡し';
    case 'MCS':
      return 'MCS';
  }
}

export function ReportDeliveryQueue({
  deliveries,
  onOpenCard,
  onRegisterReply,
  onMarkActionDone,
  submittingDeliveryId,
}: ReportDeliveryQueueProps) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReportDeliveryReplyInput>>({});
  const [actionDrafts, setActionDrafts] = useState<Record<string, ReportDeliveryActionDoneInput>>(
    {},
  );
  const waiting = deliveries
    .filter((delivery) => delivery.status === ReportDeliveryStatus.WAITING_REPLY)
    .sort((a, b) => b.stale_minutes - a.stale_minutes || a.sent_at.localeCompare(b.sent_at));
  const actionRequired = deliveries
    .filter((delivery) => delivery.status === ReportDeliveryStatus.ACTION_REQUIRED)
    .sort((a, b) => b.stale_minutes - a.stale_minutes || a.sent_at.localeCompare(b.sent_at));

  function replyDraft(delivery: ReportDeliveryView): ReportDeliveryReplyInput {
    return (
      replyDrafts[delivery.delivery_id] ?? {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '',
      }
    );
  }

  function actionDraft(delivery: ReportDeliveryView): ReportDeliveryActionDoneInput {
    return actionDrafts[delivery.delivery_id] ?? { action_note: '' };
  }

  return (
    <section className="rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">報告返信待ち</h2>
        <span className="rounded-md border border-border/70 bg-muted/35 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {waiting.length}件
        </span>
      </div>
      {waiting.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">返信待ちの報告書はありません。</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {waiting.map((delivery) => (
            <li key={delivery.delivery_id} className="rounded-md border border-border/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{delivery.patient_name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{delivery.target_label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMethod(delivery.delivery_method)} / {delivery.stale_minutes}分経過
                  </p>
                </div>
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => onOpenCard(delivery.card_id)}
                >
                  カードを開く
                </button>
              </div>
              {(delivery.source_refs ?? []).length > 0 ? (
                <div className="mt-2 border-t border-border/70 pt-2">
                  <SourceRefList sources={delivery.source_refs ?? []} />
                </div>
              ) : null}
              {onRegisterReply ? (
                <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                  <select
                    className="min-h-11 w-full rounded-md border border-border/70 bg-background px-3 text-sm"
                    value={replyDraft(delivery).result_status}
                    onChange={(event) => {
                      const nextStatus = event.target
                        .value as ReportDeliveryReplyInput['result_status'];
                      setReplyDrafts((current) => ({
                        ...current,
                        [delivery.delivery_id]: {
                          ...replyDraft(delivery),
                          result_status: nextStatus,
                        },
                      }));
                    }}
                    aria-label={`${delivery.patient_name}の返信結果`}
                  >
                    <option value={ReportDeliveryStatus.ACTION_DONE}>対応不要で完了</option>
                    <option value={ReportDeliveryStatus.ACTION_REQUIRED}>対応が必要</option>
                    <option value={ReportDeliveryStatus.REPLIED}>返信のみ登録</option>
                  </select>
                  <textarea
                    className="min-h-20 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                    value={replyDraft(delivery).reply_summary}
                    onChange={(event) =>
                      setReplyDrafts((current) => ({
                        ...current,
                        [delivery.delivery_id]: {
                          ...replyDraft(delivery),
                          reply_summary: event.target.value,
                        },
                      }))
                    }
                    placeholder="返信内容"
                    aria-label={`${delivery.patient_name}の返信内容`}
                  />
                  {replyDraft(delivery).result_status === ReportDeliveryStatus.ACTION_REQUIRED ? (
                    <textarea
                      className="min-h-20 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                      value={replyDraft(delivery).action_required_note ?? ''}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [delivery.delivery_id]: {
                            ...replyDraft(delivery),
                            action_required_note: event.target.value,
                          },
                        }))
                      }
                      placeholder="必要な対応"
                      aria-label={`${delivery.patient_name}の必要な対応`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="min-h-11 rounded-md border border-border/70 bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:opacity-55"
                    data-enabled={
                      replyDraft(delivery).reply_summary.trim().length > 0 &&
                      (replyDraft(delivery).result_status !==
                        ReportDeliveryStatus.ACTION_REQUIRED ||
                        Boolean(replyDraft(delivery).action_required_note?.trim())) &&
                      submittingDeliveryId !== delivery.delivery_id
                    }
                    onClick={() => {
                      const draft = replyDraft(delivery);
                      const canSubmit =
                        draft.reply_summary.trim().length > 0 &&
                        (draft.result_status !== ReportDeliveryStatus.ACTION_REQUIRED ||
                          Boolean(draft.action_required_note?.trim())) &&
                        submittingDeliveryId !== delivery.delivery_id;
                      if (!canSubmit) return;
                      onRegisterReply(delivery, {
                        ...draft,
                        reply_summary: draft.reply_summary.trim(),
                        ...(draft.action_required_note
                          ? { action_required_note: draft.action_required_note.trim() }
                          : {}),
                      });
                    }}
                  >
                    返信を登録
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {actionRequired.length > 0 ? (
        <div className="mt-4 border-t border-border/70 pt-4">
          <h3 className="text-sm font-semibold text-foreground">返信対応待ち</h3>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {actionRequired.map((delivery) => (
              <li key={delivery.delivery_id} className="rounded-md border border-border/70 p-3">
                <p className="font-medium text-foreground">{delivery.patient_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{delivery.target_label}</p>
                {delivery.action_required_note ? (
                  <p className="mt-2 text-sm text-foreground">{delivery.action_required_note}</p>
                ) : null}
                {onMarkActionDone ? (
                  <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                    <textarea
                      className="min-h-20 w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                      value={actionDraft(delivery).action_note}
                      onChange={(event) =>
                        setActionDrafts((current) => ({
                          ...current,
                          [delivery.delivery_id]: { action_note: event.target.value },
                        }))
                      }
                      placeholder="対応内容"
                      aria-label={`${delivery.patient_name}の対応内容`}
                    />
                    <button
                      type="button"
                      className="min-h-11 rounded-md border border-border/70 bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 data-[enabled=false]:cursor-not-allowed data-[enabled=false]:opacity-55"
                      data-enabled={
                        actionDraft(delivery).action_note.trim().length > 0 &&
                        submittingDeliveryId !== delivery.delivery_id
                      }
                      onClick={() => {
                        const draft = actionDraft(delivery);
                        const canSubmit =
                          draft.action_note.trim().length > 0 &&
                          submittingDeliveryId !== delivery.delivery_id;
                        if (!canSubmit) return;
                        onMarkActionDone(delivery, { action_note: draft.action_note.trim() });
                      }}
                    >
                      返信対応を完了
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
