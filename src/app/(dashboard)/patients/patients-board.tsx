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
  PatientBoardResponse,
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
  foundationIssue?: 'needs_confirmation',
): Promise<PatientBoardResponse> {
  const params = new URLSearchParams({ scope });
  if (foundationIssue) params.set('foundation_issue', foundationIssue);
  const res = await fetch(`/api/patients/board?${params}`, {
    headers: buildOrgHeaders(orgId),
  });
  const json = await readApiJson<{ data: PatientBoardResponse }>(
    res,
    '患者一覧の取得に失敗しました',
  );
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

/**
 * 大量一覧の描画コスト対策(W2-F2)。カードグリッドの既存 UX(グリッドレイアウト)を
 * 崩さないよう仮想化ではなく「表示上限+もっと見る」を採用する。絞り込み変更時は先頭へ戻す。
 */
const DEFAULT_VISIBLE_PATIENT_CARDS = 60;
const PATIENT_CARDS_LOAD_MORE_STEP = 60;

/** フィルタチップ。「今すぐ対応」=既定(優先順で全件表示)、他は絞り込み。 */
// wait_release は summaryTile「再開できる」専用の絞り込み(tile-only)。下段 chipOptions には出さない。
type BoardChipValue =
  | 'priority'
  | 'wait_release'
  | 'external'
  | 'visit_today'
  | 'foundation_gap'
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

function countCards(
  cards: PatientBoardCard[],
  predicate: (card: PatientBoardCard) => boolean,
): number {
  return cards.reduce((count, card) => count + (predicate(card) ? 1 : 0), 0);
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
  const [visibleCardCount, setVisibleCardCount] = useState(DEFAULT_VISIBLE_PATIENT_CARDS);
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
  // 鮮度ラベルは「描画時刻(now)」ではなく実データ取得時刻(dataUpdatedAt)を表示する。
  // now は本日訪問フィルタ(todayKey)用にそのまま壁時計を使う。
  const freshnessTime = boardQuery.dataUpdatedAt ? new Date(boardQuery.dataUpdatedAt) : now;
  // react-query v5 はキャッシュ済み data がある状態で背景 refetch が失敗すると
  // status='error'(isError=true)になりつつ前回 data を保持する(QueryObserverRefetchErrorResult)。
  // この場合カードを全 ErrorState に置換して閲覧中データを消すのではなく、stale 表示+更新失敗の警告に倒す。
  const isStaleAfterRefetchError = Boolean(boardQuery.isRefetchError && data);
  const dateLabel = `${format(freshnessTime, 'M/d(EEE) HH:mm', { locale: ja })} — カードの色＝いま必要な対応`;

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
            // 再開できる(待ち解除): 照会回答などで工程を戻せる患者のみ。
            if (chip === 'wait_release') return card.attention === 'wait_release';
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

  // 絞り込み条件が変わったら表示件数を既定へ戻す(「もっと見る」の展開状態を引き継がない)。
  // レンダー中に前回条件との差分を見て調整する(Effect ではなく React 推奨の
  // 「prop変化に応じた state 調整」パターン。cascading render を避ける)。
  const visibleCardFilterKey = `${scope}|${chip}|${sort}|${deferredSearchQuery}`;
  const [prevVisibleCardFilterKey, setPrevVisibleCardFilterKey] = useState(visibleCardFilterKey);
  if (prevVisibleCardFilterKey !== visibleCardFilterKey) {
    setPrevVisibleCardFilterKey(visibleCardFilterKey);
    setVisibleCardCount(DEFAULT_VISIBLE_PATIENT_CARDS);
  }

  const displayedCards = useMemo(
    () => visibleCards.slice(0, visibleCardCount),
    [visibleCards, visibleCardCount],
  );
  const hasMoreCardsToShow = visibleCards.length > displayedCards.length;

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
      aria-busy={isBootstrappingOrg || boardQuery.isLoading || isRefreshing || isSearchSettling}
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
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'min-h-[44px] sm:min-h-9',
                  )}
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
                    チップ、検索語、並び順を確認してください。患者安全タグや警告は条件を戻すと再表示されます。
                  </p>
                </div>
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
                    {visibleCards.length}名中 {displayedCards.length}名を表示
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCardCount((count) => count + PATIENT_CARDS_LOAD_MORE_STEP)
                    }
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'min-h-[44px] sm:min-h-9',
                    )}
                  >
                    さらに表示
                  </button>
                </div>
              ) : null}
            </div>
            {data.truncated ? (
              <div
                role="note"
                data-testid="patients-board-truncation-note"
                className="rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-2.5 text-xs leading-5 text-state-confirm"
              >
                全{data.assigned_total}名のうち取得上限により{data.cards.length}
                名のみ取得しています。優先度の高い患者が表示範囲外の場合があります。
                検索も取得済みの患者が対象のため、見つからないときは条件を絞り込んでください。
              </div>
            ) : null}
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
