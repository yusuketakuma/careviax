'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
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

async function fetchOperationCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション情報の取得に失敗しました');
  const json = await res.json();
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
  recipient_label: string;
  scope: string;
  rationale: string;
  deadline: string;
  priority: string;
};

const EMPTY_TRANSFER_DRAFT: TransferDraft = {
  content: '',
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
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string | null;
  orgId: string;
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState<TransferDraft>(EMPTY_TRANSFER_DRAFT);

  const isComplete =
    draft.content.trim().length > 0 &&
    draft.recipient_label.trim().length > 0 &&
    draft.scope.trim().length > 0 &&
    draft.rationale.trim().length > 0 &&
    draft.deadline.length > 0;

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
          recipient_label: draft.recipient_label.trim(),
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
              <Input
                id="handoff-transfer-recipient"
                value={draft.recipient_label}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, recipient_label: event.target.value }))
                }
                placeholder="例: 鈴木さん(事務)"
              />
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
          <DialogFooter>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!isComplete || createMutation.isPending || !boardId}
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
    buttonClassName: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
  {
    action: 'escalated_to_physician',
    buttonClassName: 'bg-blue-600 text-white hover:bg-blue-700',
  },
  {
    action: 'returned_to_clerk',
    buttonClassName: 'bg-violet-600 text-white hover:bg-violet-700',
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
          <p className="text-sm font-bold text-amber-700">{item.created_by_name} から薬剤師へ</p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{item.content}</p>
          {item.rationale ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {item.rationale}
            </p>
          ) : null}
          {item.resolution_note ? (
            <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm leading-6 text-violet-800">
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

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function WorkspaceSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]"
      role="status"
      aria-label="ハンドオフボード読み込み中"
    >
      <div className="space-y-4">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

type HandoffWorkspaceProps = {
  focus?: 'handoff' | 'consult';
};

export function HandoffWorkspace({ focus = 'handoff' }: HandoffWorkspaceProps = {}) {
  const orgId = useOrgId();
  const userId = useAuthStore((state) => state.currentUser.id);
  const queryClient = useQueryClient();
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const isBootstrappingOrg = !orgId;

  const boardQuery = useQuery({
    queryKey: ['handoff-board', 'workspace', orgId],
    queryFn: () => fetchHandoffBoard(orgId),
    enabled: !isBootstrappingOrg,
    refetchInterval: 30_000,
  });
  const cockpitQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchOperationCockpit(orgId),
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

  const invalidateBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['handoff-board'] });
    void queryClient.invalidateQueries({ queryKey: ['nav-badges', 'handoff'] });
  };

  const showConsultOnly = focus === 'consult';

  return (
    <section
      aria-label={showConsultOnly ? '相談対応ワークスペース' : 'ハンドオフボード'}
      data-testid="handoff-workspace"
    >
      {!showConsultOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-bold text-foreground">ハンドオフ</h2>
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
      ) : null}

      <div className={showConsultOnly ? '' : 'mt-4'}>
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
          <div
            className={
              showConsultOnly
                ? 'min-h-[calc(100vh-6rem)]'
                : 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]'
            }
          >
            <div className="min-w-0 space-y-4">
              <ConsultWorkspace items={board.items} orgId={orgId} onResolved={invalidateBoard} />
              {!showConsultOnly ? (
                <>
                  <section
                    className="rounded-lg border border-border/70 bg-card p-4"
                    aria-labelledby="handoff-outgoing-heading"
                    data-testid="handoff-outgoing-section"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3
                        id="handoff-outgoing-heading"
                        className="text-base font-bold text-foreground"
                      >
                        私が渡した
                      </h3>
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
                          <HandoffItemCard
                            key={item.id}
                            item={item}
                            now={now}
                            viewerUserId={userId}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  <section
                    className="rounded-lg border border-border/70 bg-card p-4"
                    aria-labelledby="handoff-incoming-heading"
                    data-testid="handoff-incoming-section"
                  >
                    <h3
                      id="handoff-incoming-heading"
                      className="text-base font-bold text-foreground"
                    >
                      私に来た
                    </h3>
                    {incomingItems.length === 0 ? (
                      <p
                        className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700"
                        data-testid="handoff-incoming-empty"
                      >
                        なし — 受け取り待ちはありません
                      </p>
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
                    <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm leading-6 text-blue-800">
                      事務から薬剤師への依頼(疑義・判断・確認)もここに届きます。口頭やメモではなくハンドオフで渡すのがチームのルールです。
                    </p>
                  </section>

                  <p
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800"
                    data-testid="handoff-rule-bar"
                  >
                    <strong className="font-bold">ハンドオフの3点セット:</strong> ①何を(作業の範囲)
                    ②なぜ(根拠) ③いつまで(期限) —
                    3つ揃わないと送信できません。「言った/聞いてない」をシステムで起こさない設計です。
                  </p>
                </>
              ) : null}
            </div>
            {!showConsultOnly ? (
              <div className="space-y-4">
                <WorkspaceActionRail
                  nextAction={buildWorkspaceNextAction(cockpit)}
                  blockedReasons={buildWorkspaceBlockedReasons(cockpit)}
                  blockedReasonsEmptyLabel="止まっている作業はありません"
                  evidence={buildHandoffEvidence(board)}
                  evidenceOpenLabel="開く"
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        boardId={board?.id ?? null}
        orgId={orgId}
        onCreated={invalidateBoard}
      />
    </section>
  );
}
