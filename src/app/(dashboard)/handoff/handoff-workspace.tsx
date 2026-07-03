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
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { useAuthStore } from '@/lib/stores/auth-store';
import { hasPermission } from '@/lib/auth/permission-matrix';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
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
  familyNameOf,
  formatTimeOfDay,
  messageItemsOf,
  handoffItemKind,
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
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('ハンドオフボードの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

const HANDOFF_BOARD_INVALIDATION_EVENTS = ['workflow_refresh', 'cycle_transition'] as const;
const COMMUNICATION_WAITING_REQUESTS_HREF = buildCommunicationRequestsHref({ status: 'sent' });

function isHandoffBoardInvalidationEvent(event: unknown) {
  const eventType =
    typeof event === 'object' && event !== null && 'type' in event
      ? (event as { type: string }).type
      : undefined;
  return HANDOFF_BOARD_INVALIDATION_EVENTS.some((type) => type === eventType);
}

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: buildOrgHeaders(orgId),
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
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('訪問申し送り確認タスクの取得に失敗しました');
  const json = (await res.json()) as { data?: HandoffConfirmationTask[] };
  return (json.data ?? []).filter((task) => Boolean(task.related_entity_id));
}

type RecentComment = {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  author_id: string;
  author_name: string;
  mentions_me: boolean;
  authored_by_me: boolean;
  created_at: string;
};

/** コメント対象エンティティの日本語ラベル(やり取りの文脈表示用)。 */
const COMMENT_ENTITY_LABELS: Record<string, string> = {
  dispense_task: '調剤',
  medication_cycle: '処方サイクル',
  set_plan: 'セット',
  visit_record: '訪問記録',
  care_report: '報告書',
  patient: '患者',
};

async function fetchRecentComments(orgId: string): Promise<RecentComment[]> {
  const res = await fetch('/api/comments/recent', {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('やり取りの取得に失敗しました');
  const json = (await res.json()) as { data?: RecentComment[] };
  return json.data ?? [];
}

async function fetchVisitHandoff(orgId: string, visitRecordId: string): Promise<VisitHandoff> {
  const res = await fetch(`/api/visit-records/${visitRecordId}/handoff`, {
    headers: buildOrgHeaders(orgId),
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
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold',
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
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-11 shrink-0 sm:h-11 sm:min-h-[44px]"
          >
            <Link href={COMMUNICATION_WAITING_REQUESTS_HREF}>状況を聞く</Link>
          </Button>
        ) : null}
        {item.direction === 'incoming' && onConfirmReceipt && !isReadByViewer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 sm:h-11 sm:min-h-[44px]"
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
              className="inline-flex min-h-[44px] items-center rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 font-medium text-primary hover:bg-primary/10"
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

// Base UI の閉じた SelectTrigger は既定値ラベルを SSR 解決できず生 enum を出すため表示文言を明示する
const TRANSFER_PRIORITY_LABELS: Record<string, string> = {
  normal: '通常',
  high: '高',
  urgent: '緊急',
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
        headers: buildOrgJsonHeaders(orgId),
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
                  <SelectValue>
                    {(value) => TRANSFER_PRIORITY_LABELS[value as string] ?? value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRANSFER_PRIORITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
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
// やり取り: 各画面に散在するカードコメント(TaskComment)を handoff に読み取り集約
// ---------------------------------------------------------------------------

function HandoffCommentFeed({
  comments,
  isLoading,
  isError,
  onRetry,
}: {
  comments: RecentComment[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  // 自分が関与したコメントが無ければ section ごと出さない(ノイズを足さない)。
  // ただし取得失敗時は「関与なし」と区別できないため隠さず error+再読み込みを出す(false-empty 回避)。
  if (!isLoading && !isError && comments.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-comment-feed-heading"
      data-testid="handoff-comment-feed"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="handoff-comment-feed-heading" className="text-base font-bold text-foreground">
          やり取り
        </h2>
        <p className="text-xs text-muted-foreground">
          各画面のカードコメントのうち、あなた宛・あなたの投稿を集めています。
        </p>
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <ErrorState
          variant="server"
          size="inline"
          description="やり取りを読み込めませんでした。あなた宛のコメントが表示されていない可能性があります。再読み込みしてください。"
          action={{ label: '再読み込み', onClick: onRetry }}
          className="mt-3"
        />
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-testid="handoff-comment-item"
              className="rounded-md border border-border/60 bg-card px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {familyNameOf(comment.author_name)}
                </span>
                <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs">
                  {COMMENT_ENTITY_LABELS[comment.entity_type] ?? comment.entity_type}
                </span>
                {comment.mentions_me ? (
                  <span className="font-semibold text-tag-info">@あなた</span>
                ) : null}
                <span className="ml-auto tabular-nums">{formatTimeOfDay(comment.created_at)}</span>
              </div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {comment.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 連絡(伝言): 3点セット不要の薬局内フリー連絡チャンネル(薬剤師⇔事務)
// ---------------------------------------------------------------------------

function HandoffMessageChannel({
  items,
  boardId,
  orgId,
  recipientOptions,
  viewerUserId,
  onChanged,
}: {
  items: HandoffBoardItem[];
  boardId: string | null;
  orgId: string;
  recipientOptions: HandoffRecipientOption[];
  viewerUserId: string | null;
  onChanged: () => void;
}) {
  const [recipientUserId, setRecipientUserId] = useState('');
  const [content, setContent] = useState('');
  const canSelectRecipient = recipientOptions.length > 0;
  const isComplete = content.trim().length > 0 && Boolean(recipientUserId);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!boardId) throw new Error('ボードが見つかりません');
      const recipient = recipientOptions.find((option) => option.id === recipientUserId);
      const res = await fetch('/api/handoff-board/items', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          board_id: boardId,
          kind: 'message',
          content: content.trim(),
          recipient_user_id: recipientUserId,
          recipient_label: recipient ? `${recipient.name}(${recipient.role_label})` : '',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '連絡を送れませんでした');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('連絡を送りました。');
      setContent('');
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const readMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/handoff-board/items/${itemId}/read`, {
        method: 'PATCH',
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '既読にできませんでした');
      }
      return res.json();
    },
    onSuccess: () => onChanged(),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section
      className="rounded-lg border border-border/70 bg-card p-4"
      aria-labelledby="handoff-message-heading"
      data-testid="handoff-message-channel"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="handoff-message-heading" className="text-base font-bold text-foreground">
          連絡
        </h2>
        <p className="text-xs text-muted-foreground">
          3点セット不要の一言連絡。薬剤師⇔事務で気軽に。受け取りは既読で記録されます。
        </p>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          まだ連絡はありません。下の入力から送れます。
        </p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {items.map((item) => {
            const outgoing = viewerUserId != null && item.created_by === viewerUserId;
            const readByRecipient = item.recipient_user_id
              ? item.read_by.includes(item.recipient_user_id)
              : false;
            const unreadIncoming =
              !outgoing && viewerUserId != null && !item.read_by.includes(viewerUserId);
            return (
              <li
                key={item.id}
                data-testid="handoff-message-item"
                className={cn(
                  'rounded-md border px-3 py-2',
                  unreadIncoming ? 'border-tag-info/40 bg-tag-info/5' : 'border-border/60 bg-card',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {familyNameOf(item.created_by_name)}
                  </span>
                  <span>→ {item.recipient_label ?? item.recipient_name ?? '—'}</span>
                  <span className="ml-auto tabular-nums">{formatTimeOfDay(item.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {item.content}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  {outgoing ? (
                    <span className={readByRecipient ? 'text-state-done' : 'text-muted-foreground'}>
                      {readByRecipient ? '既読' : '未読'}
                    </span>
                  ) : unreadIncoming ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="px-3 text-xs"
                      disabled={readMutation.isPending}
                      onClick={() => readMutation.mutate(item.id)}
                      data-testid="handoff-message-confirm"
                    >
                      確認済みにする
                    </Button>
                  ) : (
                    <span className="text-state-done">確認済み</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="mt-3 space-y-2 border-t border-border/60 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isComplete || sendMutation.isPending) return;
          sendMutation.mutate();
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={recipientUserId}
            disabled={!canSelectRecipient}
            onValueChange={(value) => setRecipientUserId(value ?? '')}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="連絡の宛先">
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
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="例: 14時の鈴木様、保冷剤の準備をお願いします"
            rows={2}
            className="flex-1 resize-none text-sm"
            aria-label="連絡内容"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {!canSelectRecipient ? (
            <p className="text-xs text-state-confirm" role="alert">
              連絡できる宛先がいません。
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!isComplete || sendMutation.isPending || !boardId || !canSelectRecipient}
            data-testid="handoff-message-send"
          >
            {sendMutation.isPending ? '送信中...' : '連絡する'}
          </Button>
        </div>
      </form>
    </section>
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
      className="rounded-lg border border-border/70 bg-card p-4 lg:col-start-1 lg:row-start-1"
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
            <div className="mt-2 rounded-md border-l-4 border-border/70 border-l-state-waiting bg-card px-3 py-2 text-sm leading-6 text-state-waiting">
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
        headers: buildOrgJsonHeaders(orgId),
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
      className="rounded-lg border border-border/70 bg-card p-4 lg:col-start-3 lg:row-start-1"
      aria-labelledby="handoff-consult-resolution-heading"
      data-testid="handoff-consult-resolution"
    >
      <h3 id="handoff-consult-resolution-heading" className="text-base font-bold text-foreground">
        薬剤師の対応
      </h3>
      {item ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {item.created_by_name} から: {item.content}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {RESOLUTION_ACTIONS.map(({ action, buttonClassName }) => (
          <Button
            key={action}
            type="button"
            className={cn(
              'min-h-[44px] min-w-[5.5rem] flex-1 px-2 text-xs sm:h-11 sm:min-h-[44px] sm:flex-none sm:px-4 sm:text-sm',
              buttonClassName,
            )}
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

/** 相談先は薬剤師系ロールに限定する(相談=薬剤師の判断を仰ぐ行為)。 */
const CONSULT_RECIPIENT_ROLES = new Set(['owner', 'admin', 'pharmacist', 'pharmacist_trainee']);

/** 薬剤師に相談を起票する composer(事務→薬剤師)。consult_status='open' で作成する。 */
function ConsultIntake({
  boardId,
  orgId,
  recipientOptions,
  onCreated,
}: {
  boardId: string | null;
  orgId: string;
  recipientOptions: HandoffRecipientOption[];
  onCreated: () => void;
}) {
  const pharmacistOptions = useMemo(
    () => recipientOptions.filter((option) => CONSULT_RECIPIENT_ROLES.has(option.role)),
    [recipientOptions],
  );
  const [recipientUserId, setRecipientUserId] = useState('');
  const [content, setContent] = useState('');
  const canSelectRecipient = pharmacistOptions.length > 0;
  const isComplete = content.trim().length > 0 && Boolean(recipientUserId);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!boardId) throw new Error('ボードが見つかりません');
      const recipient = pharmacistOptions.find((option) => option.id === recipientUserId);
      const res = await fetch('/api/handoff-board/items', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          board_id: boardId,
          consult_status: 'open',
          content: content.trim(),
          recipient_user_id: recipientUserId,
          recipient_label: recipient ? `${recipient.name}(${recipient.role_label})` : '',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '相談を起票できませんでした');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('薬剤師に相談を送りました。');
      setContent('');
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form
      className="mt-3 space-y-2 rounded-md border border-border/60 bg-muted/20 p-3"
      data-testid="handoff-consult-intake"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isComplete || createMutation.isPending) return;
        createMutation.mutate();
      }}
    >
      <p className="text-sm font-semibold text-foreground">薬剤師に相談する</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value={recipientUserId}
          disabled={!canSelectRecipient}
          onValueChange={(value) => setRecipientUserId(value ?? '')}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label="相談先の薬剤師">
            <SelectValue placeholder="相談先の薬剤師" />
          </SelectTrigger>
          <SelectContent>
            {pharmacistOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}({option.role_label})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="例: 同成分薬の重複疑い。用法は妥当か確認をお願いします"
          rows={2}
          className="flex-1 resize-none text-sm"
          aria-label="相談内容"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {!canSelectRecipient ? (
          <p className="text-xs text-state-confirm" role="alert">
            相談できる薬剤師がいません。
          </p>
        ) : (
          <span aria-hidden="true" />
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!isComplete || createMutation.isPending || !boardId || !canSelectRecipient}
          data-testid="handoff-consult-submit"
        >
          {createMutation.isPending ? '送信中...' : '相談する'}
        </Button>
      </div>
    </form>
  );
}

function ConsultWorkspace({
  items,
  orgId,
  boardId,
  recipientOptions,
  onResolved,
}: {
  items: HandoffBoardItem[];
  orgId: string;
  boardId: string | null;
  recipientOptions: HandoffRecipientOption[];
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

  // 相談の「対応」は薬剤師の臨床判断。事務(clerk)は起票・閲覧はできるが対応はできない
  // (API は canAuthorReport でゲート済。ここはその二重防御の表示制御)。
  const viewerRole = useAuthStore((state) => state.currentUser.role);
  const canResolveConsult = viewerRole ? hasPermission(viewerRole, 'canAuthorReport') : false;

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

      <ConsultIntake
        boardId={boardId}
        orgId={orgId}
        recipientOptions={recipientOptions}
        onCreated={onResolved}
      />

      {consultItems.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="handoff-consult-empty">
          未対応の相談はありません。上から薬剤師に相談を送れます。
        </p>
      ) : (
        // DOM 順 = モバイル視覚順(対応→詳細→一覧)。lg は col-start で従来配置(一覧|詳細|対応)を維持
        // (SSOT 4.4: order-* による DOM/視覚順の入替を排除)。
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(240px,300px)]">
          {canResolveConsult ? (
            <ConsultResolutionPanel item={selectedItem} orgId={orgId} onResolved={onResolved} />
          ) : (
            <aside
              className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground lg:col-start-3 lg:row-start-1"
              data-testid="handoff-consult-resolution-readonly"
            >
              相談への対応は薬剤師が行います。事務は起票・確認のみです。
            </aside>
          )}
          <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
            {visibleItems.length > 1 ? (
              <div className="flex flex-wrap gap-2" data-testid="handoff-consult-picker">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={item.id === selectedItem?.id}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
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
          <ConsultStatusList
            counts={counts}
            selectedStatus={selectedStatus}
            onSelectStatus={(status) => {
              setSelectedStatus(status);
              setSelectedId(null);
            }}
          />
        </div>
      )}
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
        <p className="mt-3 rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-sm font-medium text-state-confirm">
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
            onRetry={() => void visitHandoffQuery.refetch()}
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
  const commentsQuery = useQuery({
    queryKey: ['handoff', 'recent-comments', orgId],
    queryFn: () => fetchRecentComments(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
  });

  const confirmReceiptMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/handoff-board/items/${itemId}/read`, {
        method: 'PATCH',
        headers: buildOrgHeaders(orgId),
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
  const cockpit = cockpitQuery.isError ? null : (cockpitQuery.data ?? null);
  const actionRail =
    cockpitQuery.isLoading || cockpitQuery.isError ? (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        {cockpitQuery.isLoading ? (
          <div
            className="space-y-3"
            role="status"
            aria-label="稼働状況を読み込み中"
            data-testid="handoff-action-rail-loading"
          >
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ErrorState
            variant="server"
            title="稼働状況を取得できませんでした"
            description="次にやることと止まっている理由を表示できていません。問題なしではなく取得エラーです。再試行してください。"
            onRetry={() => void cockpitQuery.refetch()}
          />
        )}
      </div>
    ) : (
      <WorkspaceActionRail
        nextAction={buildWorkspaceNextAction(cockpit)}
        blockedReasons={buildWorkspaceBlockedReasons(cockpit)}
        blockedReasonsEmptyLabel="止まっている作業はありません"
        evidence={buildHandoffEvidence(board)}
        evidenceOpenLabel="開く"
      />
    );

  const { outgoingItems, incomingItems, messageItems } = useMemo(() => {
    const items = board?.items ?? [];
    // 伝言(message)は連絡チャンネルで扱い、責任移転/相談の列からは除外する。
    const nonMessage = items.filter((item) => handoffItemKind(item) !== 'message');
    return {
      outgoingItems: nonMessage.filter((item) => item.direction === 'outgoing'),
      incomingItems: nonMessage.filter((item) => item.direction === 'incoming'),
      messageItems: messageItemsOf(items),
    };
  }, [board?.items]);
  const primaryIncomingItem = incomingItems[0] ?? null;
  const remainingIncomingItems = incomingItems.slice(1);

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
          className="h-11 sm:h-11 sm:min-h-[44px]"
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
              onRetry={() => void boardQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
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
                ) : primaryIncomingItem ? (
                  <div className="mt-3 space-y-2">
                    <HandoffItemCard
                      item={primaryIncomingItem}
                      now={now}
                      viewerUserId={userId}
                      onConfirmReceipt={(itemId) => confirmReceiptMutation.mutate(itemId)}
                      confirmPending={confirmReceiptMutation.isPending}
                    />
                    {remainingIncomingItems.length > 0 ? (
                      <details
                        className="rounded-lg border border-border/70 bg-muted/20"
                        data-testid="handoff-incoming-overflow"
                      >
                        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-foreground marker:hidden">
                          <span>残りの受領待ち</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {remainingIncomingItems.length}件
                          </span>
                        </summary>
                        <div className="space-y-2 border-t border-border/70 p-2">
                          {remainingIncomingItems.map((item) => (
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
                      </details>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-3 rounded-md border-l-4 border-border/70 border-l-tag-info bg-card px-3 py-2 text-xs leading-5 text-tag-info">
                  事務からの疑義・判断もここに届き、対応は監査ログに残ります。
                </p>
              </section>

              <HandoffMessageChannel
                items={messageItems}
                boardId={board.id}
                orgId={orgId}
                recipientOptions={board.recipient_options}
                viewerUserId={userId}
                onChanged={invalidateBoard}
              />

              <HandoffCommentFeed
                comments={commentsQuery.data ?? []}
                isLoading={commentsQuery.isLoading}
                isError={commentsQuery.isError}
                onRetry={() => void commentsQuery.refetch()}
              />

              <ConsultWorkspace
                items={board.items}
                orgId={orgId}
                boardId={board.id}
                recipientOptions={board.recipient_options}
                onResolved={invalidateBoard}
              />

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

              <p
                className="rounded-lg border-l-4 border-border/70 border-l-tag-info bg-card px-4 py-3 text-sm leading-6 text-tag-info"
                data-testid="handoff-rule-bar"
              >
                <strong className="font-bold">ハンドオフの3点セット:</strong> ①何を(作業の範囲)
                ②なぜ(根拠) ③いつまで(期限) —
                3つ揃わないと送信できません。「言った/聞いてない」をシステムで起こさない設計です。
              </p>
            </div>
            {actionRail}
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
