'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Search } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/loading';
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
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { cn } from '@/lib/utils';
import type {
  PatientAttentionKey,
  PatientBoardCard,
  PatientBoardResponse,
  PatientStatusTone,
} from '@/types/patient-board';

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
): Promise<PatientBoardResponse> {
  const res = await fetch(`/api/patients/board?scope=${scope}`, {
    headers: { 'x-org-id': orgId },
  });
  if (!res.ok) throw new Error('患者一覧の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

type BoardScope = 'mine' | 'all';

const SCOPE_OPTIONS: Array<{ value: BoardScope; label: string }> = [
  { value: 'mine', label: '私の担当' },
  { value: 'all', label: '全員' },
];

/** フィルタチップ。「今すぐ対応」=既定(優先順で全件表示)、他は絞り込み。 */
type BoardChipValue = 'priority' | 'external' | 'visit_today' | 'paused';

type AttentionPresentation = {
  label: string;
  accentClass: string;
  badgeClass: string;
};

const ATTENTION_PRESENTATIONS: Record<PatientAttentionKey, AttentionPresentation> = {
  urgent_now: {
    label: '今すぐ対応',
    accentClass: 'bg-red-500',
    badgeClass: 'bg-red-100 text-red-700',
  },
  wait_release: {
    label: '待ち解除',
    accentClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-100 text-emerald-700',
  },
  acceptance: {
    label: '受入判断',
    accentClass: 'bg-amber-500',
    badgeClass: 'bg-amber-100 text-amber-800',
  },
  visit_today: {
    label: '本日訪問',
    accentClass: 'bg-blue-500',
    badgeClass: 'bg-blue-100 text-blue-700',
  },
  external_wait: {
    label: '外部待ち',
    accentClass: 'bg-violet-500',
    badgeClass: 'bg-violet-100 text-violet-700',
  },
  checking: {
    label: '確認中',
    accentClass: 'bg-amber-500',
    badgeClass: 'bg-amber-100 text-amber-800',
  },
  reply_wait: {
    label: '返信待ち',
    accentClass: 'bg-violet-500',
    badgeClass: 'bg-violet-100 text-violet-700',
  },
  steady: {
    label: '順調',
    accentClass: 'bg-slate-300',
    badgeClass: 'bg-muted text-muted-foreground',
  },
  paused: {
    label: '休止中',
    accentClass: 'bg-slate-300',
    badgeClass: 'bg-muted text-muted-foreground',
  },
};

const STATUS_TONE_CLASSES: Record<PatientStatusTone, string> = {
  critical: 'font-bold text-destructive',
  positive: 'font-semibold text-emerald-700',
  caution: 'font-semibold text-amber-700',
  info: 'text-blue-700',
  external: 'font-semibold text-violet-700',
  neutral: 'text-muted-foreground',
};

/** 患者属性タグ(腎機能/嚥下/アレルギー)。取扱タグは SafetyBoard の配色を再利用。 */
const PATIENT_SAFETY_TAGS: Record<string, { label: string; className: string }> = {
  renal: { label: '腎機能', className: 'border-amber-400 bg-amber-50 text-amber-700' },
  swallowing: { label: '嚥下', className: 'border-amber-400 bg-amber-50 text-amber-700' },
  allergy: { label: 'アレルギー', className: 'border-amber-400 bg-amber-50 text-amber-700' },
};

const SAFETY_TAG_DISPLAY_LIMIT = 3;

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

  return (
    <article
      className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border/70 bg-card p-4 pl-5"
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
          tags.map((tag) => <SafetyTagBadge key={tag} tag={tag} />)
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            安全タグなし
          </span>
        )}
      </div>

      <p className="text-sm leading-5 text-muted-foreground">
        次回: <span className="font-bold text-foreground">{formatNextVisitLabel(card, now)}</span>
      </p>

      {card.current_step ? <ProcessProgressDots currentStep={card.current_step} /> : <PausedDots />}

      <p className={cn('text-sm leading-5', STATUS_TONE_CLASSES[card.status_tone])}>
        {card.status_text}
      </p>

      <div className="mt-auto pt-1">
        <Link href={card.link_href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          → {card.link_label}
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
      actionHref: '/auditing',
    };
  }
  return {
    actionLabel: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    actionHref: '/schedules',
  };
}

function BoardSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]"
      role="status"
      aria-label="患者一覧読み込み中"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-lg" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function PatientsBoard() {
  const orgId = useOrgId();
  const [scope, setScope] = useState<BoardScope>('mine');
  const [chip, setChip] = useState<BoardChipValue>('priority');
  const [searchQuery, setSearchQuery] = useState('');
  const isBootstrappingOrg = !orgId;

  const boardQuery = useRealtimeQuery({
    queryKey: ['patients', 'board', orgId, scope],
    queryFn: () => fetchPatientBoard(orgId, scope),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = boardQuery.data ?? null;
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
            return card.attention === 'paused';
          });
    const query = searchQuery.trim();
    if (!query) return byChip;
    return byChip.filter(
      (card) =>
        card.name.includes(query) ||
        (card.address ?? '').includes(query) ||
        card.residence_label.includes(query),
    );
  }, [chip, data, searchQuery, todayKey]);

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
      { value: 'paused' as const, label: '休止', count: counts?.paused ?? 0 },
    ];
  }, [data]);

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
    <section aria-label="患者カード一覧" data-testid="patients-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">患者一覧</h2>
          {/* HH:mm を含むため、SSR とハイドレーションが分を跨ぐと text mismatch になる */}
          <p className="text-sm text-muted-foreground" suppressHydrationWarning>
            {dateLabel}
          </p>
        </div>
        <FilterChipBar
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={setScope}
          ariaLabel="担当範囲の切替"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs text-muted-foreground">並び: 対応が必要な順</span>
        <FilterChipBar
          options={chipOptions}
          value={chip}
          onChange={setChip}
          ariaLabel="対応カテゴリの絞り込み"
        />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data ? (
            <p className="text-xs text-muted-foreground" data-testid="patients-board-scope-note">
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
              placeholder="氏名・住所で検索"
              aria-label="氏名・住所で検索"
              className="h-9 w-56 pl-8"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || boardQuery.isLoading ? (
          <BoardSkeleton />
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,300px)]">
            <div className="min-w-0">
              {visibleCards.length === 0 ? (
                <p className="rounded-lg border border-border/70 bg-card px-4 py-6 text-sm text-muted-foreground">
                  条件に一致する患者がいません。チップや検索条件を変更してください。
                </p>
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
            <div className="space-y-4">
              <WorkspaceActionRail
                nextAction={buildNextAction(data)}
                blockedReasons={blockedReasons}
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
