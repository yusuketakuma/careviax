'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarDays,
  GitCompare,
  MessageSquareWarning,
  PauseCircle,
  Search,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import {
  SafetyTagBadge,
  selectVisibleSafetyTags,
} from '@/components/features/patients/safety-tag-badge';
import { ProcessProgressDots } from '@/components/features/workspace/process-chips';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { PROCESS_STEPS_9 } from '@/lib/prescription/cycle-workspace';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { buildPatientHref } from '@/lib/patient/navigation';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { buildDailyOpsBlockedReasons } from '@/lib/workspace/daily-ops-rail';
import { cn } from '@/lib/utils';
import type {
  PatientAttentionKey,
  PatientBoardCard,
  PatientBoardCardFilter,
  PatientBoardPageResponse,
  PatientBoardResponse,
  PatientFoundationIssueKey,
  PatientBoardSort,
  PatientStatusTone,
} from '@/types/patient-board';
import { PatientBoardLoadingShell } from './patient-board-loading';

/**
 * new_02_patient_list の患者カード一覧(docs/design-gap-analysis-new.md)。
 * ヘッダー(担当トグル)→ フィルタチップ行 → 患者カードグリッド(単一カラム全幅, sm:2 / xl:3 / 2xl:4 列)。
 * 「次にやること / 止まっている理由 / 根拠・記録」は inline 右レールではなく WorkspaceActionRail の
 * Sheet ドロワー(右スライド)で開く。ローディング skeleton も同じ単一カラム全幅に合わせる。
 * カードの色 = いま必要な対応(左ライン/バッジ)。危険タグは隠さない。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

export async function fetchPatientBoard(
  orgId: string,
  scope: 'mine' | 'all',
  foundationIssue?: BoardFoundationIssue,
  query?: string,
  options: {
    cardFilter?: PatientBoardCardFilter;
    sort?: PatientBoardSort;
    limit?: number;
    cursor?: string | null;
  } = {},
): Promise<PatientBoardPageResponse> {
  const params = new URLSearchParams({ scope });
  if (foundationIssue) params.set('foundation_issue', foundationIssue);
  const trimmedQuery = query?.trim();
  if (trimmedQuery) params.set('q', trimmedQuery);
  if (options.cardFilter && options.cardFilter !== 'all') {
    params.set('card_filter', options.cardFilter);
  }
  if (options.sort && options.sort !== 'priority') {
    params.set('sort', options.sort);
  }
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const res = await fetch(`/api/patients/board?${params}`, {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<PatientBoardPageResponse>(res, '患者一覧の取得に失敗しました');
}

type BoardScope = 'mine' | 'all';
type BoardViewMode = 'card' | 'list';
type BoardFoundationIssue = 'needs_confirmation' | PatientFoundationIssueKey;

const SCOPE_OPTIONS: Array<{ value: BoardScope; label: string }> = [
  { value: 'mine', label: '私の担当' },
  { value: 'all', label: '全員' },
];

const SORT_OPTIONS: Array<{ value: PatientBoardSort; label: string }> = [
  { value: 'priority', label: '対応が必要な順' },
  { value: 'next_visit', label: '訪問が近い順' },
  { value: 'name', label: '氏名順' },
];

const VIEW_MODE_OPTIONS: Array<{ value: BoardViewMode; label: string }> = [
  { value: 'card', label: 'カード' },
  { value: 'list', label: 'リスト' },
];

const PATIENT_BOARD_PAGE_LIMIT = 60;
const PATIENT_BOARD_WORKFLOW_SOURCES = [
  'patients_board',
  'patient_detail_edit',
  'visit_record',
  'initial_visit_record',
  'visit_preparation_put',
  'visit_preparations_update',
  'visit_schedules_create',
  'visit_schedules_update',
  'visit_schedules_delete',
  'visit_schedules_reschedule_request',
  'visit_schedules_reschedule_approve',
  'visit_schedules_reopen',
  'visit_schedule_conflict_reconfirmation',
  'visit_schedule_proposals_create',
  'visit_schedule_proposals_approve',
  'visit_schedule_proposals_reject',
  'visit_schedule_proposals_contact_attempt',
  'visit_schedule_proposals_confirm',
  'facility_visit_batches_upsert',
] as const;

/** フィルタチップ。「今すぐ対応」=既定(優先順で全件表示)、他は絞り込み。 */
// wait_release は summaryTile「再開できる」専用の絞り込み(tile-only)。下段 chipOptions には出さない。
type BoardChipValue =
  | 'priority'
  | 'wait_release'
  | 'external'
  | 'visit_today'
  | 'foundation_gap'
  | 'foundation_contact_gap'
  | 'foundation_consent_plan_gap'
  | 'foundation_care_team_gap'
  | 'foundation_parking_gap'
  | 'foundation_care_level_gap'
  | 'foundation_insurance_gap'
  | 'paused';

type AttentionPresentation = {
  label: string;
  accentClass: string;
  badgeClass: string;
};

/**
 * 「いま必要な対応」(attention) → 6 軸セマンティックロール。
 * 今すぐ対応=blocked(止まっている/緊急, 赤) / 待ち解除=done(再開可, 緑) /
 * 受入判断・確認中=confirm(要確認, 橙) / 本日訪問=info(予定, 青) /
 * 外部待ち・返信待ち=waiting(他者待ち, 紫) / 順調・休止中=neutral(状態色なし)。
 * accent/badge は globals.css の state/tag 系中央トークンから導出する。
 */
const ATTENTION_ROLES: Record<PatientAttentionKey, StatusRole | 'neutral'> = {
  urgent_now: 'blocked',
  wait_release: 'done',
  acceptance: 'confirm',
  visit_today: 'info',
  external_wait: 'waiting',
  checking: 'confirm',
  reply_wait: 'waiting',
  steady: 'neutral',
  paused: 'neutral',
};

const ATTENTION_LABELS: Record<PatientAttentionKey, string> = {
  urgent_now: '今すぐ対応',
  wait_release: '待ち解除',
  acceptance: '受入判断',
  visit_today: '本日訪問',
  external_wait: '外部待ち',
  checking: '確認中',
  reply_wait: '返信待ち',
  steady: '順調',
  paused: '休止中',
};

function buildAttentionPresentation(key: PatientAttentionKey): AttentionPresentation {
  const role = ATTENTION_ROLES[key];
  const label = ATTENTION_LABELS[key];
  if (role === 'neutral') {
    return {
      label,
      accentClass: 'bg-muted-foreground/30',
      badgeClass: 'bg-muted text-foreground ring-1 ring-border',
    };
  }
  const spec = STATUS_TOKENS[role];
  return { label, accentClass: spec.dotClassName, badgeClass: spec.badgeClassName };
}

const ATTENTION_PRESENTATIONS: Record<PatientAttentionKey, AttentionPresentation> = {
  urgent_now: buildAttentionPresentation('urgent_now'),
  wait_release: buildAttentionPresentation('wait_release'),
  acceptance: buildAttentionPresentation('acceptance'),
  visit_today: buildAttentionPresentation('visit_today'),
  external_wait: buildAttentionPresentation('external_wait'),
  checking: buildAttentionPresentation('checking'),
  reply_wait: buildAttentionPresentation('reply_wait'),
  steady: buildAttentionPresentation('steady'),
  paused: buildAttentionPresentation('paused'),
};

/** status_text の文字色 → 6 軸トークン(critical=blocked / positive=done / caution=confirm /
 * info=info タグ / external=waiting / neutral=状態色なし)。 */
const STATUS_TONE_CLASSES: Record<PatientStatusTone, string> = {
  critical: 'font-bold text-foreground',
  positive: 'font-semibold text-foreground',
  caution: 'font-semibold text-foreground',
  info: 'font-medium text-foreground',
  external: 'font-semibold text-foreground',
  neutral: 'text-foreground/80',
};

function getFoundationIssueForChip(chip: BoardChipValue): BoardFoundationIssue | undefined {
  if (chip === 'foundation_gap') return 'needs_confirmation';
  if (chip === 'foundation_contact_gap') return 'missing_contact';
  if (chip === 'foundation_consent_plan_gap') return 'missing_consent_plan';
  if (chip === 'foundation_care_team_gap') return 'missing_care_team';
  if (chip === 'foundation_parking_gap') return 'missing_parking';
  if (chip === 'foundation_care_level_gap') return 'missing_care_level';
  if (chip === 'foundation_insurance_gap') return 'missing_insurance';
  return undefined;
}

function getCardFilterForChip(chip: BoardChipValue): PatientBoardCardFilter {
  if (chip === 'wait_release') return 'wait_release';
  if (chip === 'external') return 'external';
  if (chip === 'visit_today') return 'visit_today';
  if (chip === 'paused') return 'paused';
  return 'all';
}

/**
 * 情報基盤の整備状況コールアウト → ready=done(緑) / needs_confirmation=confirm(橙) / missing=blocked(赤)。
 * 全面塗りは引き算し、状態色は左ボーダー(ACCENT) + ラベル(TEXT)のみに限定する
 * (SSOT 色「状態色の塗り面積を最小化する」)。
 */
const FOUNDATION_STATUS_ACCENT: Record<
  NonNullable<PatientBoardCard['foundation_summary']>['status'],
  string
> = {
  ready: 'border-l-state-done',
  needs_confirmation: 'border-l-state-confirm',
  missing: 'border-l-state-blocked',
};

const FOUNDATION_STATUS_TEXT: Record<
  NonNullable<PatientBoardCard['foundation_summary']>['status'],
  string
> = {
  ready: 'text-state-done',
  needs_confirmation: 'text-state-confirm',
  missing: 'text-state-blocked',
};

// 安全タグの選定・バッジは共通実装へ集約(FEBRUSH A5)。テスト互換のため再エクスポートする。
export { selectVisibleSafetyTags } from '@/components/features/patients/safety-tag-badge';

type SummaryTile = {
  key: string;
  label: string;
  value: string;
  description: string;
  chip: BoardChipValue;
  icon: LucideIcon;
  // 全面塗りは引き算し、状態色は左ボーダー(className) + ラベル(labelClassName)のみに限定する
  // (SSOT 色「状態色の塗り面積を最小化する」/ globals.css の --state-*・--tag-*)。
  className: string;
  labelClassName: string;
};

/** 次回訪問の表示(本日 14:00 / 6/13(土) 10:00 / 退院連絡待ち)。 */
export function formatNextVisitLabel(card: PatientBoardCard, now: Date): string {
  if (!card.next_visit_date) return card.next_visit_label ?? '未定';
  const [year, month, day] = card.next_visit_date.split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const dateLabel = isToday ? '本日' : format(date, 'M/d(EEE)', { locale: ja });
  return card.next_visit_time ? `${dateLabel} ${card.next_visit_time}` : dateLabel;
}

function mergePatientBoardPages(pages: PatientBoardPageResponse[]): PatientBoardResponse | null {
  const firstPage = pages[0] ?? null;
  if (!firstPage) return null;
  const lastPage = pages[pages.length - 1] ?? firstPage;
  const seen = new Set<string>();
  const cards: PatientBoardCard[] = [];
  for (const page of pages) {
    for (const card of page.data) {
      if (seen.has(card.patient_id)) continue;
      seen.add(card.patient_id);
      cards.push(card);
    }
  }
  return {
    cards,
    chip_counts: firstPage.meta.facets.chip_counts,
    foundation_issue_counts: firstPage.meta.facets.foundation_issue_counts,
    today_facility_patient_count: firstPage.meta.facets.today_facility_patient_count,
    today_visit_count: firstPage.meta.facets.today_visit_count,
    safety_tagged_count: firstPage.meta.facets.safety_tagged_count,
    next_action: firstPage.meta.rail.next_action,
    blocked_reasons: firstPage.meta.rail.blocked_reasons,
    generated_at: firstPage.meta.generated_at,
    scope: firstPage.meta.scope,
    assigned_total: firstPage.meta.assigned_total,
    filtered_total: firstPage.meta.total_count,
    limit: firstPage.meta.limit,
    has_more: lastPage.meta.has_more,
    next_cursor: lastPage.meta.next_cursor,
    filters_applied: firstPage.meta.filters_applied,
    count_basis: firstPage.meta.count_basis,
  };
}

function buildSummaryTiles(data: PatientBoardResponse): SummaryTile[] {
  const urgentCount = data.chip_counts.urgent_now;
  const waitReleaseCount = data.cards.filter((card) => card.attention === 'wait_release').length;
  const todayVisitCount = data.today_visit_count;
  const externalCount = data.chip_counts.external_wait;

  return [
    {
      key: 'urgent',
      label: '最初に見る',
      value: `${urgentCount}名`,
      description:
        urgentCount > 0
          ? `${data.next_action?.patient_name ?? '最優先患者'}様から確認`
          : '期限超過の患者はいません',
      chip: 'priority',
      icon: AlertTriangle,
      className: 'border-l-4 border-l-state-blocked',
      labelClassName: 'text-state-blocked',
    },
    {
      key: 'release',
      label: '再開できる',
      value: `${waitReleaseCount}名`,
      description: waitReleaseCount > 0 ? '照会回答などで工程を戻せます' : '待ち解除はありません',
      chip: 'wait_release',
      icon: MessageSquareWarning,
      className: 'border-l-4 border-l-state-done',
      labelClassName: 'text-state-done',
    },
    {
      key: 'visit',
      label: '本日訪問',
      value:
        data.today_facility_patient_count > 0
          ? `${todayVisitCount}名+施設${data.today_facility_patient_count}名`
          : `${todayVisitCount}名`,
      description:
        todayVisitCount > 0 ? '出発前チェックとセット確認' : '今日の個別訪問はありません',
      chip: 'visit_today',
      icon: CalendarDays,
      className: 'border-l-4 border-l-tag-info',
      labelClassName: 'text-tag-info',
    },
    {
      key: 'hold',
      label: '止まっている',
      value: `${externalCount + data.chip_counts.paused}名`,
      description:
        externalCount + data.chip_counts.paused > 0
          ? `外部待ち${externalCount}名 / 休止${data.chip_counts.paused}名`
          : '外部待ち・休止はありません',
      chip: externalCount > 0 ? 'external' : 'paused',
      icon: PauseCircle,
      className: 'border-l-4 border-l-state-waiting',
      labelClassName: 'text-state-waiting',
    },
  ];
}

function SummaryTileButton({
  tile,
  selected,
  onSelect,
}: {
  tile: SummaryTile;
  selected: boolean;
  onSelect: (chip: BoardChipValue) => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      className={cn(
        'min-h-[72px] rounded-lg border bg-card p-2.5 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:p-3',
        tile.className,
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
      aria-pressed={selected}
      onClick={() => onSelect(tile.chip)}
    >
      <span className={cn('flex items-center gap-2 text-xs font-semibold', tile.labelClassName)}>
        <Icon className="size-4" aria-hidden="true" />
        {tile.label}
      </span>
      <span className="mt-1.5 block text-lg font-bold text-foreground sm:mt-2 sm:text-xl">
        {tile.value}
      </span>
      <span className="mt-1 hidden text-xs leading-4 text-muted-foreground sm:block sm:leading-5">
        {tile.description}
      </span>
    </button>
  );
}

/** 休止カード用: 全点灰のドット+「休止」ラベル(工程フロー外)。 */
function PausedDots() {
  return (
    <span
      aria-label="工程: 休止(フロー外)"
      className="inline-flex items-center gap-1.5"
      data-testid="paused-progress-dots"
    >
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {PROCESS_STEPS_9.map((step) => (
          <span key={step.key} className="size-1.5 rounded-full bg-muted-foreground/25" />
        ))}
      </span>
      <span className="text-xs font-medium text-muted-foreground">休止</span>
    </span>
  );
}

function PatientBoardCardItem({ card, now }: { card: PatientBoardCard; now: Date }) {
  const presentation = ATTENTION_PRESENTATIONS[card.attention];
  const { tags, hiddenCount: hiddenSafetyTagCount } = selectVisibleSafetyTags(card.safety_tags);
  const operationSummary = card.operation_summary ?? [];

  return (
    <article
      className="phos-patient-card-motion relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-card p-4 pl-5"
      data-testid="patient-board-card"
      data-attention={card.attention}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1', presentation.accentClass)}
      />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm leading-6">
          <Link
            href={buildPatientHref(card.patient_id)}
            className="inline-flex min-h-11 items-center font-bold text-foreground hover:underline"
            data-testid="patient-board-card-link"
          >
            {card.name}
          </Link>
          <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
            {card.age != null ? `${card.age}歳・` : ''}
            {card.residence_label}
          </span>
        </p>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold',
            presentation.badgeClass,
          )}
        >
          {presentation.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {tags.length > 0 ? (
          <>
            {tags.map((tag) => (
              <SafetyTagBadge key={tag} tag={tag} />
            ))}
            {hiddenSafetyTagCount > 0 ? (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                +{hiddenSafetyTagCount}
              </span>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            安全タグなし
          </span>
        )}
      </div>

      <p className="text-sm leading-5 text-muted-foreground">
        次回:{' '}
        <span className="font-bold text-foreground tabular-nums">
          {formatNextVisitLabel(card, now)}
        </span>
      </p>

      {operationSummary.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label={`${card.name} 様の訪問条件`}>
          {operationSummary.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {card.foundation_summary ? (
        <div
          className={cn(
            'rounded-md border border-l-4 bg-card px-2.5 py-2 text-xs leading-5 text-foreground',
            FOUNDATION_STATUS_ACCENT[card.foundation_summary.status],
          )}
          aria-label={`${card.name} 様の情報基盤`}
        >
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                'font-semibold',
                FOUNDATION_STATUS_TEXT[card.foundation_summary.status],
              )}
            >
              {card.foundation_summary.label}
            </p>
            {card.foundation_href ? (
              <Link
                href={card.foundation_href}
                className="inline-flex min-h-11 shrink-0 items-center text-xs font-semibold underline-offset-4 hover:underline"
              >
                正本確認
              </Link>
            ) : null}
          </div>
          <p className="text-xs opacity-85">{card.foundation_summary.items.join(' / ')}</p>
        </div>
      ) : null}

      {card.current_step ? <ProcessProgressDots currentStep={card.current_step} /> : <PausedDots />}

      <p className={cn('text-sm leading-5', STATUS_TONE_CLASSES[card.status_tone])}>
        {card.status_text}
      </p>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          href={card.link_href}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            '!h-auto !min-h-[44px]',
          )}
          aria-label={`${card.name} ${card.link_label}`}
        >
          → {card.link_label}
        </Link>
        <Link
          href={card.foundation_href ?? buildPatientHref(card.patient_id)}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '!h-auto !min-h-[44px]')}
        >
          患者詳細
        </Link>
      </div>
    </article>
  );
}

function PatientBoardCompactList({ cards, now }: { cards: PatientBoardCard[]; now: Date }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border/70 bg-card"
      data-testid="patients-board-list"
    >
      <div
        className="hidden border-b border-border/70 bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid lg:grid-cols-[minmax(190px,1.25fr)_minmax(120px,0.72fr)_minmax(150px,0.95fr)_minmax(150px,0.95fr)_minmax(150px,0.95fr)_minmax(180px,1fr)] lg:items-center lg:gap-3"
        aria-hidden="true"
      >
        <span>患者</span>
        <span>注意</span>
        <span>リスク</span>
        <span>次回訪問</span>
        <span>基盤整備</span>
        <span>アクション</span>
      </div>
      <ul role="list" className="divide-y divide-border/70">
        {cards.map((card) => (
          <PatientBoardCompactListRow key={card.patient_id} card={card} now={now} />
        ))}
      </ul>
    </div>
  );
}

function PatientBoardCompactListRow({ card, now }: { card: PatientBoardCard; now: Date }) {
  const presentation = ATTENTION_PRESENTATIONS[card.attention];
  const { tags, hiddenCount: hiddenSafetyTagCount } = selectVisibleSafetyTags(card.safety_tags);
  const foundationSummary = card.foundation_summary;

  return (
    <li
      className="grid gap-2 px-3 py-3 lg:grid-cols-[minmax(190px,1.25fr)_minmax(120px,0.72fr)_minmax(150px,0.95fr)_minmax(150px,0.95fr)_minmax(150px,0.95fr)_minmax(180px,1fr)] lg:items-center lg:gap-3"
      data-testid="patient-board-list-row"
      data-attention={card.attention}
    >
      <div className="min-w-0">
        <Link
          href={buildPatientHref(card.patient_id)}
          className="inline-flex min-h-11 max-w-full items-center font-bold text-foreground underline-offset-4 hover:underline"
          data-testid="patient-board-list-link"
        >
          <span className="truncate">{card.name}</span>
        </Link>
        <p className="text-xs tabular-nums text-muted-foreground">
          {card.age != null ? `${card.age}歳・` : ''}
          {card.residence_label}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex min-h-7 items-center rounded-full px-2 text-xs font-semibold',
            presentation.badgeClass,
          )}
        >
          {presentation.label}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1" aria-label={`${card.name} 様の安全タグ`}>
        {tags.length > 0 ? (
          <>
            {tags.map((tag) => (
              <SafetyTagBadge key={tag} tag={tag} />
            ))}
            {hiddenSafetyTagCount > 0 ? (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                +{hiddenSafetyTagCount}
              </span>
            ) : null}
          </>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            安全タグなし
          </span>
        )}
      </div>

      <div className="min-w-0 text-sm leading-5">
        <p className="font-bold text-foreground tabular-nums">{formatNextVisitLabel(card, now)}</p>
        {card.current_step ? (
          <ProcessProgressDots currentStep={card.current_step} />
        ) : (
          <PausedDots />
        )}
      </div>

      <div className="min-w-0 text-sm leading-5">
        {foundationSummary ? (
          <>
            <p className={cn('font-semibold', FOUNDATION_STATUS_TEXT[foundationSummary.status])}>
              {foundationSummary.label}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {foundationSummary.items.join(' / ')}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">基盤確認なし</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={card.link_href}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            '!h-auto !min-h-[44px]',
          )}
          aria-label={`${card.name} ${card.link_label}`}
        >
          → {card.link_label}
        </Link>
        <Link
          href={card.foundation_href ?? buildPatientHref(card.patient_id)}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '!h-auto !min-h-[44px]')}
        >
          患者詳細
        </Link>
      </div>
    </li>
  );
}

function buildNextAction(data: PatientBoardResponse): NextActionPanelProps {
  if (data.next_action) {
    const auditLabel = data.next_action.has_narcotic ? '麻薬監査' : '監査';
    return {
      actionLabel: data.next_action.due_at
        ? `${auditLabel}を開始 — ${formatTimeOfDay(data.next_action.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: `${data.next_action.patient_name} 様の${
        data.next_action.has_narcotic ? '持参薬の麻薬監査' : '調剤監査'
      }が待ちです。完了で午後の予定がすべて確定します。`,
      actionHref: '/audit',
    };
  }
  return {
    actionLabel: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    actionHref: '/schedules',
  };
}

export function PatientsBoard() {
  const orgId = useOrgId();
  const [scope, setScope] = useState<BoardScope>('mine');
  const [chip, setChip] = useState<BoardChipValue>('priority');
  const [sort, setSort] = useState<PatientBoardSort>('priority');
  const [viewMode, setViewMode] = useState<BoardViewMode>('card');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const boardSearchQuery = deferredSearchQuery.trim();
  const [extraPages, setExtraPages] = useState<PatientBoardPageResponse[]>([]);
  const [isLoadingNextPage, setIsLoadingNextPage] = useState(false);
  const [nextPageError, setNextPageError] = useState<string | null>(null);
  const isBootstrappingOrg = !orgId;

  const foundationIssue = getFoundationIssueForChip(chip);
  const cardFilter = getCardFilterForChip(chip);
  const boardQuery = useRealtimeQuery({
    queryKey: [
      'patients',
      'board',
      orgId,
      scope,
      foundationIssue,
      cardFilter,
      sort,
      boardSearchQuery,
      PATIENT_BOARD_PAGE_LIMIT,
    ],
    queryFn: () =>
      fetchPatientBoard(orgId, scope, foundationIssue, boardSearchQuery, {
        cardFilter,
        sort,
        limit: PATIENT_BOARD_PAGE_LIMIT,
      }),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: [
      'cycle_transition',
      { type: 'workflow_refresh', source: PATIENT_BOARD_WORKFLOW_SOURCES },
    ],
  });

  const boardPageFilterKey = `${scope}|${chip}|${sort}|${deferredSearchQuery}`;
  const [prevBoardPageFilterKey, setPrevBoardPageFilterKey] = useState(boardPageFilterKey);
  if (prevBoardPageFilterKey !== boardPageFilterKey) {
    setPrevBoardPageFilterKey(boardPageFilterKey);
    setExtraPages([]);
    setNextPageError(null);
    setIsLoadingNextPage(false);
  }

  const now = new Date();
  const boardPages = useMemo(
    () => (boardQuery.data ? [boardQuery.data, ...extraPages] : []),
    [boardQuery.data, extraPages],
  );
  const data = useMemo(() => mergePatientBoardPages(boardPages), [boardPages]);
  const isRefreshing = Boolean(boardQuery.isFetching && !boardQuery.isLoading);
  const isSearchSettling = searchQuery !== deferredSearchQuery;
  // 鮮度ラベルは「描画時刻(now)」ではなく実データ取得時刻(dataUpdatedAt)を表示する。
  const freshnessTime = boardQuery.dataUpdatedAt ? new Date(boardQuery.dataUpdatedAt) : now;
  // react-query v5 はキャッシュ済み data がある状態で背景 refetch が失敗すると
  // status='error'(isError=true)になりつつ前回 data を保持する(QueryObserverRefetchErrorResult)。
  // この場合カードを全 ErrorState に置換して閲覧中データを消すのではなく、stale 表示+更新失敗の警告に倒す。
  const isStaleAfterRefetchError = Boolean(boardQuery.isRefetchError && data);
  const dateLabel = `${format(freshnessTime, 'M/d(EEE) HH:mm', { locale: ja })} — カードの色＝いま必要な対応`;

  const visibleCards = data?.cards ?? [];
  const displayedCards = visibleCards;
  const hasMoreCardsToShow = Boolean(data?.has_more && data.next_cursor);
  async function loadNextPage() {
    if (!data?.next_cursor || isLoadingNextPage || !orgId) return;
    setIsLoadingNextPage(true);
    setNextPageError(null);
    try {
      const page = await fetchPatientBoard(orgId, scope, foundationIssue, boardSearchQuery, {
        cardFilter,
        sort,
        limit: PATIENT_BOARD_PAGE_LIMIT,
        cursor: data.next_cursor,
      });
      setExtraPages((pages) => [...pages, page]);
    } catch (error) {
      setNextPageError(error instanceof Error ? error.message : '患者一覧の追加取得に失敗しました');
    } finally {
      setIsLoadingNextPage(false);
    }
  }

  const chipOptions = useMemo(() => {
    const counts = data?.chip_counts;
    const foundationCounts = data?.foundation_issue_counts;
    const visitTodayLabel =
      data && data.today_facility_patient_count > 0
        ? `本日訪問 ${data.today_visit_count}＋施設${data.today_facility_patient_count}名`
        : '本日訪問';
    return [
      { value: 'priority' as const, label: '今すぐ対応', count: counts?.urgent_now ?? 0 },
      { value: 'external' as const, label: '外部待ち', count: counts?.external_wait ?? 0 },
      {
        value: 'visit_today' as const,
        label: visitTodayLabel,
        count: data && data.today_facility_patient_count > 0 ? undefined : counts?.visit_today,
      },
      {
        value: 'foundation_gap' as const,
        label: '正本未整備',
        count: foundationCounts?.needs_confirmation ?? 0,
      },
      {
        value: 'foundation_contact_gap' as const,
        label: '連絡先未設定',
        count: foundationCounts?.missing_contact ?? 0,
      },
      {
        value: 'foundation_consent_plan_gap' as const,
        label: '同意・計画未確認',
        count: foundationCounts?.missing_consent_plan ?? 0,
      },
      {
        value: 'foundation_care_team_gap' as const,
        label: '連携先未設定',
        count: foundationCounts?.missing_care_team ?? 0,
      },
      {
        value: 'foundation_parking_gap' as const,
        label: '駐車未確認',
        count: foundationCounts?.missing_parking ?? 0,
      },
      {
        value: 'foundation_care_level_gap' as const,
        label: '介護度未確認',
        count: foundationCounts?.missing_care_level ?? 0,
      },
      {
        value: 'foundation_insurance_gap' as const,
        label: '保険未確認',
        count: foundationCounts?.missing_insurance ?? 0,
      },
      { value: 'paused' as const, label: '休止', count: counts?.paused ?? 0 },
    ];
  }, [data]);
  const summaryTiles = useMemo(() => (data ? buildSummaryTiles(data) : []), [data]);

  const blockedReasons: BlockedReason[] = buildDailyOpsBlockedReasons(data);

  const evidence: EvidenceItem[] = data
    ? [
        {
          id: 'assigned-patients',
          label: '担当患者',
          meta: `${data.assigned_total}名`,
          href: '/patients',
        },
        {
          id: 'today-visits',
          label: '本日の訪問',
          meta:
            data.today_facility_patient_count > 0
              ? `${data.today_visit_count}件＋施設`
              : `${data.today_visit_count}件`,
          href: '/visits',
        },
        {
          id: 'safety-tagged',
          label: '安全タグあり',
          meta: `${data.safety_tagged_count}名`,
          href: '/patients',
        },
      ]
    : [];

  return (
    <section
      aria-label="患者カード一覧"
      aria-busy={
        isBootstrappingOrg ||
        boardQuery.isLoading ||
        isRefreshing ||
        isSearchSettling ||
        isLoadingNextPage
      }
      data-testid="patients-board"
      className="space-y-4"
    >
      {/* ハブ系トップ階層ヘッダは WorkflowPageHeader で統一(戻り導線なし)。 */}
      {/* 新規登録/比較の入口を主操作として 44px 常設し、日時凡例とデータ鮮度は */}
      {/* help-popover に隠さず supportingContent で常時可視に保つ。 */}
      <WorkflowPageHeader
        title="患者一覧"
        description="患者カードの色と優先度の見方を確認できます。"
        actions={[
          {
            href: '/patients/new',
            label: '新規登録',
            icon: <UserPlus className="size-4" aria-hidden="true" />,
          },
          {
            href: '/patients/compare',
            label: '比較',
            icon: <GitCompare className="size-4" aria-hidden="true" />,
          },
        ]}
        supportingContent={
          <div className="flex flex-wrap items-center gap-2">
            {/* HH:mm を含むため、SSR とハイドレーションが分を跨ぐと text mismatch になる */}
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {dateLabel}
            </p>
            {isStaleAfterRefetchError ? (
              <span
                className="inline-flex items-center gap-2 rounded-full border border-state-confirm/40 bg-state-confirm/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-state-confirm"
                role="status"
                aria-live="polite"
              >
                最新化に失敗・前回取得時点を表示中
                <button
                  type="button"
                  onClick={() => void boardQuery.refetch()}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-[44px]')}
                >
                  再試行
                </button>
              </span>
            ) : isRefreshing ? (
              <span
                className="inline-flex items-center rounded-full border border-tag-info/30 bg-tag-info/10 px-2 py-0.5 text-xs font-medium text-tag-info"
                role="status"
                aria-live="polite"
              >
                最新の患者状態を確認中
              </span>
            ) : null}
          </div>
        }
      />

      <div className="rounded-lg border border-border/70 bg-card p-4">
        {/* 担当範囲は board 全体の集合切替(詳細フィルタより上位)。summaryTiles の直上に置く。 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">担当範囲</p>
          <FilterChipBar
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={setScope}
            ariaLabel="担当範囲の切替"
          />
        </div>

        {summaryTiles.length > 0 ? (
          <div
            className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="今日の患者判断サマリー"
          >
            {summaryTiles.map((tile) => (
              <SummaryTileButton
                key={tile.key}
                tile={tile}
                selected={chip === tile.chip}
                onSelect={setChip}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-4 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              並び
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as PatientBoardSort)}
                className="min-h-[44px] rounded-lg border border-input bg-background px-2 py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="患者カードの並び順"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <FilterChipBar
              options={chipOptions}
              value={chip}
              onChange={setChip}
              ariaLabel="対応カテゴリの絞り込み"
            />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">表示</span>
                <FilterChipBar
                  options={VIEW_MODE_OPTIONS}
                  value={viewMode}
                  onChange={setViewMode}
                  ariaLabel="患者一覧の表示切替"
                />
              </div>
              {data ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="patients-board-scope-note"
                >
                  {scope === 'mine' ? '私の担当' : '全体'} {data.filtered_total}名中{' '}
                  {visibleCards.length}名を表示
                </p>
              ) : null}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="氏名・カナ・住所・施設で検索"
                  aria-label="氏名・カナ・住所・施設で検索"
                  className="!h-auto !min-h-[44px] w-56 pl-8"
                />
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {isSearchSettling
                  ? '検索結果を更新中'
                  : data
                    ? `${visibleCards.length}名を表示中`
                    : '患者一覧を読み込み中'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        {isBootstrappingOrg || boardQuery.isLoading ? (
          <PatientBoardLoadingShell />
        ) : !data ? (
          // 初回ロード失敗(キャッシュ data なし)のみ全 ErrorState。背景 refetch 失敗で
          // data が残っている場合はカードを消さず、上部の stale 警告(isStaleAfterRefetchError)で示す。
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="患者一覧を表示できません"
              description="患者カードの集計取得に失敗しました。再試行してください。"
              detail={boardQuery.error instanceof Error ? boardQuery.error.message : undefined}
              onRetry={() => void boardQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0">
              {visibleCards.length === 0 ? (
                <div className="phos-patient-empty-state rounded-lg border border-border/70 bg-card px-4 py-6">
                  <p className="text-sm font-medium text-foreground">
                    条件に一致する患者がいません
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    検索語またはフィルタを解除してください。患者安全タグや警告は条件を戻すと再表示されます。
                  </p>
                </div>
              ) : viewMode === 'list' ? (
                <PatientBoardCompactList cards={displayedCards} now={now} />
              ) : (
                <div
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  data-testid="patients-board-grid"
                >
                  {displayedCards.map((card) => (
                    <PatientBoardCardItem key={card.patient_id} card={card} now={now} />
                  ))}
                </div>
              )}
              {hasMoreCardsToShow ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="patients-board-visible-count-note"
                  >
                    全{data.filtered_total}名中 {displayedCards.length}名を表示
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadNextPage()}
                    disabled={isLoadingNextPage}
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'min-h-[44px]',
                    )}
                  >
                    {isLoadingNextPage ? '読み込み中' : 'さらに読み込む'}
                  </button>
                  {nextPageError ? (
                    <p className="text-xs text-state-blocked" role="alert">
                      {nextPageError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <WorkspaceActionRail
              nextAction={buildNextAction(data)}
              blockedReasons={blockedReasons}
              blockedReasonsEmptyLabel="止まっている作業はありません"
              evidence={evidence}
              evidenceOpenLabel="開く"
            />
          </div>
        )}
      </div>
    </section>
  );
}
