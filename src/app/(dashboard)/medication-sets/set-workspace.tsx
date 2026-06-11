'use client';

import { useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { PackageOpen } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FilterChipBar,
  type FilterChipOption,
} from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import {
  buildDailyOpsBlockedReasons,
  buildDailyOpsNextAction,
  formatDailyOpsTime,
} from '@/lib/workspace/daily-ops-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  SET_ROW_STATUS_PRESENTATIONS,
  formatSlotMarks,
  type SetPendingItem,
  type SetSlotKey,
  type SetSlotMark,
  type SetWorkspaceFacilityGroup,
  type SetWorkspaceResponse,
  type SetWorkspaceRow,
  type SetWorkspaceScope,
} from './set-workspace.shared';

/**
 * new_09_set: 訪問単位・施設グルーピングのセット準備ワークスペース
 * (docs/design-gap-analysis-new.md 09_set)。
 * 施設グループ見出し帯(進捗バー+レーンチップ)→ 居室別セット作業テーブル
 * (居室/患者/朝昼夕/状態/担当)→ 工程待ちのセット + 右レール 3 点セットの構成。
 * 物理の画面: カート・トレイと 1 対 1 対応。
 */

const SCOPE_OPTIONS: Array<FilterChipOption<SetWorkspaceScope>> = [
  { value: 'today', label: '本日分' },
  { value: 'upcoming', label: '明日以降' },
];

const SLOT_KEYS: SetSlotKey[] = ['morning', 'noon', 'evening'];

async function fetchSetWorkspace(
  orgId: string,
  scope: SetWorkspaceScope,
): Promise<SetWorkspaceResponse> {
  const res = await fetch(`/api/medication-sets/workspace?scope=${scope}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('セット作業ワークスペースの取得に失敗しました');
  const json = await res.json();
  return json.data;
}

async function fetchCockpit(orgId: string): Promise<DashboardCockpitResponse> {
  const res = await fetch('/api/dashboard/cockpit', {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('当日オペレーション状態の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

// ---------------------------------------------------------------------------
// 行の集約(104〜110 ほか6名 進行中 6/6 着手)
// ---------------------------------------------------------------------------

export type AggregatedSetRows = {
  detailed: SetWorkspaceRow[];
  aggregate: {
    room_label: string;
    patient_label: string;
    slots: Record<SetSlotKey, SetSlotMark>;
    status_label: string;
    assignee_label: string | null;
  } | null;
};

/**
 * 居室順の行リストの末尾に「進行中/着手前」の連続区間が 2 行以上あれば
 * 1 行へ集約する(09_set の「104〜110 / ほか6名 / 進行中 6/6 着手」表現)。
 */
export function aggregateSetRows(rows: SetWorkspaceRow[]): AggregatedSetRows {
  let suffixStart = rows.length;
  while (
    suffixStart > 0 &&
    (rows[suffixStart - 1].status === 'in_progress' || rows[suffixStart - 1].status === 'waiting')
  ) {
    suffixStart -= 1;
  }
  const suffix = rows.slice(suffixStart);
  if (suffix.length < 2) {
    return { detailed: rows, aggregate: null };
  }

  const roomLabels = suffix
    .map((row) => row.room_label)
    .filter((label): label is string => label != null);
  const roomLabel =
    roomLabels.length >= 2 ? `${roomLabels[0]}〜${roomLabels[roomLabels.length - 1]}` : '—';
  const startedCount = suffix.filter((row) => row.status !== 'waiting').length;
  const slots: Record<SetSlotKey, SetSlotMark> = {
    morning: 'none',
    noon: 'none',
    evening: 'none',
  };
  for (const slot of SLOT_KEYS) {
    const marks = suffix.map((row) => row.slots[slot]);
    if (marks.every((mark) => mark === 'set')) slots[slot] = 'set';
    else if (marks.some((mark) => mark !== 'none')) slots[slot] = 'partial';
  }
  const assignee =
    suffix.map((row) => row.assignee_label).find((label) => label != null) ?? null;

  return {
    detailed: rows.slice(0, suffixStart),
    aggregate: {
      room_label: roomLabel,
      patient_label: `ほか${suffix.length}名`,
      slots,
      status_label: `進行中 ${startedCount}/${suffix.length} 着手`,
      assignee_label: assignee,
    },
  };
}

/** 居室番号の昇順(数値優先)で並べる。 */
export function sortRowsByRoom(rows: SetWorkspaceRow[]): SetWorkspaceRow[] {
  return [...rows].sort((left, right) => {
    const leftRoom = left.room_label ?? '';
    const rightRoom = right.room_label ?? '';
    const leftNumber = Number.parseInt(leftRoom, 10);
    const rightNumber = Number.parseInt(rightRoom, 10);
    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return leftRoom.localeCompare(rightRoom, 'ja');
  });
}

// ---------------------------------------------------------------------------
// 施設グループカード
// ---------------------------------------------------------------------------

/** レーンチップ(件数の常時表示)。麻薬・冷所は危険区分のため色付きで隠さない。 */
function LaneChips({ group }: { group: SetWorkspaceFacilityGroup }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="レーン別件数">
      <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
        通常レーン <span className="tabular-nums">{group.lane_counts.normal}</span>
      </span>
      <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50/60 px-3.5 text-sm font-semibold text-cyan-700">
        冷所レーン <span className="tabular-nums">{group.lane_counts.cold}</span>
      </span>
      <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-red-300 bg-red-50/60 px-3.5 text-sm font-semibold text-red-700">
        麻薬レーン <span className="tabular-nums">{group.lane_counts.narcotic}</span>(施錠保管)
      </span>
    </div>
  );
}

function SlotMarksCell({ slots }: { slots: Record<SetSlotKey, SetSlotMark> }) {
  return (
    <span
      className="whitespace-nowrap text-sm tabular-nums text-foreground"
      aria-label={`朝 ${slots.morning === 'set' ? 'セット済' : slots.morning === 'partial' ? '一部' : '未'} / 昼 ${slots.noon === 'set' ? 'セット済' : slots.noon === 'partial' ? '一部' : '未'} / 夕 ${slots.evening === 'set' ? 'セット済' : slots.evening === 'partial' ? '一部' : '未'}`}
    >
      {formatSlotMarks(slots)}
    </span>
  );
}

function FacilityGroupCard({ group }: { group: SetWorkspaceFacilityGroup }) {
  const { detailed, aggregate } = aggregateSetRows(sortRowsByRoom(group.rows));
  const progressPercent =
    group.total_count > 0 ? Math.round((group.completed_count / group.total_count) * 100) : 0;
  const timeLabel = group.visit_time ? `${formatDailyOpsTime(group.visit_time)}訪問分` : '訪問分';

  return (
    <section
      aria-labelledby={`set-facility-${group.facility_id}`}
      className="rounded-lg border border-border/70 bg-card p-4"
      data-testid="set-facility-group"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3
          id={`set-facility-${group.facility_id}`}
          className="text-base font-bold text-foreground"
        >
          施設{group.facility_name} — {timeLabel}
        </h3>
        <p className="text-xs text-muted-foreground">
          {group.completed_count}/{group.total_count}{' '}
          完了・事務が許可済みの範囲で先行準備中(数量セットまで・最終確認は薬剤師)
        </p>
        <div
          role="progressbar"
          aria-label="セット完了の進捗"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="ml-auto h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <LaneChips group={group} />

      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">居室</TableHead>
            <TableHead>患者</TableHead>
            <TableHead className="w-28">朝/昼/夕</TableHead>
            <TableHead className="w-36">状態</TableHead>
            <TableHead className="w-32">担当</TableHead>
            <TableHead className="w-36">
              <span className="sr-only">アクション</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detailed.map((row) => {
            const presentation = SET_ROW_STATUS_PRESENTATIONS[row.status];
            return (
              <TableRow
                key={row.patient_id}
                className={cn(presentation.rowClassName)}
                data-testid="set-workspace-row"
              >
                <TableCell className="text-sm tabular-nums text-foreground">
                  {row.room_label ?? '—'}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {row.patient_name} 様
                    </span>
                    {row.has_allergy ? (
                      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        アレルギー
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <SlotMarksCell slots={row.slots} />
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                      presentation.badgeClassName,
                    )}
                  >
                    {presentation.label}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-foreground">
                  {row.assignee_label ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  {row.status === 'quantity_check' ? (
                    <Link
                      href="/handoff"
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'whitespace-nowrap text-primary',
                      })}
                    >
                      → ハンドオフへ
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {aggregate ? (
            <TableRow data-testid="set-workspace-aggregate-row">
              <TableCell className="text-sm tabular-nums text-foreground">
                {aggregate.room_label}
              </TableCell>
              <TableCell className="text-sm font-medium text-foreground">
                {aggregate.patient_label}
              </TableCell>
              <TableCell>
                <SlotMarksCell slots={aggregate.slots} />
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  {aggregate.status_label}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {aggregate.assignee_label ?? '—'}
              </TableCell>
              <TableCell />
            </TableRow>
          ) : null}
          <TableRow data-testid="set-workspace-final-check-row">
            <TableCell className="text-sm text-muted-foreground">—</TableCell>
            <TableCell className="text-sm font-medium text-foreground">
              薬剤師の最終確認
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">—</TableCell>
            <TableCell>
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                事務完了後
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-sm text-foreground">
              {group.final_check_assignee ?? '—'}
            </TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 工程待ちのセット
// ---------------------------------------------------------------------------

const PENDING_BADGE_CLASSES: Record<SetPendingItem['kind'], string> = {
  audit_waiting: 'bg-violet-100 text-violet-700',
  preworkable: 'bg-slate-100 text-slate-600',
};

const PENDING_META_CLASSES: Record<SetPendingItem['kind'], string> = {
  audit_waiting: 'text-violet-600',
  preworkable: 'text-emerald-600',
};

function PendingSetsCard({ items }: { items: SetPendingItem[] }) {
  return (
    <section
      aria-labelledby="set-pending-heading"
      className="rounded-lg border border-border/70 bg-card p-4"
      data-testid="set-pending-card"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id="set-pending-heading" className="text-base font-bold text-foreground">
          工程待ちのセット
        </h3>
        <p className="text-xs text-muted-foreground">{items.length}件</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          監査待ち・先行可能なセットはいまありません。
        </p>
      ) : (
        <ul className="mt-3 space-y-2" role="list">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border/70 bg-background px-3 py-2.5"
              data-testid="set-pending-item"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    PENDING_BADGE_CLASSES[item.kind],
                  )}
                >
                  {item.badge_label}
                </span>
                <p className="min-w-0 flex-1 text-sm font-bold text-foreground">{item.title}</p>
                {item.meta_label ? (
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold',
                      PENDING_META_CLASSES[item.kind],
                    )}
                  >
                    {item.meta_label}
                  </span>
                ) : null}
                <Link
                  href={item.action_href}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                    className: 'shrink-0 whitespace-nowrap text-primary',
                  })}
                >
                  {item.action_label}
                </Link>
              </div>
              {item.subtitle ? (
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{item.subtitle}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function SetWorkspaceSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]"
      role="status"
      aria-label="セット作業ワークスペース読み込み中"
    >
      <div className="space-y-4">
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function SetWorkspace() {
  const orgId = useOrgId();
  const [scope, setScope] = useState<SetWorkspaceScope>('today');
  const isBootstrappingOrg = !orgId;

  const workspaceQuery = useRealtimeQuery({
    queryKey: ['medication-sets', 'workspace', scope, orgId],
    queryFn: () => fetchSetWorkspace(orgId, scope),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });
  const cockpitQuery = useRealtimeQuery({
    queryKey: ['dashboard', 'cockpit', orgId],
    queryFn: () => fetchCockpit(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = workspaceQuery.data ?? null;
  const cockpit = cockpitQuery.data ?? null;
  const dateLabel = `${format(now, 'M/d(EEE)', { locale: ja })} — 物理の画面: カート・トレイと1対1対応`;

  const evidence: EvidenceItem[] = [
    {
      id: 'cart-map',
      label: '配薬カート対応表',
      meta: `${data?.evidence.cart_map_count ?? 0}件`,
      href: '/medication-sets/full',
    },
    {
      id: 'set-photos',
      label: 'セット写真',
      href: '/medication-sets/full',
    },
    {
      id: 'cold-storage-log',
      label: '冷所温度ログ',
      meta: data?.evidence.cold_storage_log_status ?? undefined,
      href: '/workflow',
    },
  ];

  return (
    <section aria-label="セット準備ワークスペース" data-testid="set-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">セット</h2>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        <FilterChipBar
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={setScope}
          ariaLabel="対象日の切替"
        />
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || workspaceQuery.isLoading ? (
          <SetWorkspaceSkeleton />
        ) : workspaceQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="セット作業を表示できません"
              description="セット作業ワークスペースの取得に失敗しました。再試行してください。"
              detail={
                workspaceQuery.error instanceof Error ? workspaceQuery.error.message : undefined
              }
              action={{ label: '再試行', onClick: () => void workspaceQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
            <div className="min-w-0 space-y-4">
              {data.facility_groups.length > 0 ? (
                data.facility_groups.map((group) => (
                  <FacilityGroupCard key={group.facility_id} group={group} />
                ))
              ) : (
                <div className="rounded-lg border border-border/70 bg-card p-4">
                  <EmptyState
                    icon={PackageOpen}
                    title={
                      scope === 'today'
                        ? '本日分の施設セットはありません'
                        : '明日以降の施設セットはまだありません'
                    }
                    description="施設訪問の予定に紐づくセット作業が入ると、居室別の作業表がここに表示されます。"
                  />
                </div>
              )}
              <PendingSetsCard items={data.pending_items} />
            </div>

            {/* 右レール: 次にやること / 止まっている理由 / 根拠・記録 */}
            <div className="space-y-4">
              <WorkspaceActionRail
                nextAction={buildDailyOpsNextAction(cockpit, {
                  actionLabel: 'セット監査を始める',
                  actionHref: '/medication-sets',
                  description: 'いま期限で止まっている監査はありません。',
                })}
                blockedReasons={buildDailyOpsBlockedReasons(cockpit)}
                blockedReasonsEmptyLabel="止まっている作業はありません"
                evidence={evidence}
                evidenceOpenLabel="開く"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
