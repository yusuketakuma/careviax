'use client';

import { useMemo } from 'react';
import { buildDailyOpsBlockedReasons } from '@/lib/workspace/daily-ops-rail';
import type {
  CockpitVisit,
  DashboardCockpitCommentsResponse,
  DashboardCockpitDetailsResponse,
  DashboardCockpitInboundResponse,
  DashboardCockpitScope,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
  DashboardUrgentItem,
  DashboardUrgentSourceLink,
} from '@/types/dashboard-cockpit';
import type {
  BlockedReason,
  EvidenceItem,
  NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import {
  buildProcessNowTiles,
  buildTeamHandoffSuggestion,
  formatTimeOfDay,
  type ProcessNowTile,
} from './dashboard-cockpit.helpers';

const VIEW_SCOPE_LABELS: Record<DashboardCockpitScope, string> = {
  mine: '私の今日',
  team: 'チーム全体',
};

const EMPTY_VISITS: CockpitVisit[] = [];
const EMPTY_URGENT_ITEMS: DashboardUrgentItem[] = [];
const EMPTY_URGENT_SOURCE_LINKS: DashboardUrgentSourceLink[] = [];

function buildDashboardNextAction(
  topUrgent: DashboardUrgentItem | null,
  visitCount: number,
): NextActionPanelProps {
  if (topUrgent) {
    const actionLabel =
      topUrgent.source === 'audit' ? `${topUrgent.source_label}を開始` : topUrgent.action_label;
    return {
      actionLabel: topUrgent.due_at
        ? `${actionLabel} — ${formatTimeOfDay(topUrgent.due_at)}期限`
        : actionLabel,
      description: topUrgent.patient_name
        ? `${topUrgent.patient_name} 様: ${topUrgent.summary}`
        : topUrgent.summary,
      actionHref: topUrgent.action_href,
    };
  }

  if (visitCount > 0) {
    return {
      actionLabel: '訪問準備を確認する',
      description: `本日の訪問 ${visitCount}件の準備状況を確認します。`,
      actionHref: '/schedules',
    };
  }

  return {
    actionLabel: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    actionHref: '/schedules',
  };
}

export type DashboardCockpitViewModel = {
  appliedScope: DashboardCockpitScope;
  canViewTeam: boolean;
  scopeLabel: string;
  todayVisits: CockpitVisit[];
  processTiles: ProcessNowTile[];
  blockedReasons: BlockedReason[];
  evidence: EvidenceItem[];
  nextAction: NextActionPanelProps;
  teamHandoffSuggestion: string | null;
  urgentItems: DashboardUrgentItem[];
  urgentSourceLinks: DashboardUrgentSourceLink[];
  urgentTotalCount: number;
  commentsHiddenCount: number;
  inboundHiddenCount: number;
  inboundNeedsReviewCount: number;
};

export function useDashboardCockpitViewModel({
  summary,
  details,
  team,
  comments,
  inbound,
  requestedScope,
}: {
  summary: DashboardCockpitSummaryResponse | null;
  details: DashboardCockpitDetailsResponse | null;
  team: DashboardCockpitTeamResponse | null;
  comments: DashboardCockpitCommentsResponse | null;
  inbound: DashboardCockpitInboundResponse | null;
  requestedScope: DashboardCockpitScope;
}): DashboardCockpitViewModel {
  const appliedScope = summary?.scope?.applied ?? requestedScope;
  const canViewTeam = summary?.scope?.can_view_team ?? true;
  const scopeLabel = VIEW_SCOPE_LABELS[appliedScope] ?? VIEW_SCOPE_LABELS.mine;
  const todayVisits = details?.today_visits ?? EMPTY_VISITS;
  const urgentItems = details?.urgent_items ?? EMPTY_URGENT_ITEMS;
  const urgentSourceLinks = details?.urgent_source_links ?? EMPTY_URGENT_SOURCE_LINKS;

  const processTiles = useMemo(
    () => (summary ? buildProcessNowTiles(summary.cycle_status_counts) : []),
    [summary],
  );

  const blockedReasons = useMemo(() => buildDailyOpsBlockedReasons(details), [details]);

  const teamHandoffSuggestion = useMemo(
    () => (team ? buildTeamHandoffSuggestion(processTiles, team.team_capacity ?? []) : null),
    [processTiles, team],
  );

  const evidence = useMemo<EvidenceItem[]>(
    () => [
      {
        id: 'sync',
        label: '今朝の同期',
        meta: summary ? formatTimeOfDay(summary.generated_at) : '—',
      },
      {
        id: 'carryover',
        label: '昨日からの持ち越し',
        meta: `${details?.carryover_count ?? 0}件`,
        href: '/workflow',
      },
      {
        id: 'wip-guide',
        label: 'WIP目安の設定',
        meta: '標準値',
        href: '#dashboard-process-now',
      },
    ],
    [details?.carryover_count, summary],
  );

  const nextAction = useMemo(
    () => buildDashboardNextAction(urgentItems[0] ?? null, todayVisits.length),
    [todayVisits.length, urgentItems],
  );

  return {
    appliedScope,
    canViewTeam,
    scopeLabel,
    todayVisits,
    processTiles,
    blockedReasons,
    evidence,
    nextAction,
    teamHandoffSuggestion,
    urgentItems,
    urgentSourceLinks,
    urgentTotalCount: details?.urgent_total_count ?? 0,
    commentsHiddenCount: comments?.comments_hidden_count ?? 0,
    inboundHiddenCount: inbound?.inbound_hidden_count ?? 0,
    inboundNeedsReviewCount: inbound?.inbound_needs_review_count ?? 0,
  };
}
