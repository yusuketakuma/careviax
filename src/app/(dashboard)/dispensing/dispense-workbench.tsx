'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SafetyBoard } from '@/components/features/workspace/safety-board';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  buildChangeBadge,
  buildDispenseQueueSubline,
  buildPausedLabel,
  familyName,
  formatAgeMinutesLabel,
  formatDueTime,
  type DispenseWorkbenchData,
} from './dispense-workbench.shared';

/**
 * design/images/new 07_dispense: 3 ペインの調剤ワークベンチ。
 * 左=調剤キュー / 中央=いまの1件(セーフティボード → 処方比較 → 確認チェックリスト → 主操作)
 * / 右=右レール(次にやること / 止まっている理由 / 根拠・記録)。
 * 1件集中・割り込み防護: この画面はキューの自動切替を行わず、選択中の 1 件だけを表示する。
 * 旧 DataTable キューと明細ページ(/dispensing/[taskId])は下部・別ページに温存。
 */

// ── Queue types(/api/dispense-queue)──

type DispenseQueueRow = {
  id: string;
  priority: string;
  due_date: string | null;
  status: string;
  cycle: {
    id: string;
    overall_status: string;
    case_: { patient: { id: string; name: string } };
  };
};

const QUEUE_VISIBLE_ROWS = 4;

function queueBadge(row: DispenseQueueRow): { label: string; className: string } {
  if (row.cycle.overall_status === 'inquiry_resolved') {
    return { label: '再開', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' };
  }
  if (row.priority === 'emergency') {
    return { label: '緊急', className: 'border-red-300 bg-red-50 text-red-700' };
  }
  if (row.priority === 'urgent') {
    return { label: '至急', className: 'border-amber-300 bg-amber-50 text-amber-700' };
  }
  return { label: '通常', className: 'border-border bg-muted text-muted-foreground' };
}

function WorkbenchCard({
  children,
  className,
  ...props
}: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-lg border border-border/70 bg-card p-4', className)}
      {...props}
    >
      {children}
    </section>
  );
}

// ── 左ペイン: 調剤キュー ──

function DispenseQueuePanel({
  rows,
  totalCount,
  selectedTaskId,
  selectedHasInquiryChange,
  onSelect,
  isLoading,
}: {
  rows: DispenseQueueRow[];
  totalCount: number;
  selectedTaskId: string | null;
  selectedHasInquiryChange: boolean;
  onSelect: (taskId: string) => void;
  isLoading: boolean;
}) {
  const visibleRows = rows.slice(0, QUEUE_VISIBLE_ROWS);
  const collapsedCount = totalCount - (QUEUE_VISIBLE_ROWS - 1);

  return (
    <WorkbenchCard aria-label="調剤キュー" data-testid="dispense-queue-panel">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-bold text-foreground">調剤キュー</h3>
        <span className="text-sm text-muted-foreground">{totalCount}件</span>
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">調剤待ちはありません。</p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {visibleRows.map((row, index) => {
            const isSelected = row.id === selectedTaskId;
            const isAggregatedRow = index === QUEUE_VISIBLE_ROWS - 1 && totalCount > QUEUE_VISIBLE_ROWS;
            const badge = queueBadge(row);
            const subline = isAggregatedRow
              ? `ほか${collapsedCount}件`
              : buildDispenseQueueSubline({
                  overallStatus: row.cycle.overall_status,
                  hasInquiryChange: isSelected ? selectedHasInquiryChange : undefined,
                });
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border/70 bg-card hover:bg-muted/40',
                  )}
                  data-testid="dispense-queue-row"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                      {row.cycle.case_.patient.name} 様
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {subline}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WorkbenchCard>
  );
}

// ── 中央ペイン: いまの1件 ──

type ChecklistItem = { id: string; label: string };

function buildChecklistItems(workbench: DispenseWorkbenchData | null): ChecklistItem[] {
  const changedRow = workbench?.comparison.find((row) => row.change_type != null) ?? null;
  const changeBadge = changedRow ? buildChangeBadge(changedRow) : null;
  const changeSuffix =
    changedRow && changeBadge ? `(${changeBadge.label}: ${changedRow.drug_name.split(/\s+/)[0]})` : '';
  return [
    { id: 'readback', label: `変更点を口頭読み上げで確認${changeSuffix}` },
    { id: 'renal', label: '腎機能と用量の整合を確認' },
    { id: 'count_first', label: '計数 — 1回目(自分)' },
    { id: 'unit_dose_print', label: '一包化の印字(氏名・用法・日付)を確認' },
  ];
}

const CHANGE_BADGE_TONES: Record<'amber' | 'red' | 'blue' | 'neutral', string> = {
  amber: 'text-amber-700',
  red: 'text-red-700',
  blue: 'text-blue-700',
  neutral: 'text-muted-foreground',
};

function ComparisonTable({ workbench }: { workbench: DispenseWorkbenchData }) {
  if (workbench.comparison.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">処方明細はまだ取り込まれていません。</p>
    );
  }
  return (
    <Table className="mt-3" data-testid="dispense-comparison-table">
      <TableHeader>
        <TableRow>
          <TableHead>薬剤</TableHead>
          <TableHead className="w-32">前回</TableHead>
          <TableHead className="w-32">今回</TableHead>
          <TableHead>差</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workbench.comparison.map((row) => {
          const badge = buildChangeBadge(row);
          const isChanged = row.change_type != null;
          return (
            <TableRow
              key={row.key}
              className={cn(isChanged && 'bg-amber-50/70 hover:bg-amber-50')}
            >
              <TableCell className="font-medium text-foreground">{row.drug_name}</TableCell>
              <TableCell className="text-muted-foreground">{row.previous_label ?? '—'}</TableCell>
              <TableCell className={cn(isChanged && 'font-bold text-foreground')}>
                {row.current_label ?? '—'}
              </TableCell>
              <TableCell>
                {badge ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn('text-sm font-bold', CHANGE_BADGE_TONES[badge.tone])}>
                      {badge.label}
                    </span>
                    {row.inquiry_origin ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                        照会回答による変更
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── メイン ──

export function DispenseWorkbench() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [guardOn, setGuardOn] = React.useState(true);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [interruptOpen, setInterruptOpen] = React.useState(false);
  const [interruptReason, setInterruptReason] = React.useState('');

  const queueQuery = useRealtimeQuery({
    queryKey: ['dispense-queue', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dispense-queue', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('調剤キューの取得に失敗しました');
      return res.json() as Promise<{ data: DispenseQueueRow[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
    invalidateOn: ['cycle_transition'],
  });

  const queueRows = React.useMemo(() => queueQuery.data?.data ?? [], [queueQuery.data]);
  const activeTaskId = selectedTaskId ?? queueRows[0]?.id ?? null;

  const workbenchQuery = useQuery({
    queryKey: ['dispense-workbench', activeTaskId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/dispense-tasks/${activeTaskId}/workbench`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('調剤ワークベンチの取得に失敗しました');
      return res.json() as Promise<DispenseWorkbenchData>;
    },
    enabled: !!orgId && !!activeTaskId,
  });

  const cockpitQuery = useQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/cockpit', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('右レール集計の取得に失敗しました');
      const json = await res.json();
      return json.data as DashboardCockpitResponse;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const workbench = workbenchQuery.data ?? null;

  // 選択タスクが変わったらチェックリストを初期化(1件集中: 件をまたいで持ち越さない)
  const [checklistTaskId, setChecklistTaskId] = React.useState(activeTaskId);
  if (checklistTaskId !== activeTaskId) {
    setChecklistTaskId(activeTaskId);
    setChecked({});
  }

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!workbench) throw new Error('ワークベンチ情報が未取得です');
      if (workbench.count_rows.some((row) => row.prescribed_quantity == null)) {
        throw new Error('数量未確定の明細があります。詳細入力から登録してください。');
      }
      const res = await fetch('/api/dispense-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          task_id: workbench.task.id,
          safety_checklist: DISPENSE_SAFETY_CHECKLIST_ACK,
          lines: workbench.count_rows.map((row) => ({
            line_id: row.line_id,
            actual_drug_name: row.drug_name,
            actual_quantity: row.prescribed_quantity ?? 0,
            actual_unit: row.unit || undefined,
            carry_type: 'carry' as const,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '調剤実績の登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('調剤完了', { description: '監査へ送りました' });
      setSelectedTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ['dispense-queue', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['dispense-workbench'] });
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const interruptMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error('対象タスクがありません');
      const res = await fetch(`/api/dispense-tasks/${activeTaskId}/workbench`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ action: 'interrupt', reason: interruptReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '中断の記録に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('中断を記録しました', { description: '止まっている理由に追加されました' });
      setInterruptOpen(false);
      setInterruptReason('');
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const checklistItems = buildChecklistItems(workbench);
  const allChecked = checklistItems.every((item) => checked[item.id]);
  const hasInquiryChange =
    workbench?.comparison.some((row) => row.inquiry_origin && row.change_type != null) ?? false;

  const pausedLabel = workbench?.resolved_inquiry
    ? buildPausedLabel(workbench.resolved_inquiry.inquired_at, workbench.resolved_inquiry.resolved_at)
    : null;

  // ── 右レール ──
  const cockpit = cockpitQuery.data ?? null;
  const topAudit = cockpit?.audit_queue[0] ?? null;
  const nextAction: NextActionPanelProps | undefined = topAudit
    ? (() => {
        const dueTime = formatDueTime(topAudit.due_at);
        const visit = cockpit?.today_visits.find(
          (candidate) => candidate.patient_name === topAudit.patient_name && candidate.time_start,
        );
        const visitTime = visit?.time_start ? formatDueTime(visit.time_start) : null;
        return {
          actionLabel: `${topAudit.has_narcotic ? '麻薬監査' : '監査'}を開始${dueTime ? ` — ${dueTime}期限` : ''}`,
          actionHref: '/auditing',
          description: visitTime
            ? `${visitTime}訪問(${familyName(topAudit.patient_name)}様)の持参薬です。完了で午後の予定がすべて確定します。`
            : '完了で午後の予定がすべて確定します。',
        };
      })()
    : undefined;

  const blockedReasons: BlockedReason[] = (cockpit?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category ?? undefined,
    ageLabel: formatAgeMinutesLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));

  const evidence: EvidenceItem[] = [
    ...(workbench?.resolved_inquiry
      ? [
          {
            id: 'inquiry-response',
            label: '照会回答',
            meta: [
              formatDueTime(workbench.resolved_inquiry.resolved_at),
              workbench.resolved_inquiry.institution,
            ]
              .filter(Boolean)
              .join(' '),
            href: '/communications/requests',
          },
        ]
      : []),
    ...(workbench?.previous_intake
      ? [
          {
            id: 'previous-dispense',
            label: '前回の調剤記録',
            meta: format(new Date(workbench.previous_intake.prescribed_date), 'M/d'),
            href: `/patients/${workbench.patient.id}?view=profile&tab=medications`,
          },
        ]
      : []),
  ];

  const dateLabel = format(new Date(), 'M/d(EEE)', { locale: ja });

  return (
    <section aria-label="調剤ワークベンチ" data-testid="dispense-workbench">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-bold text-foreground">調剤</h2>
        <p className="text-sm text-muted-foreground">{dateLabel} — 1件集中・割り込み防護</p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_minmax(250px,280px)] xl:items-start">
        {/* 左: 調剤キュー */}
        <DispenseQueuePanel
          rows={queueRows}
          totalCount={queueRows.length}
          selectedTaskId={activeTaskId}
          selectedHasInquiryChange={hasInquiryChange}
          onSelect={setSelectedTaskId}
          isLoading={!orgId || queueQuery.isLoading}
        />

        {/* 中央: いまの1件 */}
        <div className="min-w-0 space-y-3">
          <WorkbenchCard aria-label="いまの1件" data-testid="dispense-now-card">
            {!activeTaskId ? (
              <p className="text-sm text-muted-foreground">
                調剤キューが空です。処方の取込が完了すると、ここに「いまの1件」が表示されます。
              </p>
            ) : workbenchQuery.isLoading || !workbench ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-base font-bold text-foreground">
                      いまの1件 — {workbench.patient.name} 様
                    </h3>
                    {pausedLabel ? (
                      <span className="text-xs text-muted-foreground">{pausedLabel}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setGuardOn((prev) => !prev)}
                    aria-pressed={guardOn}
                    className={cn(
                      'inline-flex min-h-7 items-center rounded-full px-3 py-1 text-xs font-bold transition-colors',
                      guardOn
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-muted text-muted-foreground',
                    )}
                    data-testid="interrupt-guard-toggle"
                  >
                    割り込み防護 {guardOn ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* セーフティボード(危険タグは隠さない) */}
                <SafetyBoard
                  className="mt-3"
                  allergy={workbench.safety.allergy ?? undefined}
                  renal={workbench.safety.renal ?? undefined}
                  handlingTags={workbench.safety.handling_tags}
                  swallowing={workbench.safety.swallowing ?? undefined}
                  cautions={workbench.safety.cautions}
                />

                {/* 処方比較(前回 / 今回 / 差) */}
                <ComparisonTable workbench={workbench} />

                {/* 確認チェックリスト */}
                <ul className="mt-4 space-y-3" data-testid="dispense-checklist">
                  {checklistItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-3">
                      <Checkbox
                        id={`dispense-check-${item.id}`}
                        checked={checked[item.id] ?? false}
                        onCheckedChange={(value) =>
                          setChecked((prev) => ({ ...prev, [item.id]: value === true }))
                        }
                        aria-label={item.label}
                      />
                      <label
                        htmlFor={`dispense-check-${item.id}`}
                        className="cursor-pointer select-none text-sm leading-6 text-foreground"
                      >
                        {item.label}
                      </label>
                    </li>
                  ))}
                </ul>

                {/* アクション行(主操作は 1 つだけ青) */}
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                  <Button
                    type="button"
                    className="min-h-[44px]"
                    onClick={() => {
                      if (!allChecked) {
                        toast.warning('確認チェックリストを全て確認してください');
                        return;
                      }
                      completeMutation.mutate();
                    }}
                    disabled={completeMutation.isPending}
                    data-testid="dispense-complete-button"
                  >
                    {completeMutation.isPending ? '送信中...' : '調剤を完了して監査へ送る'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-[44px]"
                    onClick={() => setInterruptOpen(true)}
                  >
                    中断(理由必須)
                  </Button>
                  <Link
                    href={`/patients/${workbench.patient.id}`}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'ml-auto text-primary',
                    )}
                  >
                    → カードへ
                  </Link>
                </div>
              </>
            )}
          </WorkbenchCard>

          {/* 割り込み防護の注記バー */}
          <p
            className="rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-2.5 text-sm leading-6 text-blue-900"
            data-testid="interrupt-guard-note"
          >
            割り込み防護: この1件が終わるまで、新しい依頼は通知のみで画面は切り替わりません。緊急(赤)だけは例外です。
          </p>
        </div>

        {/* 右: 右レール */}
        <WorkspaceActionRail
          nextAction={nextAction}
          blockedReasons={blockedReasons}
          blockedReasonsEmptyLabel="止まっている作業はありません"
          evidence={evidence}
          evidenceOpenLabel="開く"
        />
      </div>

      {/* 中断(理由必須)ダイアログ */}
      <Dialog open={interruptOpen} onOpenChange={setInterruptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>調剤を中断する</DialogTitle>
            <DialogDescription>
              中断には理由の記録が必須です。記録した理由は「止まっている理由」に表示されます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dispense-interrupt-reason">
              中断理由 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="dispense-interrupt-reason"
              value={interruptReason}
              onChange={(event) => setInterruptReason(event.target.value)}
              placeholder="例: 在庫不足のため発注待ち"
              className="min-h-[88px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInterruptOpen(false)}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={interruptReason.trim().length === 0 || interruptMutation.isPending}
              onClick={() => interruptMutation.mutate()}
            >
              {interruptMutation.isPending ? '記録中...' : '中断を記録する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
