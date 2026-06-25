'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { WorkspaceActionRail } from '@/components/features/workspace/action-rail';
import { HandoffConfirmPanel } from '@/components/features/visits/handoff-confirm-panel';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useAuthStore } from '@/lib/stores/auth-store';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { VisitHandoff } from '@/types/visit-brief';
import {
  buildHandoffEvidence,
  buildHeaderMeta,
  buildItemEntityAction,
  buildItemSubText,
  buildItemTitle,
  buildStatusBadge,
  buildWorkspaceBlockedReasons,
  buildWorkspaceNextAction,
  consultItemsOf,
  countConsultByStatus,
  formatTimeOfDay,
  progressPercent,
  CONSULT_STATUS_META,
  CONSULT_STATUS_ORDER,
  RESOLUTION_ACTION_LABEL,
  type HandoffBoardItem,
  type HandoffBoardResponse,
  type HandoffConsultStatus,
  type HandoffRecipientOption,
  type HandoffResolutionAction,
} from './handoff-workspace.helpers';

/**
 * new_12_handoff(docs/design-gap-analysis-new.md)ハンドオフ=責任の移動ボード。
 * 本文(私が渡した → 私に来た → 3点セットのルール帯)+ 右レール
 * (次にやること/止まっている理由/根拠・記録)の 2 カラム構成。
 * 主操作(青)はヘッダーの「+ 仕事を渡す」1 つだけ。
 */

async function fetchHandoffBoard(orgId: string): Promise<HandoffBoardResponse> {
  const res = await fetch('/api/handoff-board', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('ハンドオフボードの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

const HANDOFF_BOARD_INVALIDATION_EVENTS = ['workflow_refresh', 'cycle_transition'] as const;

function isHandoffBoardInvalidationEvent(event: unknown) {
  const eventType =
    typeof event === 'object' && event !== null && 'type' in event
      ? (event as { type: string }).type
      : undefined;
  return HANDOFF_BOARD_INVALIDATION_EVENTS.some((type) => type === eventType);
}

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション情報の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

type HandoffConfirmationTask = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  related_entity_id: string | null;
  created_at: string;
};

async function fetchHandoffConfirmationTasks(orgId: string): Promise<HandoffConfirmationTask[]> {
  const params = new URLSearchParams({
    status: 'pending',
    task_type: 'handoff_confirmation',
  });
  const res = await fetch(`/api/tasks?${params.toString()}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('訪問申し送り確認タスクの取得に失敗しました');
  const json = (await res.json()) as { data?: HandoffConfirmationTask[] };
  return (json.data ?? []).filter((task) => Boolean(task.related_entity_id));
}

async function fetchVisitHandoff(orgId: string, visitRecordId: string): Promise<VisitHandoff> {
  const res = await fetch(`/api/visit-records/${visitRecordId}/handoff`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? '訪問申し送りの取得に失敗しました');
  }
  const json = (await res.json()) as { data: VisitHandoff };
  return json.data;
}

// ---------------------------------------------------------------------------
// ハンドオフ行カード
// ---------------------------------------------------------------------------

function HandoffItemCard({
  item,
  now,
  onConfirmReceipt,
  confirmPending,
  viewerUserId,
}: {
  item: HandoffBoardItem;
  now: Date;
  onConfirmReceipt?: (itemId: string) => void;
  confirmPending?: boolean;
  viewerUserId: string | null;
}) {
  const badge = buildStatusBadge(item, now);
  const subText = buildItemSubText(item);
  const entityAction = buildItemEntityAction(item);
  const percent = progressPercent(item);
  const isConfirming = item.lifecycle_status === 'confirming';
  const isProposed = item.lifecycle_status === 'proposed';
  const isReadByViewer = viewerUserId ? item.read_by.includes(viewerUserId) : false;

  return (
    <article
      className="rounded-lg border border-border/70 bg-card p-3"
      data-testid="handoff-item-card"
      data-status={item.lifecycle_status ?? 'legacy'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold',
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <p className="min-w-0 flex-1 text-sm font-bold leading-5 text-foreground">
          {buildItemTitle(item)}
        </p>
        {isProposed ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            提案 {formatTimeOfDay(item.created_at)}
          </span>
        ) : null}
        {percent != null ? (
          <span
            className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`進捗 ${percent}%`}
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </span>
        ) : null}
        {isConfirming ? (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/communications">状況を聞く</Link>
          </Button>
        ) : null}
        {item.direction === 'incoming' && onConfirmReceipt && !isReadByViewer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={confirmPending}
            onClick={() => onConfirmReceipt(item.id)}
          >
            受領確認
          </Button>
        ) : null}
      </div>
      {subText || entityAction ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
          {subText ? <span>{subText}</span> : null}
          {entityAction ? (
            <Link
              href={entityAction.href}
              className="inline-flex min-h-6 items-center rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 font-medium text-primary hover:bg-primary/10"
            >
              {entityAction.label}
            </Link>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// + 仕事を渡す ダイアログ(3点セットが揃わないと送信できない)
// ---------------------------------------------------------------------------

type TransferDraft = {
  content: string;
  recipient_user_id: string;
  recipient_label: string;
  scope: string;
  rationale: string;
  deadline: string;
  priority: string;
};

const EMPTY_TRANSFER_DRAFT: TransferDraft = {
  content: '',
  recipient_user_id: '',
  recipient_label: '',
  scope: '',
  rationale: '',
  deadline: '',
  priority: 'normal',
};

function TransferDialog({
  open,
  onOpenChange,
  boardId,
  orgId,
  recipientOptions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string | null;
  orgId: string;
  recipientOptions: HandoffRecipientOption[];
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState<TransferDraft>(EMPTY_TRANSFER_DRAFT);
  const selectedRecipient = recipientOptions.find(
    (option) => option.id === draft.recipient_user_id,
  );
  const canSelectRecipient = recipientOptions.length > 0;

  const isComplete =
    draft.content.trim().length > 0 &&
    Boolean(selectedRecipient) &&
    draft.scope.trim().length > 0 &&
    draft.rationale.trim().length > 0 &&
    draft.deadline.length > 0;

  // 責任移譲は取消不可。無効ボタンが何で詰まっているかを示し、解消対象を明確にする。
  const missingFields = [
    draft.content.trim().length === 0 ? '件名' : null,
    !selectedRecipient ? '宛先(誰に渡すか)' : null,
    draft.scope.trim().length === 0 ? '①何を(作業の範囲)' : null,
    draft.rationale.trim().length === 0 ? '②なぜ(根拠)' : null,
    draft.deadline.length === 0 ? '③いつまで(期限)' : null,
  ].filter((label): label is string => label !== null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!boardId) throw new Error('ボードが見つかりません');
      const res = await fetch('/api/handoff-board/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          board_id: boardId,
          content: draft.content.trim(),
          priority: draft.priority,
          recipient_user_id: draft.recipient_user_id,
          recipient_label:
            draft.recipient_label.trim() ||
            (selectedRecipient ? `${selectedRecipient.name}(${selectedRecipient.role_label})` : ''),
          lifecycle_status: 'proposed',
          scope: draft.scope.trim(),
          rationale: draft.rationale.trim(),
          deadline: new Date(draft.deadline).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '仕事を渡せませんでした');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('仕事を渡しました。受領確認と根拠が記録されます。');
      setDraft(EMPTY_TRANSFER_DRAFT);
      onOpenChange(false);
      onCreated();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>仕事を渡す</DialogTitle>
          <DialogDescription>
            ハンドオフの3点セット: ①何を(作業の範囲) ②なぜ(根拠) ③いつまで(期限) —
            3つ揃わないと送信できません。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isComplete || createMutation.isPending) return;
            createMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="handoff-transfer-content">件名</Label>
            <Input
              id="handoff-transfer-content"
              value={draft.content}
              onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
              placeholder="例: セット先行準備(施設GH)"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="handoff-transfer-recipient">宛先(誰に渡すか)</Label>
              <Select
                value={draft.recipient_user_id}
                disabled={!canSelectRecipient}
                onValueChange={(value) => {
                  const nextRecipient = recipientOptions.find((option) => option.id === value);
                  setDraft((prev) => ({
                    ...prev,
                    recipient_user_id: value ?? '',
                    recipient_label: nextRecipient
                      ? `${nextRecipient.name}(${nextRecipient.role_label})`
                      : '',
                  }));
                }}
              >
                <SelectTrigger id="handoff-transfer-recipient" className="w-full">
                  <SelectValue placeholder="宛先を選択" />
                </SelectTrigger>
                <SelectContent>
                  {recipientOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}({option.role_label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!canSelectRecipient ? (
                <p className="text-xs text-state-confirm" role="alert">
                  宛先候補を取得できません。アクティブなスタッフ登録を確認してください。
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handoff-transfer-priority">優先度</Label>
              <Select
                value={draft.priority}
                onValueChange={(value) => {
                  if (value) setDraft((prev) => ({ ...prev, priority: value }));
                }}
              >
                <SelectTrigger id="handoff-transfer-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">通常</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="urgent">緊急</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handoff-transfer-scope">①何を(作業の範囲)</Label>
            <Textarea
              id="handoff-transfer-scope"
              value={draft.scope}
              onChange={(event) => setDraft((prev) => ({ ...prev, scope: event.target.value }))}
              placeholder="例: 数量セットまで。最終確認は薬剤師(あなた)"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handoff-transfer-rationale">②なぜ(根拠)</Label>
            <Textarea
              id="handoff-transfer-rationale"
              value={draft.rationale}
              onChange={(event) => setDraft((prev) => ({ ...prev, rationale: event.target.value }))}
              placeholder="例: 判断WIP 18/目安12 — 余白では捌けないため"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="handoff-transfer-deadline">③いつまで(期限)</Label>
            <Input
              id="handoff-transfer-deadline"
              type="datetime-local"
              value={draft.deadline}
              onChange={(event) => setDraft((prev) => ({ ...prev, deadline: event.target.value }))}
            />
          </div>
          {!isComplete && !createMutation.isPending && boardId ? (
            <p
              id="handoff-transfer-missing"
              role="status"
              className="text-xs text-muted-foreground"
            >
              未入力のため渡せません: {missingFields.join('、')}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!isComplete || createMutation.isPending || !boardId || !canSelectRecipient}
              aria-describedby={
                !isComplete && !createMutation.isPending && boardId
                  ? 'handoff-transfer-missing'
                  : undefined
              }
            >
              {createMutation.isPending ? '送信中...' : '渡す(責任を移す)'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 相談一覧 / 相談内容 / 薬剤師の対応(p0_27 薬剤師に相談 / 事務へ戻す)
// ---------------------------------------------------------------------------

/** 薬剤師の対応 3 アクション。確認系=青/緑、戻す=紫(状態色規約)。 */
const RESOLUTION_ACTIONS: {
  action: HandoffResolutionAction;
  buttonClassName: string;
}[] = [
  {
    action: 'acknowledged',
    buttonClassName: 'bg-state-done text-white hover:bg-state-done/90',
  },
  {
    action: 'escalated_to_physician',
    buttonClassName: 'bg-tag-info text-white hover:bg-tag-info/90',
  },
  {
    action: 'returned_to_clerk',
    buttonClassName: 'bg-state-waiting text-white hover:bg-state-waiting/90',
  },
];

function ConsultStatusList({
  counts,
  selectedStatus,
  onSelectStatus,
}: {
  counts: Record<HandoffConsultStatus, number>;
  selectedStatus: HandoffConsultStatus;
  onSelectStatus: (status: HandoffConsultStatus) => void;
}) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-consult-list-heading"
      data-testid="handoff-consult-list"
    >
      <h3 id="handoff-consult-list-heading" className="text-base font-bold text-foreground">
        相談一覧
      </h3>
      <div className="mt-3 space-y-2">
        {CONSULT_STATUS_ORDER.map((status) => {
          const meta = CONSULT_STATUS_META[status];
          const isSelected = status === selectedStatus;
          return (
            <button
              key={status}
              type="button"
              onClick={() => onSelectStatus(status)}
              aria-pressed={isSelected}
              data-testid={`handoff-consult-group-${status}`}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border/70 bg-card hover:bg-muted/50',
              )}
            >
              <span className={cn('text-sm font-bold', meta.labelClassName)}>{meta.label}</span>
              <span className={cn('text-sm font-bold', meta.countClassName)}>
                {counts[status]}件
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConsultDetail({ item }: { item: HandoffBoardItem | null }) {
  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-consult-detail-heading"
      data-testid="handoff-consult-detail"
    >
      <h3 id="handoff-consult-detail-heading" className="text-base font-bold text-foreground">
        相談内容
      </h3>
      {item ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold text-state-confirm">
            {item.created_by_name} から薬剤師へ
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{item.content}</p>
          {item.rationale ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {item.rationale}
            </p>
          ) : null}
          {item.resolution_note ? (
            <div className="mt-2 rounded-md border border-state-waiting/30 bg-state-waiting/10 px-3 py-2 text-sm leading-6 text-state-waiting">
              <span className="font-bold">薬剤師のメモ:</span> {item.resolution_note}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">相談を選択すると内容が表示されます。</p>
      )}
    </section>
  );
}

function ConsultResolutionPanel({
  item,
  orgId,
  onResolved,
}: {
  item: HandoffBoardItem | null;
  orgId: string;
  onResolved: () => void;
}) {
  const [note, setNote] = useState('');
  const [pendingAction, setPendingAction] = useState<HandoffResolutionAction | null>(null);

  const resolveMutation = useMutation({
    mutationFn: async (action: HandoffResolutionAction) => {
      if (!item) throw new Error('相談が選択されていません');
      const res = await fetch(`/api/handoff-board/items/${item.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          resolution_action: action,
          resolution_note: note.trim() ? note.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '対応を記録できませんでした');
      }
      return res.json();
    },
    onSuccess: (_data, action) => {
      toast.success(`「${RESOLUTION_ACTION_LABEL[action]}」を記録しました。`);
      setNote('');
      setPendingAction(null);
      onResolved();
    },
    onError: (err: Error) => {
      setPendingAction(null);
      toast.error(err.message);
    },
  });

  const disabled = !item || resolveMutation.isPending;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-consult-resolution-heading"
      data-testid="handoff-consult-resolution"
    >
      <h3 id="handoff-consult-resolution-heading" className="text-base font-bold text-foreground">
        薬剤師の対応
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {RESOLUTION_ACTIONS.map(({ action, buttonClassName }) => (
          <Button
            key={action}
            type="button"
            className={cn('min-h-[44px]', buttonClassName)}
            disabled={disabled}
            data-testid={`handoff-consult-action-${action}`}
            onClick={() => {
              setPendingAction(action);
              resolveMutation.mutate(action);
            }}
          >
            {resolveMutation.isPending && pendingAction === action
              ? '記録中...'
              : RESOLUTION_ACTION_LABEL[action]}
          </Button>
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="handoff-consult-note" className="sr-only">
          事務へ戻す時のメモ
        </Label>
        <Textarea
          id="handoff-consult-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="事務へ戻す時のメモ"
          rows={4}
          disabled={!item}
          className="resize-none text-sm"
          data-testid="handoff-consult-note"
        />
        <p className="text-xs text-muted-foreground">
          「事務へ戻す」を選ぶ時はメモ(指示内容)が必須です。
        </p>
      </div>
    </section>
  );
}

function ConsultWorkspace({
  items,
  orgId,
  onResolved,
}: {
  items: HandoffBoardItem[];
  orgId: string;
  onResolved: () => void;
}) {
  const consultItems = useMemo(() => consultItemsOf(items), [items]);
  const counts = useMemo(() => countConsultByStatus(consultItems), [consultItems]);
  const [selectedStatus, setSelectedStatus] = useState<HandoffConsultStatus>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => consultItems.filter((item) => item.consult_status === selectedStatus),
    [consultItems, selectedStatus],
  );

  const selectedItem = useMemo(() => {
    const fromSelection = selectedId
      ? (visibleItems.find((item) => item.id === selectedId) ?? null)
      : null;
    return fromSelection ?? visibleItems[0] ?? null;
  }, [visibleItems, selectedId]);

  if (consultItems.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-consult-heading"
      data-testid="handoff-consult-workspace"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="handoff-consult-heading" className="text-base font-bold text-foreground">
          薬剤師に相談 / 事務へ戻す
        </h3>
        <p className="text-xs text-muted-foreground">
          事務員からの相談に薬剤師が対応します。対応は監査ログに記録されます。
        </p>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(240px,300px)]">
        <ConsultStatusList
          counts={counts}
          selectedStatus={selectedStatus}
          onSelectStatus={(status) => {
            setSelectedStatus(status);
            setSelectedId(null);
          }}
        />
        <div className="min-w-0 space-y-3">
          {visibleItems.length > 1 ? (
            <div className="flex flex-wrap gap-2" data-testid="handoff-consult-picker">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={item.id === selectedItem?.id}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    item.id === selectedItem?.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border/70 text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {item.content.slice(0, 16) || '相談'}
                </button>
              ))}
            </div>
          ) : null}
          <ConsultDetail item={selectedItem} />
        </div>
        <ConsultResolutionPanel item={selectedItem} orgId={orgId} onResolved={onResolved} />
      </div>
    </section>
  );
}

function VisitHandoffConfirmationWorkspace({
  orgId,
  tasks,
  isLoading,
  error,
  onConfirmed,
}: {
  orgId: string;
  tasks: HandoffConfirmationTask[];
  isLoading: boolean;
  error: Error | null;
  onConfirmed: () => void;
}) {
  const [selectedVisitRecordId, setSelectedVisitRecordId] = useState<string | null>(null);

  const availableTasks = tasks.filter((task) => Boolean(task.related_entity_id));
  const selectedTask =
    availableTasks.find((task) => task.related_entity_id === selectedVisitRecordId) ??
    availableTasks[0] ??
    null;
  const visitRecordId = selectedTask?.related_entity_id ?? null;

  const visitHandoffQuery = useQuery({
    queryKey: ['visit-handoff', orgId, visitRecordId],
    queryFn: () => {
      if (!visitRecordId) throw new Error('訪問記録が選択されていません');
      return fetchVisitHandoff(orgId, visitRecordId);
    },
    enabled: Boolean(orgId && visitRecordId),
  });

  if (isLoading) {
    return (
      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-label="訪問申し送り確認読み込み中"
      >
        <Skeleton className="h-32 w-full rounded-lg" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="訪問申し送り確認を表示できません"
          description="確認待ちタスクの取得に失敗しました。"
          detail={error.message}
        />
      </section>
    );
  }

  if (availableTasks.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="visit-handoff-confirm-heading"
      data-testid="visit-handoff-confirmation-workspace"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="visit-handoff-confirm-heading" className="text-base font-bold text-foreground">
          訪問申し送り確認
        </h2>
        <p className="text-xs text-muted-foreground">
          訪問記録から抽出された申し送りを確認し、タスクを完了します。
        </p>
      </div>

      {selectedTask ? (
        <p className="mt-3 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-2 text-sm font-medium text-state-confirm">
          {selectedTask.title}
        </p>
      ) : null}

      {availableTasks.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="visit-handoff-task-picker">
          {availableTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setSelectedVisitRecordId(task.related_entity_id)}
              aria-pressed={task.related_entity_id === visitRecordId}
              className={cn(
                'min-h-[44px] rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                task.related_entity_id === visitRecordId
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border/70 text-muted-foreground hover:bg-muted/50',
              )}
            >
              {task.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {visitHandoffQuery.isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : visitHandoffQuery.isError ? (
          <ErrorState
            variant="server"
            title="申し送りを表示できません"
            description="訪問記録の申し送り確認データを取得できませんでした。"
            detail={
              visitHandoffQuery.error instanceof Error ? visitHandoffQuery.error.message : undefined
            }
            action={{ label: '再試行', onClick: () => void visitHandoffQuery.refetch() }}
          />
        ) : visitRecordId && visitHandoffQuery.data ? (
          <HandoffConfirmPanel
            visitRecordId={visitRecordId}
            handoff={visitHandoffQuery.data}
            onConfirmed={onConfirmed}
          />
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="ハンドオフボード読み込み中">
      <div className="space-y-4">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function HandoffWorkspace() {
  const orgId = useOrgId();
  const userId = useAuthStore((state) => state.currentUser.id);
  const queryClient = useQueryClient();
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const isBootstrappingOrg = !orgId;

  const invalidateBoard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['handoff-board'] });
    void queryClient.invalidateQueries({ queryKey: ['nav-badges'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }, [queryClient]);

  const invalidateRelatedBoardCaches = useCallback(
    (event: unknown) => {
      if (!isHandoffBoardInvalidationEvent(event)) return;
      void queryClient.invalidateQueries({ queryKey: ['nav-badges'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'handoff-confirmation', orgId] });
    },
    [orgId, queryClient],
  );

  const boardQuery = useRealtimeQuery({
    queryKey: ['handoff-board', 'workspace', orgId],
    queryFn: () => fetchHandoffBoard(orgId),
    enabled: !isBootstrappingOrg,
    invalidateOn: HANDOFF_BOARD_INVALIDATION_EVENTS,
    fallbackRefetchInterval: 30_000,
    onRealtimeEvent: invalidateRelatedBoardCaches,
  });
  const cockpitQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchOperationCockpit(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
  });
  const confirmationTasksQuery = useQuery({
    queryKey: ['tasks', 'handoff-confirmation', orgId],
    queryFn: () => fetchHandoffConfirmationTasks(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
  });

  const confirmReceiptMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/handoff-board/items/${itemId}/read`, {
        method: 'PATCH',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '受領確認に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['handoff-board'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const now = new Date();
  const board = boardQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;

  const { outgoingItems, incomingItems } = useMemo(() => {
    const items = board?.items ?? [];
    return {
      outgoingItems: items.filter((item) => item.direction === 'outgoing'),
      incomingItems: items.filter((item) => item.direction === 'incoming'),
    };
  }, [board?.items]);

  return (
    <section aria-label="ハンドオフボード" data-testid="handoff-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">ハンドオフ</h1>
          <p className="text-sm text-muted-foreground">
            {buildHeaderMeta(now, board?.summary ?? null)}
          </p>
        </div>
        {/* 主操作(青)はこの 1 つだけ */}
        <Button
          type="button"
          className="min-h-[44px]"
          onClick={() => setTransferDialogOpen(true)}
          data-testid="handoff-open-transfer"
        >
          <Plus className="size-4" aria-hidden="true" />
          仕事を渡す
        </Button>
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || boardQuery.isLoading ? (
          <WorkspaceSkeleton />
        ) : boardQuery.isError || !board ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="ハンドオフを表示できません"
              description="ハンドオフボードの取得に失敗しました。再試行してください。"
              detail={boardQuery.error instanceof Error ? boardQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void boardQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <VisitHandoffConfirmationWorkspace
                orgId={orgId}
                tasks={confirmationTasksQuery.data ?? []}
                isLoading={confirmationTasksQuery.isLoading}
                error={
                  confirmationTasksQuery.isError && confirmationTasksQuery.error instanceof Error
                    ? confirmationTasksQuery.error
                    : null
                }
                onConfirmed={invalidateBoard}
              />
              <ConsultWorkspace items={board.items} orgId={orgId} onResolved={invalidateBoard} />
              <section
                className="rounded-lg border border-border/70 bg-card p-4"
                aria-labelledby="handoff-outgoing-heading"
                data-testid="handoff-outgoing-section"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id="handoff-outgoing-heading" className="text-base font-bold text-foreground">
                    私が渡した
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {outgoingItems.length}件 — 渡す=責任の移動。受領確認と根拠が必ず記録されます
                  </p>
                </div>
                {outgoingItems.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    今日渡した仕事はありません。「+ 仕事を渡す」から3点セット付きで渡せます。
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {outgoingItems.map((item) => (
                      <HandoffItemCard key={item.id} item={item} now={now} viewerUserId={userId} />
                    ))}
                  </div>
                )}
              </section>

              <section
                className="rounded-lg border border-border/70 bg-card p-4"
                aria-labelledby="handoff-incoming-heading"
                data-testid="handoff-incoming-section"
              >
                <h2 id="handoff-incoming-heading" className="text-base font-bold text-foreground">
                  私に来た
                </h2>
                {incomingItems.length === 0 ? (
                  <div
                    role="status"
                    className="mt-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2.5 text-sm font-medium text-muted-foreground"
                    data-testid="handoff-incoming-empty"
                  >
                    受け取り待ちの仕事はありません
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {incomingItems.map((item) => (
                      <HandoffItemCard
                        key={item.id}
                        item={item}
                        now={now}
                        viewerUserId={userId}
                        onConfirmReceipt={(itemId) => confirmReceiptMutation.mutate(itemId)}
                        confirmPending={confirmReceiptMutation.isPending}
                      />
                    ))}
                  </div>
                )}
                <p className="mt-3 rounded-md border border-tag-info/30 bg-tag-info/10 px-3 py-2.5 text-sm leading-6 text-tag-info">
                  事務から薬剤師への依頼(疑義・判断・確認)もここに届きます。口頭やメモではなくハンドオフで渡すのがチームのルールです。
                </p>
              </section>

              <p
                className="rounded-lg border border-tag-info/30 bg-tag-info/10 px-4 py-3 text-sm leading-6 text-tag-info"
                data-testid="handoff-rule-bar"
              >
                <strong className="font-bold">ハンドオフの3点セット:</strong> ①何を(作業の範囲)
                ②なぜ(根拠) ③いつまで(期限) —
                3つ揃わないと送信できません。「言った/聞いてない」をシステムで起こさない設計です。
              </p>
            </div>
            <WorkspaceActionRail
              nextAction={buildWorkspaceNextAction(cockpit)}
              blockedReasons={buildWorkspaceBlockedReasons(cockpit)}
              blockedReasonsEmptyLabel="止まっている作業はありません"
              evidence={buildHandoffEvidence(board)}
              evidenceOpenLabel="開く"
            />
          </div>
        )}
      </div>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        boardId={board?.id ?? null}
        orgId={orgId}
        recipientOptions={board?.recipient_options ?? []}
        onCreated={invalidateBoard}
      />
    </section>
  );
}
