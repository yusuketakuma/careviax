'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  canApproveCounts,
  familyName,
  findNextCountTarget,
  formatAgeMinutesLabel,
  formatDueTime,
  formatRemainingLabel,
  judgeCountRow,
  type CountEntryState,
  type DispenseWorkbenchData,
  type WorkbenchCountRow,
} from '@/app/(dashboard)/dispensing/dispense-workbench.shared';

/**
 * design/images/new 08_audit: 3 ペインの監査ワークベンチ。
 * 左=私の監査キュー / 中央=監査詳細(二人制バナー → 計数テーブル(麻薬ダブルカウント)
 * → 工程チップ → 合格/差戻しの二択)/ 右=右レール。
 * - 二人制: 調剤実施者と監査者(ログインユーザー)の同一人監査はサーバー側でも拒否される。
 * - 麻薬ダブルカウント: 計数 1 回目 / 2 回目がすべて調剤実績量と一致(差異ゼロ)で合格可能。
 *   計数値は承認/差戻し時に AuditLog(dispense_audit_double_count)として記録する。
 * 旧 DataTable キューと詳細ページ(/auditing/[taskId]: 保留・緊急例外承認)は下部・別ページに温存。
 */

// ── Queue types(/api/dispense-audits)──

type AuditQueueRow = {
  id: string;
  priority: string;
  due_date: string | null;
  facility_label: string | null;
  is_overdue: boolean;
  cycle: {
    id: string;
    case_: { patient: { id: string; name: string } };
    prescription_intakes: Array<{
      id: string;
      lines: Array<{ id: string; packaging_instruction_tags?: string[] }>;
    }>;
  };
  results: Array<{
    id: string;
    dispensed_at: string;
    line: { id: string; packaging_instruction_tags?: string[] };
  }>;
};

const QUEUE_VISIBLE_ROWS = 3;

function rowHasNarcotic(row: AuditQueueRow): boolean {
  const lineTags = row.cycle.prescription_intakes[0]?.lines ?? [];
  return (
    row.results.some((result) => result.line.packaging_instruction_tags?.includes('narcotic')) ||
    lineTags.some((line) => line.packaging_instruction_tags?.includes('narcotic'))
  );
}

function auditQueueBadge(row: AuditQueueRow): { label: string; className: string } {
  if (rowHasNarcotic(row)) {
    return { label: '麻薬', className: 'border-red-300 bg-red-50 font-semibold text-red-700' };
  }
  if (row.priority === 'emergency') {
    return { label: '緊急', className: 'border-red-300 bg-red-50 text-red-700' };
  }
  if (row.priority === 'urgent') {
    return { label: '至急', className: 'border-amber-300 bg-amber-50 text-amber-700' };
  }
  return { label: '通常', className: 'border-border bg-muted text-muted-foreground' };
}

function queueRowTitle(row: AuditQueueRow): string {
  const facility =
    row.facility_label && row.facility_label !== '自宅訪問' ? `(${row.facility_label})` : '';
  return `${row.cycle.case_.patient.name} 様${facility}`;
}

const REJECT_OPTIONS = [
  { code: 'drug_name_mismatch', label: '薬剤間違い' },
  { code: 'quantity_error', label: '数量間違い(計数不一致)' },
  { code: 'packaging_error', label: '包装指示違反' },
  { code: 'carry_type_error', label: '持参区分誤り' },
  { code: 'labeling_error', label: 'ラベル不備' },
  { code: 'other', label: 'その他' },
] as const;

function WorkbenchCard({ children, className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-lg border border-border/70 bg-card p-4', className)}
      {...props}
    >
      {children}
    </section>
  );
}

// ── 左ペイン: 私の監査キュー ──

function AuditQueuePanel({
  rows,
  totalCount,
  teamTotal,
  selectedTaskId,
  selectedSubline,
  onSelect,
  isLoading,
}: {
  rows: AuditQueueRow[];
  totalCount: number;
  teamTotal: number | null;
  selectedTaskId: string | null;
  selectedSubline: string | null;
  onSelect: (taskId: string) => void;
  isLoading: boolean;
}) {
  const visibleRows = rows.slice(0, QUEUE_VISIBLE_ROWS);
  const collapsedCount = totalCount - QUEUE_VISIBLE_ROWS;
  const teamSubline =
    teamTotal != null
      ? teamTotal > totalCount
        ? `チーム全体では${teamTotal}件 — 詰まり工程`
        : `チーム全体では${teamTotal}件`
      : null;

  return (
    <WorkbenchCard aria-label="私の監査キュー" data-testid="audit-queue-panel">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-bold text-foreground">私の監査キュー</h3>
        <span className="text-sm text-muted-foreground">{totalCount}件・期限順</span>
      </div>
      {isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">監査待ちはありません。</p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {visibleRows.map((row) => {
            const isSelected = row.id === selectedTaskId;
            const badge = auditQueueBadge(row);
            const dueTime = formatDueTime(row.due_date);
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
                  data-testid="audit-queue-row"
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
                      {queueRowTitle(row)}
                    </span>
                    {dueTime ? (
                      <span className="shrink-0 text-xs font-bold text-red-600">
                        期限{dueTime}
                      </span>
                    ) : null}
                  </span>
                  {isSelected && selectedSubline ? (
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {selectedSubline}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {collapsedCount > 0 ? (
            <li>
              <div
                className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5"
                data-testid="audit-queue-collapsed-row"
              >
                <span className="flex items-center gap-2">
                  <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    通常
                  </span>
                  <span className="text-sm font-bold text-foreground">ほか{collapsedCount}件</span>
                </span>
                {teamSubline ? (
                  <span className="mt-1 block text-xs text-muted-foreground">{teamSubline}</span>
                ) : null}
              </div>
            </li>
          ) : null}
        </ul>
      )}
    </WorkbenchCard>
  );
}

// ── 中央: 計数テーブル ──

const JUDGEMENT_BADGES = {
  match: { label: '一致', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  mismatch: { label: '不一致', className: 'border-red-300 bg-red-50 text-red-700' },
} as const;

function CountTable({
  rows,
  counts,
  onCountChange,
  registerInput,
}: {
  rows: WorkbenchCountRow[];
  counts: CountEntryState;
  onCountChange: (lineId: string, slot: 'first' | 'second', value: number | null) => void;
  registerInput: (key: string, element: HTMLInputElement | null) => void;
}) {
  return (
    <Table className="mt-3" data-testid="audit-count-table">
      <TableHeader>
        <TableRow>
          <TableHead>薬剤</TableHead>
          <TableHead className="w-20">処方</TableHead>
          <TableHead className="w-24">計数(調剤者)</TableHead>
          <TableHead className="w-28">計数 1回目</TableHead>
          <TableHead className="w-28">計数 2回目</TableHead>
          <TableHead className="w-20">判定</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const entry = counts[row.line_id] ?? { first: null, second: null };
          const judgement = judgeCountRow(row.dispensed_quantity, entry.first, entry.second);
          const judgementBadge =
            judgement === 'pending' ? null : JUDGEMENT_BADGES[judgement];
          return (
            <TableRow
              key={row.line_id}
              className={cn(row.is_narcotic && 'bg-red-50/60 hover:bg-red-50')}
              data-testid="audit-count-row"
            >
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">{row.drug_name}</span>
                  {row.tags.map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                        getHandlingTagBadgeClass(tag),
                      )}
                    >
                      {getHandlingTagLabel(tag)}
                    </span>
                  ))}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">{row.prescribed_label}</TableCell>
              <TableCell className="tabular-nums">{row.dispensed_label ?? '—'}</TableCell>
              {(['first', 'second'] as const).map((slot) => (
                <TableCell key={slot}>
                  <span className="flex items-center gap-1">
                    <Input
                      ref={(element) => registerInput(`${row.line_id}-${slot}`, element)}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={entry[slot] ?? ''}
                      placeholder="入力中…"
                      onChange={(event) => {
                        const raw = event.target.value;
                        const parsed = Number.parseFloat(raw);
                        onCountChange(
                          row.line_id,
                          slot,
                          raw === '' || Number.isNaN(parsed) ? null : parsed,
                        );
                      }}
                      aria-label={`${row.drug_name} 計数${slot === 'first' ? '1回目' : '2回目'}`}
                      className="h-8 w-16 text-right tabular-nums"
                    />
                    {row.unit ? (
                      <span className="text-xs text-muted-foreground">{row.unit}</span>
                    ) : null}
                  </span>
                </TableCell>
              ))}
              <TableCell>
                {judgementBadge ? (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                      judgementBadge.className,
                    )}
                  >
                    {judgementBadge.label}
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

export function AuditWorkbench() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [counts, setCounts] = React.useState<CountEntryState>({});
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');
  const [rejectDetail, setRejectDetail] = React.useState('');
  const inputRefs = React.useRef(new Map<string, HTMLInputElement>());

  const queueQuery = useRealtimeQuery({
    queryKey: ['dispense-audits', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dispense-audits', { headers: { 'x-org-id': orgId } });
      if (!res.ok) throw new Error('監査キューの取得に失敗しました');
      return res.json() as Promise<{ data: AuditQueueRow[] }>;
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
      if (!res.ok) throw new Error('監査ワークベンチの取得に失敗しました');
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

  // 選択タスクが変わったら計数入力を初期化(件をまたいで持ち越さない)
  const [countsTaskId, setCountsTaskId] = React.useState(activeTaskId);
  if (countsTaskId !== activeTaskId) {
    setCountsTaskId(activeTaskId);
    setCounts({});
  }

  const auditMutation = useMutation({
    mutationFn: async (payload: {
      result: 'approved' | 'rejected';
      reject_reason?: string;
      reject_reason_code?: string;
      reject_detail?: string;
    }) => {
      if (!workbench) throw new Error('ワークベンチ情報が未取得です');
      const doubleCount = workbench.count_rows.map((row) => ({
        line_id: row.line_id,
        drug_name: row.drug_name,
        dispensed_quantity: row.dispensed_quantity,
        first_count: counts[row.line_id]?.first ?? null,
        second_count: counts[row.line_id]?.second ?? null,
      }));
      const res = await fetch('/api/dispense-audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          task_id: workbench.task.id,
          ...payload,
          double_count: doubleCount,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '監査の登録に失敗しました');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.result === 'approved' ? '合格 — セットへ送りました' : '差戻しました');
      setRejectOpen(false);
      setRejectReason('');
      setRejectDetail('');
      setSelectedTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ['dispense-audits', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['dispense-workbench'] });
    },
    onError: (err: Error) => {
      toast.error('エラー', { description: err.message });
    },
  });

  const countRows = workbench?.count_rows ?? [];
  const approvable = canApproveCounts(countRows, counts) && !(workbench?.is_self_audit ?? false);
  const hasMismatch = countRows.some(
    (row) =>
      judgeCountRow(
        row.dispensed_quantity,
        counts[row.line_id]?.first ?? null,
        counts[row.line_id]?.second ?? null,
      ) === 'mismatch',
  );
  const nextTarget = findNextCountTarget(countRows, counts);

  const registerInput = React.useCallback((key: string, element: HTMLInputElement | null) => {
    if (element) {
      inputRefs.current.set(key, element);
    } else {
      inputRefs.current.delete(key);
    }
  }, []);

  const focusNextTarget = React.useCallback(() => {
    if (!nextTarget) return;
    const element = inputRefs.current.get(`${nextTarget.row.line_id}-${nextTarget.slot}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element?.focus();
  }, [nextTarget]);

  // ── 右レール ──
  const cockpit = cockpitQuery.data ?? null;
  const blockedReasons: BlockedReason[] = (cockpit?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category ?? undefined,
    ageLabel: formatAgeMinutesLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));

  const remainingRows = countRows.filter(
    (row) =>
      judgeCountRow(
        row.dispensed_quantity,
        counts[row.line_id]?.first ?? null,
        counts[row.line_id]?.second ?? null,
      ) !== 'match',
  );
  const nextAction: NextActionPanelProps | undefined = workbench
    ? nextTarget
      ? {
          actionLabel: `${nextTarget.slot === 'first' ? '1回目' : '2回目'}の計数を入力する`,
          onAction: focusNextTarget,
          description:
            remainingRows.length === 1
              ? `${remainingRows[0].drug_name.split(/\s+/)[0]}のみ残っています。合格でセット工程へ自動で渡ります。`
              : `残り${remainingRows.length}品目の計数を入力します。合格でセット工程へ自動で渡ります。`,
        }
      : {
          actionLabel: '差異ゼロを確認して合格 — セットへ',
          onAction: () => auditMutation.mutate({ result: 'approved' }),
          actionDisabled: !approvable || auditMutation.isPending,
          description: hasMismatch
            ? '計数に不一致があります。差戻し(理由必須)で調剤へ返します。'
            : '計数がすべて一致しました。合格でセット工程へ自動で渡ります。',
        }
    : undefined;

  const evidence: EvidenceItem[] = workbench
    ? [
        ...(workbench.dispenser
          ? [
              {
                id: 'dispense-record',
                label: `調剤記録(${familyName(workbench.dispenser.name)})`,
                meta: workbench.dispenser.time_label ?? undefined,
                href: `/dispensing/${workbench.task.id}`,
              },
            ]
          : []),
        ...(workbench.has_narcotic
          ? [
              {
                id: 'narcotic-ledger',
                label: '麻薬管理簿',
                meta: '残数照合済',
                href: '/admin/drug-stock',
              },
            ]
          : []),
        ...(workbench.stock_check_date_label
          ? [
              {
                id: 'stocktake',
                label: '棚卸し',
                meta: workbench.stock_check_date_label,
                href: '/admin/drug-stock',
              },
            ]
          : []),
      ]
    : [];

  // ── 中央ヘッダーの組み立て ──
  const rxNumber =
    workbench?.intake != null
      ? formatPrescriptionCardNumber(workbench.intake.id, workbench.intake.prescribed_date, 'rx_year')
      : null;
  const dueTime = formatDueTime(workbench?.task.due_date ?? null);
  const remainingLabel = formatRemainingLabel(workbench?.task.due_date ?? null);
  const selectedSubline = workbench?.dispenser
    ? `調剤: ${familyName(workbench.dispenser.name)} ${workbench.dispenser.time_label ?? ''} 完了`.replace(/\s+/g, ' ')
    : null;

  const dateLabel = format(new Date(), 'M/d(EEE)', { locale: ja });
  const guardText = workbench?.has_narcotic
    ? '麻薬は2回目の計数が終わるまで合格できません'
    : '計数(1回目・2回目)がすべて一致すると合格できます';

  return (
    <section aria-label="監査ワークベンチ" data-testid="audit-workbench">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xl font-bold text-foreground">監査</h2>
        <p className="text-sm text-muted-foreground">
          {dateLabel} — 止める勇気の画面・合格か差戻しの二択
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_minmax(250px,280px)] xl:items-start">
        {/* 左: 私の監査キュー */}
        <AuditQueuePanel
          rows={queueRows}
          totalCount={queueRows.length}
          teamTotal={workbench?.team_audit_total ?? null}
          selectedTaskId={activeTaskId}
          selectedSubline={selectedSubline}
          onSelect={setSelectedTaskId}
          isLoading={!orgId || queueQuery.isLoading}
        />

        {/* 中央: 監査詳細 */}
        <WorkbenchCard aria-label="監査詳細" data-testid="audit-now-card" className="min-w-0">
          {!activeTaskId ? (
            <p className="text-sm text-muted-foreground">
              監査待ちはありません。調剤が完了すると、ここに監査対象が表示されます。
            </p>
          ) : workbenchQuery.isLoading || !workbench ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-base font-bold text-foreground">
                    {workbench.has_narcotic ? '麻薬監査' : '監査'} — {workbench.patient.name} 様
                    {rxNumber ? ` ${rxNumber}` : ''}
                  </h3>
                  {dueTime ? (
                    <span className="text-xs text-muted-foreground">
                      期限 {dueTime}
                      {remainingLabel ? ` — ${remainingLabel}` : ''}
                    </span>
                  ) : null}
                </div>
                {workbench.has_narcotic ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                    麻薬: ダブルカウント必須
                  </span>
                ) : null}
              </div>

              {/* 二人制バナー */}
              {workbench.dispenser ? (
                workbench.is_self_audit ? (
                  <div
                    className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50/70 px-3 py-2.5 text-sm"
                    data-testid="two-person-banner-self"
                  >
                    <span className="inline-flex items-center rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                      二人制
                    </span>
                    <span className="font-medium text-red-700">
                      ご自身が調剤した処方のため、この監査はできません(別の薬剤師に依頼してください)
                    </span>
                  </div>
                ) : (
                  <div
                    className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2.5 text-sm"
                    data-testid="two-person-banner"
                  >
                    <span className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                      二人制 <Check className="size-3" aria-hidden="true" />
                    </span>
                    <span className="font-medium text-foreground">
                      調剤: {familyName(workbench.dispenser.name)}
                      {workbench.dispenser.time_label ? `(${workbench.dispenser.time_label})` : ''}
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                    <span className="font-medium text-foreground">
                      監査: {familyName(workbench.auditor.name)}(あなた)
                    </span>
                    <span className="ml-auto text-xs text-emerald-800/80">
                      同一人による監査はシステム上できません
                    </span>
                  </div>
                )
              ) : (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  調剤実績が未登録です。調剤工程の完了後に計数監査ができます。
                </p>
              )}

              {/* 計数テーブル(麻薬ダブルカウント) */}
              <CountTable
                rows={countRows}
                counts={counts}
                onCountChange={(lineId, slot, value) =>
                  setCounts((prev) => ({
                    ...prev,
                    [lineId]: {
                      first: prev[lineId]?.first ?? null,
                      second: prev[lineId]?.second ?? null,
                      [slot]: value,
                    },
                  }))
                }
                registerInput={registerInput}
              />

              {/* 工程チップ + 確定メッセージ */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                  監査
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <span className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                  セット 15分
                </span>
                {workbench.visit_time_label ? (
                  <>
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                    <span className="inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                      {workbench.visit_time_label} 訪問
                    </span>
                  </>
                ) : null}
                <span className="ml-2 text-sm font-medium text-emerald-700">
                  合格すると午後の予定がすべて確定します
                </span>
              </div>

              {/* アクション行: 合格 / 差戻しの二択 */}
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <Button
                  type="button"
                  className="min-h-[44px]"
                  disabled={!approvable || auditMutation.isPending}
                  onClick={() => auditMutation.mutate({ result: 'approved' })}
                  data-testid="audit-approve-button"
                >
                  {auditMutation.isPending ? '送信中...' : '差異ゼロを確認して合格 — セットへ'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setRejectOpen(true)}
                  disabled={auditMutation.isPending}
                  data-testid="audit-reject-button"
                >
                  差戻し(理由必須)
                </Button>
                {!approvable ? (
                  <span className="ml-auto text-xs text-muted-foreground">{guardText}</span>
                ) : null}
              </div>
            </>
          )}
        </WorkbenchCard>

        {/* 右: 右レール */}
        <WorkspaceActionRail
          nextAction={nextAction}
          blockedReasons={blockedReasons}
          blockedReasonsEmptyLabel="止まっている作業はありません"
          evidence={evidence}
          evidenceOpenLabel="開く"
        />
      </div>

      {/* 差戻し(理由必須)ダイアログ */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>差戻し(理由必須)</DialogTitle>
            <DialogDescription>
              差戻すと調剤工程へ戻り、担当者に通知されます。理由の記録は必須です。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="audit-reject-reason">
                理由コード <span className="text-destructive">*</span>
              </Label>
              <Select value={rejectReason} onValueChange={(value) => setRejectReason(value ?? '')}>
                <SelectTrigger id="audit-reject-reason">
                  <SelectValue placeholder="理由を選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {REJECT_OPTIONS.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audit-reject-detail">補足テキスト</Label>
              <Textarea
                id="audit-reject-detail"
                value={rejectDetail}
                onChange={(event) => setRejectDetail(event.target.value)}
                placeholder="具体的な差戻し内容を入力してください"
                className="min-h-[88px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectReason.length === 0 || auditMutation.isPending}
              onClick={() => {
                const option = REJECT_OPTIONS.find((candidate) => candidate.code === rejectReason);
                auditMutation.mutate({
                  result: 'rejected',
                  reject_reason: option?.label ?? rejectReason,
                  reject_reason_code: rejectReason,
                  reject_detail: rejectDetail.trim() || undefined,
                });
              }}
            >
              {auditMutation.isPending ? '送信中...' : '差戻しを確定する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
