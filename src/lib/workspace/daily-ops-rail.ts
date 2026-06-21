import type { CockpitAuditQueueItem, DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import { formatElapsedLabel } from '@/lib/datetime/relative-time';
import { formatTimeOfDay as formatDailyOpsTime } from '@/lib/datetime/time-of-day';
import { familyNameOf } from '@/lib/utils/person-name';

export { familyNameOf };
export { formatDailyOpsTime };

/**
 * design/images/new の右レール「次にやること / 止まっている理由」共通ビルダー。
 * 05_import / 09_set / 10_report は同一の「当日オペレーション状態」
 * (麻薬監査の期限・家族同意待ち・送付先確認)を共有する想定のため
 * (docs/design-gap-analysis-new.md「右レール用は 09_set と共通」)、
 * 既存 /api/dashboard/cockpit の集計をそのまま画面横断で使う。
 */

/** 経過分 → 「30分」「2時間」「1日」(止まっている理由の経過時間表示)。 */
export const formatDailyOpsAgeLabel = formatElapsedLabel;

function describeTopAudit(topAudit: CockpitAuditQueueItem, data: DashboardCockpitResponse): string {
  const visit = data.today_visits.find(
    (candidate) => candidate.patient_name === topAudit.patient_name && candidate.time_start,
  );
  if (visit?.time_start) {
    return `${formatDailyOpsTime(visit.time_start)}訪問(${familyNameOf(topAudit.patient_name)}様)の持参薬です。完了で午後の予定がすべて確定します。`;
  }
  return `${topAudit.patient_name} 様の監査待ちです。完了で次の工程が動き出します。`;
}

export type DailyOpsNextActionFallback = {
  actionLabel: string;
  actionHref: string;
  description: string;
};

export type DailyOpsNextAction = {
  description?: string;
  actionLabel: string;
  actionHref?: string;
};

export type DailyOpsBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  categoryLabel?: string;
  ageLabel?: string;
  actionLabel?: string;
  actionHref?: string;
};

/**
 * 右レール「次にやること」(主操作はこの 1 つだけ青)。
 * 監査キュー先頭(麻薬優先)があれば「(麻薬)監査を開始 — HH:mm期限」、
 * 無ければ画面ごとのフォールバックを返す。
 */
export function buildDailyOpsNextAction(
  data: DashboardCockpitResponse | null,
  fallback: DailyOpsNextActionFallback,
): DailyOpsNextAction {
  const topAudit = data?.audit_queue[0] ?? null;
  if (topAudit && data) {
    const auditLabel = topAudit.has_narcotic ? '麻薬監査' : '監査';
    return {
      actionLabel: topAudit.due_at
        ? `${auditLabel}を開始 — ${formatDailyOpsTime(topAudit.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: describeTopAudit(topAudit, data),
      actionHref: '/audit',
    };
  }
  return {
    actionLabel: fallback.actionLabel,
    actionHref: fallback.actionHref,
    description: fallback.description,
  };
}

/** 右レール「止まっている理由」(カテゴリ色チップ+経過時間+個別アクション)。 */
export function buildDailyOpsBlockedReasons(
  data: DashboardCockpitResponse | null,
): DailyOpsBlockedReason[] {
  return (data?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category ?? undefined,
    ageLabel: formatDailyOpsAgeLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));
}
