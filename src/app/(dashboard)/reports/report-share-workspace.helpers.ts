import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type {
  BlockedReason,
  EvidenceItem,
  NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { buildExternalHref } from '@/lib/dashboard/home-link-builders';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { familyNameOf as sharedFamilyNameOf } from '@/lib/utils/person-name';
import { timeIsoToString } from '@/lib/visits/time-of-day';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { ReportsTodayWorkspaceResponse } from '@/types/reports-today-workspace';

/**
 * new_10_report(報告・共有)の表示用ヘルパー。
 * 右レール(次にやること/止まっている理由)は当日オペレーション共有データ
 * (/api/dashboard/cockpit)から組み立てる(09_set/11_billing/12_handoff と共通の文脈)。
 */

export { formatTimeOfDay };

/** 経過分 → 「30分」「2時間」「1日」 */
export const formatAgeLabel = formatElapsedLabel;

/** 「田中 一郎」→「田中」 */
export const familyNameOf = sharedFamilyNameOf;

/** ヘッダーメタ「6/11(木) — 書く3件・待つ2件・解決1件」 */
export function buildHeaderMeta(
  now: Date,
  counts: ReportsTodayWorkspaceResponse['counts'] | null,
): string {
  const dateLabel = format(now, 'M/d(EEE)', { locale: ja });
  if (!counts) return dateLabel;
  return `${dateLabel} — 書く${counts.to_write}件・課題${counts.open_issues}件・作成済み${counts.created}件・待つ${counts.waiting}件・解決${counts.resolved}件`;
}

/** 返信待ちの経過バッジ「3日経過」(送付当日は「本日送付」) */
export function waitingBadgeLabel(waitingDays: number): string {
  return waitingDays >= 1 ? `${waitingDays}日経過` : '本日送付';
}

/**
 * 次にやること: 監査キュー先頭(麻薬優先)を主操作にする。
 * 説明文は本日の同患者訪問と結合し「14:00訪問(田中様)の持参薬です。…」を出す。
 */
export function buildWorkspaceNextAction(
  cockpit: DashboardCockpitResponse | null,
): NextActionPanelProps {
  const topAudit = cockpit?.audit_queue[0] ?? null;
  if (topAudit) {
    const auditLabel = topAudit.has_narcotic ? '麻薬監査' : '監査';
    const visit =
      cockpit?.today_visits.find(
        (candidate) => candidate.patient_name === topAudit.patient_name && candidate.time_start,
      ) ?? null;
    const visitTimeLabel = visit?.time_start ? timeIsoToString(visit.time_start) : null;
    return {
      actionLabel: topAudit.due_at
        ? `${auditLabel}を開始 — ${formatTimeOfDay(topAudit.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: visitTimeLabel
        ? `${visitTimeLabel}訪問(${familyNameOf(topAudit.patient_name)}様)の持参薬です。完了で午後の予定がすべて確定します。`
        : `${topAudit.patient_name} 様の監査待ちです。完了で次の工程が動き出します。`,
      actionHref: '/audit',
    };
  }
  if ((cockpit?.today_visits.length ?? 0) > 0) {
    return {
      actionLabel: '訪問準備を確認する',
      description: `本日の訪問 ${cockpit?.today_visits.length}件の準備状況を確認します。`,
      actionHref: '/schedules',
    };
  }
  return {
    actionLabel: '今日の予定を確認する',
    description: 'いま期限で止まっている作業はありません。',
    actionHref: '/schedules',
  };
}

/** 止まっている理由: cockpit の blocked_reasons をレール表示形へ変換 */
export function buildWorkspaceBlockedReasons(
  cockpit: DashboardCockpitResponse | null,
): BlockedReason[] {
  return (cockpit?.blocked_reasons ?? []).map((reason) => ({
    id: reason.id,
    label: reason.label,
    severity: reason.severity,
    categoryLabel: reason.category ?? undefined,
    ageLabel: formatAgeLabel(reason.age_minutes),
    actionLabel: reason.action_label,
    actionHref: reason.action_href,
  }));
}

/** 根拠・記録: 送付テンプレート / 送付履歴 / 既読確認 */
export function buildReportEvidence(
  workspace: ReportsTodayWorkspaceResponse | null,
): EvidenceItem[] {
  return [
    {
      id: 'send-templates',
      label: '送付テンプレート',
      meta: `${workspace?.evidence.template_count ?? 0}種`,
      href: '/admin/document-templates',
    },
    {
      id: 'delivery-history',
      label: '送付履歴',
      meta: `今月${workspace?.evidence.monthly_delivery_count ?? 0}件`,
      href: '/communications/requests?status=sent',
    },
    {
      id: 'read-receipt',
      label: '既読確認',
      meta: 'ポータル連携',
      href: buildExternalHref({ focus: 'shares' }),
    },
  ];
}
