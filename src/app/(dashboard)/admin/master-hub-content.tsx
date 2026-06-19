'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format, isSameDay, parseISO } from 'date-fns';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { useOrgId } from '@/lib/hooks/use-org-id';
import type { MasterHubCard, MasterHubResponse } from '@/types/master-hub';

/**
 * 13_master のマスター鮮度ハブ(docs/design-gap-analysis-new.md)。
 * 本文(マスターカード 2 列グリッド → 鮮度の注意バナー)+ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録)の 2 カラム構成。
 * 主操作(青)は右レールの麻薬監査ボタン 1 つ。カード側の導線はすべて outline。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 */

async function fetchMasterHub(): Promise<MasterHubResponse> {
  const res = await fetch('/api/admin/master-hub');
  if (!res.ok) throw new Error('マスター鮮度集計の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

/** 経過時間ラベル(「1日」「30分」)。 */
function formatAgeLabel(minutes: number): string {
  if (minutes < 60) return `${Math.max(minutes, 0)}分`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}時間`;
  return `${Math.floor(minutes / (24 * 60))}日`;
}

/** 最終更新: 当日は M/d HH:mm、それ以外は M/d。 */
export function formatLastUpdatedLabel(value: string | null, now: Date = new Date()): string {
  if (!value) return '—';
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return '—';
  return isSameDay(date, now) ? format(date, 'M/d HH:mm') : format(date, 'M/d');
}

// マスター鮮度の状態: 健全=done(緑) / 確認中・期限接近=confirm(橙, 要確認)
const STATUS_ROLE: Record<MasterHubCard['status'], StatusRole> = {
  healthy: 'done',
  checking: 'confirm',
  due_soon: 'confirm',
};

function statusBadgeLabel(card: MasterHubCard): string {
  if (card.status === 'healthy') return '健全';
  if (card.status === 'due_soon') return '期限接近';
  return card.status_count != null ? `確認中 ${card.status_count}` : '確認中';
}

function MasterCard({ card }: { card: MasterHubCard }) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4"
      data-testid="master-hub-card"
      data-master-key={card.key}
      data-status={card.status}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-bold leading-6 text-foreground">{card.title}</h3>
        <StateBadge role={STATUS_ROLE[card.status]} className="shrink-0">
          {statusBadgeLabel(card)}
        </StateBadge>
      </div>
      <p className="text-xs leading-5">
        <span className="font-semibold text-foreground">
          {card.count.toLocaleString('ja-JP')}
          {card.count_unit}
        </span>
        <span className="text-muted-foreground">
          {' '}
          / 最終更新 {formatLastUpdatedLabel(card.last_updated_at)}
        </span>
      </p>
      <p className="flex-1 text-sm leading-6 text-muted-foreground">{card.note}</p>
      <div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2">
        <p className="text-[11px] font-bold text-muted-foreground">次にすること</p>
        <p className="mt-1 text-sm font-semibold leading-5 text-foreground">
          {card.next_action_hint}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {card.issue_count > 0
            ? `未処理 ${card.issue_count.toLocaleString('ja-JP')}件`
            : '未処理なし'}
        </p>
      </div>
      <div>
        <Button asChild variant="outline" size="sm" className="min-h-9 text-primary">
          <Link href={card.action_href}>{card.action_label}</Link>
        </Button>
      </div>
    </article>
  );
}

function buildMasterHubSummary(data: MasterHubResponse) {
  const attentionCards = data.masters.filter((card) => card.status !== 'healthy');
  const issueCount = data.masters.reduce((total, card) => total + card.issue_count, 0);
  const primaryAttention =
    attentionCards.find((card) => card.status === 'checking') ?? attentionCards[0] ?? null;

  return {
    attentionCards,
    issueCount,
    primaryAttention,
  };
}

function MasterHubSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="マスター読み込み中">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function MasterHubContent() {
  const orgId = useOrgId();

  const hubQuery = useQuery({
    queryKey: ['admin', 'master-hub', orgId || 'session-org'],
    queryFn: fetchMasterHub,
    staleTime: 30_000,
  });

  const data = hubQuery.data ?? null;
  const summary = data ? buildMasterHubSummary(data) : null;
  const blockedReasons: BlockedReason[] = (data?.rail.blocked_reasons ?? []).map((reason) => ({
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
          id: 'change-log',
          label: '変更履歴',
          meta: `今月${data.change_log_month_count}件`,
          href: '/admin/audit-logs',
        },
        {
          id: 'freshness-rule',
          label: '鮮度ルール',
          meta: '90日で再確認',
          href: '/admin/settings',
        },
      ]
    : [];

  return (
    <section aria-label="マスター" data-testid="master-hub">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">マスター</h1>
          <p className="text-sm text-muted-foreground">
            · {data ? data.masters.length : 10}マスター — 鮮度がすべて
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href="/admin/data-explorer">
            <Search className="size-3.5" aria-hidden="true" />
            マスター横断検索
          </Link>
        </Button>
      </div>

      <div className="mt-4 xl:min-h-[calc(100dvh-10rem)]">
        {hubQuery.isLoading ? (
          <MasterHubSkeleton />
        ) : hubQuery.isError || !data ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="マスターを表示できません"
              description="マスター鮮度の集計取得に失敗しました。再試行してください。"
              detail={hubQuery.error instanceof Error ? hubQuery.error.message : undefined}
              action={{ label: '再試行', onClick: () => void hubQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-4">
              {summary ? (
                <div
                  className="rounded-lg border border-border/70 bg-card p-4"
                  data-testid="master-hub-summary"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">今日の判定</p>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {summary.attentionCards.length > 0 ? '確認あり' : '健全'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {summary.attentionCards.length}マスターに注意
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">未処理</p>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {summary.issueCount.toLocaleString('ja-JP')}件
                      </p>
                      <p className="text-xs text-muted-foreground">
                        送付先確認・点検予約・取込の残件
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-muted-foreground">最初に見る項目</p>
                      <p className="mt-1 text-sm font-bold leading-5 text-foreground">
                        {summary.primaryAttention?.title ?? '全マスター'}
                      </p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {summary.primaryAttention?.next_action_hint ??
                          '変更履歴と鮮度ルールだけ確認してください'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2" data-testid="master-hub-grid">
                {data.masters.map((card) => (
                  <MasterCard key={card.key} card={card} />
                ))}
              </div>
              <p
                className="rounded-md border border-tag-info/30 bg-tag-info/10 px-3 py-2.5 text-sm leading-6 text-tag-info"
                data-testid="master-hub-freshness-note"
              >
                <strong className="font-bold">マスターは鮮度の画面:</strong>{' '}
                古い住所・古い送付先・期限切れの車両は現場の事故になります。鮮度警告は放置するとダッシュボードの「止まっている理由」に昇格します。
              </p>
            </div>
            <WorkspaceActionRail
              nextAction={{
                actionLabel: data.rail.next_action.label,
                description: data.rail.next_action.description,
                actionHref: data.rail.next_action.href,
              }}
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
