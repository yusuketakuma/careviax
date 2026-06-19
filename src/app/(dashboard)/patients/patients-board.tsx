'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarDays,
  MessageSquareWarning,
  PauseCircle,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { FilterChipBar } from '@/components/features/workspace/filter-chip-bar';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import {
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import { ProcessProgressDots } from '@/components/features/workspace/process-chips';
import { PROCESS_STEPS_9 } from '@/lib/prescription/cycle-workspace';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type {
  PatientAttentionKey,
  PatientBoardCard,
  PatientBoardResponse,
  PatientStatusTone,
} from '@/types/patient-board';
import { PatientBoardLoadingShell } from './patient-board-loading';

/**
 * new_02_patient_list の患者カード一覧(docs/design-gap-analysis-new.md)。
 * ヘッダー(担当トグル)→ フィルタチップ行 → 患者カードグリッド(4列)+右レール
 * (次にやること / 止まっている理由 / 根拠・記録)の 2 カラム構成。
 * カードの色 = いま必要な対応(左ライン/バッジ)。危険タグは隠さない。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

export async function fetchPatientBoard(
  orgId: string,
  scope: 'mine' | 'all',
  foundationIssue?: 'needs_confirmation',
): Promise<PatientBoardResponse> {
  const params = new URLSearchParams({ scope });
  if (foundationIssue) params.set('foundation_issue', foundationIssue);
  const res = await fetch(`/api/patients/board?${params}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('患者一覧の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

type BoardScope = 'mine' | 'all';
type BoardSort = 'priority' | 'next_visit' | 'name';

const SCOPE_OPTIONS: Array<{ value: BoardScope; label: string }> = [
  { value: 'mine', label: '私の担当' },
  { value: 'all', label: '全員' },
];

const SORT_OPTIONS: Array<{ value: BoardSort; label: string }> = [
  { value: 'priority', label: '対応が必要な順' },
  { value: 'next_visit', label: '訪問が近い順' },
  { value: 'name', label: '氏名順' },
];

/** フィルタチップ。「今すぐ対応」=既定(優先順で全件表示)、他は絞り込み。 */
type BoardChipValue = 'priority' | 'external' | 'visit_today' | 'foundation_gap' | 'paused';

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
      badgeClass: 'bg-muted text-muted-foreground',
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
  critical: 'font-bold text-state-blocked',
  positive: 'font-semibold text-state-done',
  caution: 'font-semibold text-state-confirm',
  info: 'text-tag-info',
  external: 'font-semibold text-state-waiting',
  neutral: 'text-muted-foreground',
};

/** 患者属性タグ(腎機能/嚥下/アレルギー)。要注意の患者属性 → confirm トークン(橙)。 */
const PATIENT_SAFETY_TAG_CLASS = 'border-state-confirm/40 bg-state-confirm/10 text-state-confirm';
const PATIENT_SAFETY_TAGS: Record<string, { label: string; className: string }> = {
  renal: { label: '腎機能', className: PATIENT_SAFETY_TAG_CLASS },
  swallowing: { label: '嚥下', className: PATIENT_SAFETY_TAG_CLASS },
  allergy: { label: 'アレルギー', className: PATIENT_SAFETY_TAG_CLASS },
};

/** 情報基盤の整備状況コールアウト → ready=done(緑) / needs_confirmation=confirm(橙) / missing=blocked(赤)。 */
const FOUNDATION_STATUS_CLASSES: Record<
  NonNullable<PatientBoardCard['foundation_summary']>['status'],
  string
> = {
  ready: 'border-state-done/30 bg-state-done/10 text-state-done',
  needs_confirmation: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  missing: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
};

const SAFETY_TAG_DISPLAY_LIMIT = 3;

type SummaryTile = {
  key: string;
  label: string;
  value: string;
  description: string;
  chip: BoardChipValue;
  icon: LucideIcon;
  className: string;
};

function countCards(
  cards: PatientBoardCard[],
  predicate: (card: PatientBoardCard) => boolean,
): number {
  return cards.reduce((count, card) => count + (predicate(card) ? 1 : 0), 0);
}

function formatTimeOfDay(iso: string): string {
  const date = new Date(iso);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** 経過分 → 「30分」「2時間」「1日」(止まっている理由の経過時間)。 */
function formatAgeLabel(minutes: number): string {
  const safeMinutes = Math.max(minutes, 0);
  if (safeMinutes < 60) return `${safeMinutes}分`;
  if (safeMinutes < 24 * 60) return `${Math.floor(safeMinutes / 60)}時間`;
  return `${Math.floor(safeMinutes / (24 * 60))}日`;
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('ja-JP');
}

function getVisitSortKey(card: PatientBoardCard): string {
  const date = card.next_visit_date ?? '9999-12-31';
  const time = card.next_visit_time ?? '99:99';
  return `${date}T${time}`;
}

function sortPatientCards(cards: PatientBoardCard[], sort: BoardSort): PatientBoardCard[] {
  if (sort === 'priority') return cards;
  return [...cards].sort((left, right) => {
    if (sort === 'next_visit') {
      const visitCompare = getVisitSortKey(left).localeCompare(getVisitSortKey(right));
      if (visitCompare !== 0) return visitCompare;
    }
    return left.name.localeCompare(right.name, 'ja');
  });
}

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

function SafetyTagBadge({ tag }: { tag: string }) {
  const patientTag = PATIENT_SAFETY_TAGS[tag];
  const className = patientTag?.className ?? getHandlingTagBadgeClass(tag);
  const label = patientTag?.label ?? getHandlingTagLabel(tag);
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs', className)}
    >
      {label}
    </span>
  );
}

function buildSummaryTiles(data: PatientBoardResponse, todayKey: string): SummaryTile[] {
  const urgentCount = data.chip_counts.urgent_now;
  const waitReleaseCount = countCards(data.cards, (card) => card.attention === 'wait_release');
  const todayVisitCount = countCards(data.cards, (card) => card.next_visit_date === todayKey);
  const externalCount = countCards(
    data.cards,
    (card) => card.attention === 'external_wait' || card.attention === 'reply_wait',
  );

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
      className: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
    },
    {
      key: 'release',
      label: '再開できる',
      value: `${waitReleaseCount}名`,
      description: waitReleaseCount > 0 ? '照会回答などで工程を戻せます' : '待ち解除はありません',
      chip: 'priority',
      icon: MessageSquareWarning,
      className: 'border-state-done/30 bg-state-done/10 text-state-done',
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
      className: 'border-tag-info/30 bg-tag-info/10 text-tag-info',
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
      className: 'border-state-waiting/30 bg-state-waiting/10 text-state-waiting',
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
        'min-h-24 rounded-lg border bg-card p-3 text-left transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tile.className,
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
      aria-pressed={selected}
      onClick={() => onSelect(tile.chip)}
    >
      <span className="flex items-center gap-2 text-xs font-semibold">
        <Icon className="size-4" aria-hidden="true" />
        {tile.label}
      </span>
      <span className="mt-2 block text-xl font-bold text-foreground">{tile.value}</span>
      <span className="mt-1 block text-xs leading-5 text-muted-foreground">{tile.description}</span>
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
  const tags = card.safety_tags.slice(0, SAFETY_TAG_DISPLAY_LIMIT);
  const hiddenSafetyTagCount = Math.max(card.safety_tags.length - tags.length, 0);
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
            href={`/patients/${card.patient_id}`}
            className="font-bold text-foreground hover:underline"
            data-testid="patient-board-card-link"
          >
            {card.name}
          </Link>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {card.age != null ? `${card.age}歳・` : ''}
            {card.residence_label}
          </span>
        </p>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
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
        次回: <span className="font-bold text-foreground">{formatNextVisitLabel(card, now)}</span>
      </p>

      {operationSummary.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label={`${card.name} 様の訪問条件`}>
          {operationSummary.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {card.foundation_summary ? (
        <div
          className={cn(
            'rounded-md border px-2.5 py-2 text-xs leading-5',
            FOUNDATION_STATUS_CLASSES[card.foundation_summary.status],
          )}
          aria-label={`${card.name} 様の情報基盤`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{card.foundation_summary.label}</p>
            {card.foundation_href ? (
              <Link
                href={card.foundation_href}
                className="inline-flex min-h-7 shrink-0 items-center text-[11px] font-semibold underline-offset-4 hover:underline"
              >
                正本確認
              </Link>
            ) : null}
          </div>
          <p className="text-[11px] opacity-85">{card.foundation_summary.items.join(' / ')}</p>
        </div>
      ) : null}

      {card.current_step ? <ProcessProgressDots currentStep={card.current_step} /> : <PausedDots />}

      <p className={cn('text-sm leading-5', STATUS_TONE_CLASSES[card.status_tone])}>
        {card.status_text}
      </p>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          href={card.link_href}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          aria-label={`${card.name} ${card.link_label}`}
        >
          → {card.link_label}
        </Link>
        <Link
          href={card.foundation_href ?? `/patients/${card.patient_id}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          患者詳細
        </Link>
      </div>
    </article>
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
  const [sort, setSort] = useState<BoardSort>('priority');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isBootstrappingOrg = !orgId;

  const foundationIssue = chip === 'foundation_gap' ? 'needs_confirmation' : undefined;
  const boardQuery = useRealtimeQuery({
    queryKey: ['patients', 'board', orgId, scope, foundationIssue],
    queryFn: () => fetchPatientBoard(orgId, scope, foundationIssue),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = boardQuery.data ?? null;
  const isRefreshing = Boolean(boardQuery.isFetching && !boardQuery.isLoading);
  const isSearchSettling = searchQuery !== deferredSearchQuery;
  const dateLabel = `${format(now, 'M/d(EEE) HH:mm', { locale: ja })} — カードの色＝いま必要な対応`;

  const todayKey = format(now, 'yyyy-MM-dd');
  const visibleCards = useMemo(() => {
    const cards = data?.cards ?? [];
    const byChip =
      chip === 'priority'
        ? cards
        : cards.filter((card) => {
            if (chip === 'external') {
              return card.attention === 'external_wait' || card.attention === 'reply_wait';
            }
            // 本日訪問: 対応カテゴリに関わらず「今日訪問がある患者」
            if (chip === 'visit_today') return card.next_visit_date === todayKey;
            if (chip === 'foundation_gap') {
              return card.foundation_summary?.status !== 'ready';
            }
            return card.attention === 'paused';
          });
    const query = normalizeSearchText(deferredSearchQuery);
    const searched = query
      ? byChip.filter((card) =>
          [
            card.name,
            card.residence_label,
            card.next_visit_label,
            card.status_text,
            ...(card.operation_summary ?? []),
            card.foundation_summary?.label,
            ...(card.foundation_summary?.items ?? []),
          ]
            .map(normalizeSearchText)
            .some((value) => value.includes(query)),
        )
      : byChip;
    return sortPatientCards(searched, sort);
  }, [chip, data, deferredSearchQuery, sort, todayKey]);

  const chipOptions = useMemo(() => {
    const counts = data?.chip_counts;
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
        count: data
          ? countCards(data.cards, (card) => card.foundation_summary?.status !== 'ready')
          : 0,
      },
      { value: 'paused' as const, label: '休止', count: counts?.paused ?? 0 },
    ];
  }, [data]);
  const summaryTiles = useMemo(
    () => (data ? buildSummaryTiles(data, todayKey) : []),
    [data, todayKey],
  );

  const blockedReasons: BlockedReason[] = (data?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category,
    ageLabel: formatAgeLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));

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
      aria-busy={isBootstrappingOrg || boardQuery.isLoading || isRefreshing || isSearchSettling}
      data-testid="patients-board"
    >
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-bold text-foreground">患者一覧</h2>
            {/* HH:mm を含むため、SSR とハイドレーションが分を跨ぐと text mismatch になる */}
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                {dateLabel}
              </p>
              {isRefreshing ? (
                <span
                  className="inline-flex items-center rounded-full border border-tag-info/30 bg-tag-info/10 px-2 py-0.5 text-xs font-medium text-tag-info"
                  role="status"
                  aria-live="polite"
                >
                  最新の患者状態を確認中
                </span>
              ) : null}
            </div>
          </div>
          <FilterChipBar
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={setScope}
            ariaLabel="担当範囲の切替"
          />
        </div>

        {summaryTiles.length > 0 ? (
          <div
            className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="今日の患者判断サマリー"
          >
            {summaryTiles.map((tile) => (
              <SummaryTileButton
                key={tile.key}
                tile={tile}
                selected={
                  chip === tile.chip && !(tile.key === 'release' && tile.chip === 'priority')
                }
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
                onChange={(event) => setSort(event.target.value as BoardSort)}
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
              {data ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="patients-board-scope-note"
                >
                  {scope === 'mine' ? '私の担当' : '全体'} {data.assigned_total}名のうち{' '}
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
                  placeholder="氏名・状態で検索"
                  aria-label="氏名・状態で検索"
                  className="h-9 w-56 pl-8"
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

      <div className="mt-6">
        {isBootstrappingOrg || boardQuery.isLoading ? (
          <PatientBoardLoadingShell />
        ) : boardQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="患者一覧を表示できません"
              description="患者カードの集計取得に失敗しました。再試行してください。"
              detail={boardQuery.error instanceof Error ? boardQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void boardQuery.refetch() }}
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
                    チップ、検索語、並び順を確認してください。患者安全タグや警告は条件を戻すと再表示されます。
                  </p>
                </div>
              ) : (
                <div
                  className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                  data-testid="patients-board-grid"
                >
                  {visibleCards.map((card) => (
                    <PatientBoardCardItem key={card.patient_id} card={card} now={now} />
                  ))}
                </div>
              )}
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
