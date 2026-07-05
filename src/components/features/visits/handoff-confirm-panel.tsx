'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from '@/components/ui/state-badge';
import { Textarea } from '@/components/ui/textarea';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import {
  VISIT_HANDOFF_OVERRIDE_REASON_OPTIONS,
  type VisitHandoffOverrideReasonOption,
  type VisitHandoffSelectableOverrideReasonCode,
} from '@/lib/visits/handoff-override-reasons';
import type { VisitHandoff } from '@/types/visit-brief';

type HandoffConfirmPanelProps = {
  visitRecordId: string;
  expectedVisitRecordVersion: number;
  handoff: VisitHandoff;
  canConfirm?: boolean;
  requiresOverrideReason?: boolean;
  overrideReasonMaxLength?: number;
  overrideReasonOptions?: readonly VisitHandoffOverrideReasonOption[];
  supervisionConfirmTaskId?: string | null;
  canRequestSupervision?: boolean;
  supervisionRequestNoteMaxLength?: number;
  onConfirmed?: () => void;
};

const OVERRIDE_REASON_MIN_LENGTH = 8;
const SUPERVISION_REQUEST_NOTE_MIN_LENGTH = 8;

type EditableHandoff = {
  next_check_items: string[];
  ongoing_monitoring: string[];
  decision_rationale: string;
};

function formatConfirmedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)} JST`;
}

function EditableTagList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    const trimmed = draft.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange([...items, trimmed]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
          >
            {item}
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 focus:outline-none focus:ring-1 focus:ring-ring"
              onClick={() => removeItem(i)}
              aria-label={`${item} を削除`}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="項目を追加..."
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={`${label}に項目を追加`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addItem}
          disabled={!draft.trim()}
          className="min-w-[44px]"
        >
          追加
        </Button>
      </div>
    </div>
  );
}

export function HandoffConfirmPanel({
  visitRecordId,
  expectedVisitRecordVersion,
  handoff,
  canConfirm = false,
  requiresOverrideReason = false,
  overrideReasonMaxLength = 500,
  overrideReasonOptions,
  supervisionConfirmTaskId = null,
  canRequestSupervision = false,
  supervisionRequestNoteMaxLength = 500,
  onConfirmed,
}: HandoffConfirmPanelProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const isUnconfirmed = !handoff.confirmed_at;
  const isSupervisionConfirm = isUnconfirmed && Boolean(supervisionConfirmTaskId);
  const canSubmitFinalConfirmation = canConfirm || isSupervisionConfirm;
  const isOverrideOnly =
    isUnconfirmed && !isSupervisionConfirm && !canConfirm && requiresOverrideReason;
  const isSupervisionRequestOnly =
    isUnconfirmed &&
    !isSupervisionConfirm &&
    !canConfirm &&
    !requiresOverrideReason &&
    canRequestSupervision;
  const isReadOnly =
    isUnconfirmed &&
    !isSupervisionConfirm &&
    !canConfirm &&
    !requiresOverrideReason &&
    !canRequestSupervision;
  const selectableOverrideReasonOptions =
    overrideReasonOptions ?? VISIT_HANDOFF_OVERRIDE_REASON_OPTIONS;
  const [editMode, setEditMode] = useState(false);
  const [overrideReasonCode, setOverrideReasonCode] = useState<
    VisitHandoffSelectableOverrideReasonCode | ''
  >(selectableOverrideReasonOptions[0]?.code ?? '');
  const [overrideReason, setOverrideReason] = useState('');
  const [supervisionRequestNote, setSupervisionRequestNote] = useState('');
  const overrideReasonTrimmed = overrideReason.trim();
  const supervisionRequestNoteTrimmed = supervisionRequestNote.trim();
  const canSubmitOverrideReasonCode =
    !requiresOverrideReason ||
    (overrideReasonCode.length > 0 &&
      selectableOverrideReasonOptions.some((option) => option.code === overrideReasonCode));
  const canSubmitOverride =
    !requiresOverrideReason ||
    (canSubmitOverrideReasonCode &&
      overrideReasonTrimmed.length >= OVERRIDE_REASON_MIN_LENGTH &&
      overrideReasonTrimmed.length <= overrideReasonMaxLength);
  const canSubmitSupervisionRequest =
    !supervisionRequestNoteTrimmed ||
    (supervisionRequestNoteTrimmed.length >= SUPERVISION_REQUEST_NOTE_MIN_LENGTH &&
      supervisionRequestNoteTrimmed.length <= supervisionRequestNoteMaxLength);

  const [edits, setEdits] = useState<EditableHandoff>({
    next_check_items: [...handoff.next_check_items],
    ongoing_monitoring: [...handoff.ongoing_monitoring],
    decision_rationale: handoff.decision_rationale ?? '',
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const payload: {
        confirmed: true;
        expected_visit_record_version: number;
        edits?: {
          next_check_items?: string[];
          ongoing_monitoring?: string[];
          decision_rationale?: string;
        };
        override_reason?: string;
        override_reason_code?: VisitHandoffSelectableOverrideReasonCode;
        task_id?: string;
      } = {
        confirmed: true,
        expected_visit_record_version: expectedVisitRecordVersion,
      };

      if (isSupervisionConfirm && supervisionConfirmTaskId) {
        payload.task_id = supervisionConfirmTaskId;
      } else if (requiresOverrideReason) {
        payload.override_reason = overrideReasonTrimmed;
        if (overrideReasonCode) {
          payload.override_reason_code = overrideReasonCode;
        }
      }

      if (editMode) {
        payload.edits = {
          next_check_items: edits.next_check_items,
          ongoing_monitoring: edits.ongoing_monitoring,
          decision_rationale: edits.decision_rationale || undefined,
        };
      }

      const endpoint = isSupervisionConfirm
        ? `/api/visit-records/${visitRecordId}/handoff/supervision-confirm`
        : `/api/visit-records/${visitRecordId}/handoff`;
      const res = await fetch(endpoint, {
        method: isSupervisionConfirm ? 'POST' : 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(payload),
      });
      return readApiJson<unknown>(res, '申し送りの確定に失敗しました');
    },
    onSuccess: () => {
      toast.success(
        isSupervisionConfirm
          ? '上長確認として申し送りを確定しました'
          : requiresOverrideReason
            ? '管理者として申し送りを確定しました'
            : '申し送りを確定しました',
      );
      setEditMode(false);
      setOverrideReason('');
      setOverrideReasonCode(selectableOverrideReasonOptions[0]?.code ?? '');
      void queryClient.invalidateQueries({ queryKey: ['visit-record', visitRecordId] });
      void queryClient.invalidateQueries({ queryKey: ['visit-handoff'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'handoff-confirmation', orgId] });
      onConfirmed?.();
    },
    onError: (err: Error) => {
      toast.error(messageFromError(err, '申し送りの確定に失敗しました'));
    },
  });

  const supervisionRequestMutation = useMutation({
    mutationFn: async () => {
      const payload: {
        expected_visit_record_version: number;
        request_note?: string;
      } = {
        expected_visit_record_version: expectedVisitRecordVersion,
      };

      if (supervisionRequestNoteTrimmed) {
        payload.request_note = supervisionRequestNoteTrimmed;
      }

      const res = await fetch(`/api/visit-records/${visitRecordId}/handoff/supervision-request`, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(payload),
      });
      return readApiJson<unknown>(res, '上長確認の依頼に失敗しました');
    },
    onSuccess: () => {
      toast.success('上長確認を依頼しました');
      setSupervisionRequestNote('');
      void queryClient.invalidateQueries({ queryKey: ['visit-handoff'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'handoff-confirmation', orgId] });
      onConfirmed?.();
    },
    onError: (err: Error) => {
      toast.error(messageFromError(err, '上長確認の依頼に失敗しました'));
    },
  });

  const displayItems = editMode
    ? edits
    : {
        next_check_items: handoff.next_check_items,
        ongoing_monitoring: handoff.ongoing_monitoring,
        decision_rationale: handoff.decision_rationale ?? '',
      };

  return (
    <Card
      className={
        isUnconfirmed
          ? 'border-state-confirm/40 bg-state-confirm/5 shadow-sm'
          : 'border-border shadow-sm'
      }
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {isUnconfirmed ? (
              <AlertTriangle className="size-4 text-state-confirm" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4 text-state-done" aria-hidden="true" />
            )}
            申し送り
          </CardTitle>
          <div className="flex items-center gap-2">
            {handoff.ai_extracted && (
              <Badge variant="outline" className="text-xs">
                AI抽出
              </Badge>
            )}
            {isUnconfirmed ? (
              <StateBadge role="confirm" className="text-xs">
                未確認
              </StateBadge>
            ) : (
              <StateBadge role="done" className="text-xs">
                確認済
              </StateBadge>
            )}
          </div>
        </div>
        {isUnconfirmed && (
          <div className="mt-2 rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-sm font-medium text-state-confirm">
            申し送り項目を確認してください
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {editMode ? (
          <>
            <EditableTagList
              label="次回確認事項"
              items={edits.next_check_items}
              onChange={(items) => setEdits((prev) => ({ ...prev, next_check_items: items }))}
            />
            <EditableTagList
              label="継続モニタリング"
              items={edits.ongoing_monitoring}
              onChange={(items) => setEdits((prev) => ({ ...prev, ongoing_monitoring: items }))}
            />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">判断根拠・申し送りメモ</p>
              <Textarea
                value={edits.decision_rationale}
                onChange={(e) =>
                  setEdits((prev) => ({ ...prev, decision_rationale: e.target.value }))
                }
                placeholder="判断の根拠や次の担当者へのメモを入力..."
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </>
        ) : (
          <>
            {displayItems.next_check_items.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">次回確認事項</p>
                <div className="flex flex-wrap gap-1.5">
                  {displayItems.next_check_items.map((item) => (
                    <Badge key={item} variant="outline" className="text-xs font-normal">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {displayItems.ongoing_monitoring.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">継続モニタリング</p>
                <div className="flex flex-wrap gap-1.5">
                  {displayItems.ongoing_monitoring.map((item) => (
                    <Badge
                      key={item}
                      variant="outline"
                      className="border-transparent bg-tag-info/10 text-tag-info text-xs font-normal"
                    >
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {displayItems.decision_rationale && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">判断根拠・申し送りメモ</p>
                <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                  {displayItems.decision_rationale}
                </p>
              </div>
            )}
            {displayItems.next_check_items.length === 0 &&
              displayItems.ongoing_monitoring.length === 0 &&
              !displayItems.decision_rationale && (
                <p className="text-sm text-muted-foreground">申し送り項目はありません。</p>
              )}
          </>
        )}

        {handoff.confirmed_at && !editMode && (
          <p className="text-xs text-muted-foreground">
            確認日時: {formatConfirmedAt(handoff.confirmed_at)}
            {handoff.confirmed_by ? ` (${handoff.confirmed_by})` : ''}
          </p>
        )}

        {isReadOnly && (
          <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            閲覧のみ: この申し送りは担当薬剤師または主/副担当のみ確定できます。
          </div>
        )}

        {isOverrideOnly && !editMode && (
          <div className="space-y-2 rounded-md border border-border/70 bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge role="confirm" className="text-xs">
                代行確認
              </StateBadge>
              <p className="text-sm font-medium text-foreground">管理者代行確認</p>
            </div>
            <p className="text-sm text-muted-foreground">
              担当者が直接確認できないため、管理者として代行確定できます。理由は監査ログに記録されます。
            </p>
            <div className="space-y-1.5">
              <label
                htmlFor="handoff-override-reason-code"
                className="text-xs font-medium text-foreground"
              >
                代行理由区分
              </label>
              <select
                id="handoff-override-reason-code"
                value={overrideReasonCode}
                onChange={(e) =>
                  setOverrideReasonCode(e.target.value as VisitHandoffSelectableOverrideReasonCode)
                }
                disabled={selectableOverrideReasonOptions.length === 0}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-describedby="handoff-override-reason-code-helper"
              >
                {selectableOverrideReasonOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p id="handoff-override-reason-code-helper" className="text-xs text-muted-foreground">
                {selectableOverrideReasonOptions.length > 0
                  ? '監査用の標準区分として記録されます。'
                  : '代行理由区分を取得できません。'}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="handoff-override-reason"
                className="text-xs font-medium text-foreground"
              >
                代行理由
              </label>
              <span className="text-xs text-muted-foreground">
                {overrideReasonTrimmed.length}/{overrideReasonMaxLength}
              </span>
            </div>
            <Textarea
              id="handoff-override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="例: 担当者不在のため、本日訪問前に確認が必要"
              rows={3}
              maxLength={overrideReasonMaxLength}
              className="resize-none text-sm"
              aria-describedby="handoff-override-reason-helper"
            />
            <p id="handoff-override-reason-helper" className="text-xs text-muted-foreground">
              {canSubmitOverride
                ? '代行理由は監査ログへ本文を残さず記録されます。'
                : '8文字以上の代行理由を入力すると確定できます。'}
            </p>
          </div>
        )}

        {isSupervisionRequestOnly && !editMode && (
          <div className="space-y-2 rounded-md border border-border/70 bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge role="confirm" className="text-xs">
                上長確認
              </StateBadge>
              <p className="text-sm font-medium text-foreground">上長確認を依頼</p>
            </div>
            <p className="text-sm text-muted-foreground">
              申し送りの最終確認は担当薬剤師または主/副担当が行います。
            </p>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="handoff-supervision-request-note"
                className="text-xs font-medium text-foreground"
              >
                依頼メモ
              </label>
              <span className="text-xs text-muted-foreground">
                {supervisionRequestNoteTrimmed.length}/{supervisionRequestNoteMaxLength}
              </span>
            </div>
            <Textarea
              id="handoff-supervision-request-note"
              value={supervisionRequestNote}
              onChange={(e) => setSupervisionRequestNote(e.target.value)}
              placeholder="例: 次回確認事項の確認をお願いします"
              rows={3}
              maxLength={supervisionRequestNoteMaxLength}
              className="resize-none text-sm"
              aria-describedby="handoff-supervision-request-note-helper"
            />
            <p
              id="handoff-supervision-request-note-helper"
              className="text-xs text-muted-foreground"
            >
              {canSubmitSupervisionRequest
                ? '依頼メモは監査ログへ本文を残さず記録されます。'
                : '依頼メモを入力する場合は8文字以上にしてください。'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {editMode ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending || !canSubmitFinalConfirmation}
              >
                {confirmMutation.isPending
                  ? isSupervisionConfirm
                    ? '上長確認中...'
                    : '確定中...'
                  : isSupervisionConfirm
                    ? '編集して上長確認'
                    : '編集して確定'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditMode(false);
                  setEdits({
                    next_check_items: [...handoff.next_check_items],
                    ongoing_monitoring: [...handoff.ongoing_monitoring],
                    decision_rationale: handoff.decision_rationale ?? '',
                  });
                }}
              >
                キャンセル
              </Button>
            </>
          ) : (
            <>
              {isUnconfirmed && (canSubmitFinalConfirmation || requiresOverrideReason) && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmMutation.mutate()}
                  disabled={
                    confirmMutation.isPending || (!isSupervisionConfirm && !canSubmitOverride)
                  }
                  aria-describedby={
                    requiresOverrideReason ? 'handoff-override-reason-helper' : undefined
                  }
                >
                  {confirmMutation.isPending
                    ? isSupervisionConfirm
                      ? '上長確認中...'
                      : requiresOverrideReason
                        ? '代行確定中...'
                        : '確定中...'
                    : isSupervisionConfirm
                      ? '上長確認を確定'
                      : requiresOverrideReason
                        ? '管理者として確定'
                        : '確認'}
                </Button>
              )}
              {canSubmitFinalConfirmation && (
                <Button type="button" size="sm" variant="outline" onClick={() => setEditMode(true)}>
                  {isSupervisionConfirm ? '編集して上長確認' : '編集して確定'}
                </Button>
              )}
              {isSupervisionRequestOnly && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => supervisionRequestMutation.mutate()}
                  disabled={supervisionRequestMutation.isPending || !canSubmitSupervisionRequest}
                  aria-describedby="handoff-supervision-request-note-helper"
                >
                  {supervisionRequestMutation.isPending ? '依頼中...' : '上長確認を依頼'}
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
