'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Check } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
  type NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { SafetyTagBadge } from '@/components/features/patients/safety-tag-badge';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { cn } from '@/lib/utils';
import type {
  VisitPrepCheck,
  VisitPreparationBoardResponse,
  VisitPreparationCard,
} from '@/types/visit-preparation-board';

/**
 * new_04_visit の「今日の訪問 — 出発前の準備チェック」(docs/design-gap-analysis-new.md)。
 * ヘッダー(主操作: 訪問モードを開始)→ 準備チェックカード縦リスト + 右レール
 * (次にやること / 止まっている理由 / 根拠・記録)→ オフライン注記の構成。
 * 危険タグ(麻薬/冷所/アレルギー)は隠さない。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

export async function fetchVisitPreparationBoard(
  orgId: string,
): Promise<VisitPreparationBoardResponse> {
  const res = await fetch('/api/visits/today-preparation', {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('本日の訪問準備の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

const ACCENT_CLASSES: Record<VisitPreparationCard['accent'], { bar: string; meter: string }> = {
  ready: { bar: 'bg-state-done', meter: 'bg-state-done' },
  caution: { bar: 'bg-state-confirm', meter: 'bg-state-confirm' },
  progress: { bar: 'bg-tag-info', meter: 'bg-tag-info' },
};

const CHECK_STATE_CLASSES: Record<VisitPrepCheck['state'], string> = {
  done: 'border-state-done/30 bg-state-done/10 text-state-done',
  alert: 'border-state-confirm/30 bg-state-confirm/10 font-semibold text-state-confirm',
  progress: 'border-tag-info/30 bg-tag-info/10 text-tag-info',
  pending: 'border-border bg-background text-muted-foreground',
};

const NOTE_TONE_CLASSES = {
  warning: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  info: 'border-tag-info/30 bg-tag-info/10 text-tag-info',
} as const;

/** 経過分 → 「30分」「2時間」「1日」(止まっている理由の経過時間)。 */
const formatAgeLabel = formatElapsedLabel;

function buildVisitCardActionHref(card: VisitPreparationCard, href: string) {
  return href === '/schedules' ? buildScheduleFocusHref(card.schedule_id) : href;
}

function CheckChip({ check }: { check: VisitPrepCheck }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
        CHECK_STATE_CLASSES[check.state],
      )}
      data-state={check.state}
    >
      {check.state === 'done' ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : check.state === 'alert' ? (
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      {check.label}
      {check.state === 'alert' ? <span className="sr-only">(未完)</span> : null}
    </span>
  );
}

function PrepProgress({ card }: { card: VisitPreparationCard }) {
  const ratio = card.prep_total > 0 ? card.prep_done / card.prep_total : 0;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-sm font-semibold text-foreground">
        準備 {card.prep_done}/{card.prep_total}
      </span>
      <span
        role="img"
        aria-label={`準備 ${card.prep_done}/${card.prep_total}`}
        className="inline-flex h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn('h-full rounded-full', ACCENT_CLASSES[card.accent].meter)}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
    </div>
  );
}

function VisitPrepCardItem({ card }: { card: VisitPreparationCard }) {
  return (
    <article
      className="relative overflow-hidden rounded-lg border border-border/70 bg-card p-4 pl-5"
      data-testid="visit-prep-card"
      data-accent={card.accent}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-1', ACCENT_CLASSES[card.accent].bar)}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-lg font-bold tabular-nums text-foreground">
          {card.time_label ?? '--:--'}
        </p>
        <p className="text-base font-bold text-foreground">
          {card.title}
          {card.is_facility ? '' : ' 様'}
        </p>
        <p className="text-xs text-muted-foreground">{card.meta_label}</p>
        <div className="ml-auto">
          <PrepProgress card={card} />
        </div>
      </div>

      {card.safety_tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.safety_tags.map((tag) => (
            <SafetyTagBadge key={tag} tag={tag} />
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.checks.map((check) => (
          <CheckChip key={check.id} check={check} />
        ))}
      </div>

      {card.note ? (
        <p
          className={cn(
            'mt-2 rounded-md border px-3 py-2 text-sm leading-5',
            NOTE_TONE_CLASSES[card.note_tone ?? 'info'],
          )}
        >
          {card.note}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {card.actions.map((action) => (
          <Link
            key={action.label}
            href={buildVisitCardActionHref(card, action.href)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            → {action.label}
          </Link>
        ))}
      </div>
    </article>
  );
}

function buildNextAction(data: VisitPreparationBoardResponse): NextActionPanelProps {
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
    actionLabel: '今日のルートを確認する',
    description: 'いま期限で止まっている作業はありません。出発前確認に進めます。',
    actionHref: data.cards[0]?.schedule_id
      ? buildScheduleFocusHref(data.cards[0].schedule_id)
      : '/schedules',
  };
}

function BoardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="本日の訪問読み込み中">
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-36 w-full rounded-lg" />
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

export function VisitsToday() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;

  const boardQuery = useRealtimeQuery({
    queryKey: ['visits', 'today-preparation', orgId],
    queryFn: () => fetchVisitPreparationBoard(orgId),
    staleTime: 30_000,
    enabled: !isBootstrappingOrg,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const now = new Date();
  const data = boardQuery.data ?? null;
  const dateLabel = `${format(now, 'M/d(EEE)', { locale: ja })} — 出発前の最終確認`;
  const firstVisitHref = data?.cards[0]?.visit_mode_href ?? null;
  const firstScheduleHref = data?.cards[0]?.schedule_id
    ? buildScheduleFocusHref(data.cards[0].schedule_id)
    : '/schedules';

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
          id: 'today-route',
          label: '本日のルート',
          meta: data.evidence.route_calculated_at
            ? `計算 ${formatTimeOfDay(data.evidence.route_calculated_at)}`
            : '未計算',
          href: firstScheduleHref,
        },
        {
          id: 'cold-bag',
          label: '保冷バッグ',
          meta: data.evidence.vehicle_label ? `車両: ${data.evidence.vehicle_label}` : '車載',
          href: firstScheduleHref,
        },
        {
          id: 'prior-records',
          label: '前回訪問記録',
          meta: `${data.evidence.prior_record_count}件`,
          href: firstVisitHref ?? '/visits',
        },
      ]
    : [];

  const countBadge = data
    ? data.facility_patient_count > 0
      ? `${data.visit_count}件＋施設${data.facility_patient_count}名`
      : `${data.visit_count}件`
    : null;

  return (
    <section aria-label="今日の訪問(出発前の準備チェック)" data-testid="visits-today">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">訪問</h1>
          <p className="text-sm text-muted-foreground">{dateLabel}</p>
        </div>
        {/* 主操作(青)は 1 画面 1 つ: 訪問モードの開始 */}
        {firstVisitHref ? (
          <Button asChild>
            <Link href={firstVisitHref}>訪問モードを開始</Link>
          </Button>
        ) : (
          // 無効ボタンは理由を示し、可能なら解消導線を置く(Action beside evidence)
          <div className="flex flex-col items-start gap-1.5">
            <Button type="button" disabled aria-describedby="visit-start-disabled-reason">
              訪問モードを開始
            </Button>
            <p id="visit-start-disabled-reason" className="text-xs text-muted-foreground">
              本日の訪問予定がないため開始できません。
              <Link
                href="/schedules"
                className="ml-1 text-primary underline-offset-2 hover:underline"
              >
                訪問予定を確認
              </Link>
            </p>
          </div>
        )}
      </div>

      <div className="mt-4">
        {isBootstrappingOrg || boardQuery.isLoading ? (
          <BoardSkeleton />
        ) : boardQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="本日の訪問を表示できません"
              description="訪問準備の集計取得に失敗しました。再試行してください。"
              detail={boardQuery.error instanceof Error ? boardQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void boardQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              <section
                aria-labelledby="visits-today-list-heading"
                className="rounded-lg border border-border/70 bg-card p-4"
                data-testid="visits-today-list"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    id="visits-today-list-heading"
                    className="text-base font-bold text-foreground"
                  >
                    今日の訪問 — 出発前確認
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    未完了チェックを0にしてから訪問モードへ進みます
                  </p>
                  {countBadge ? (
                    <span className="ml-auto inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
                      {countBadge}
                    </span>
                  ) : null}
                </div>
                {data.cards.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
                    本日の訪問予定はありません。
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {data.cards.map((card) => (
                      <VisitPrepCardItem key={card.schedule_id} card={card} />
                    ))}
                  </div>
                )}
              </section>

              <p
                className="rounded-md border-l-4 border-border/70 border-l-state-done bg-card px-3 py-2 text-sm leading-5 text-state-done"
                data-testid="visits-today-offline-note"
              >
                訪問モードはオフラインでも全機能が動きます。記録は端末に保存され、電波が戻ると自動同期されます。
              </p>
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
