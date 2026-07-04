import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type {
  BlockedReason,
  EvidenceItem,
  NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { buildExternalHref } from '@/lib/dashboard/home-link-builders';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import {
  buildDailyOpsBlockedReasons,
  buildDailyOpsNextAction,
} from '@/lib/workspace/daily-ops-rail';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { familyNameOf as sharedFamilyNameOf } from '@/lib/utils/person-name';
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
  countMetadata?: ReportsTodayWorkspaceResponse['count_metadata'] | null,
): string {
  const dateLabel = format(now, 'M/d(EEE)', { locale: ja });
  if (!counts) return dateLabel;
  const openIssueLabel =
    countMetadata?.open_issues?.count_basis === 'database_total' ||
    countMetadata?.open_issues?.count_basis === 'full_result'
      ? `${counts.open_issues}件`
      : `抽出内${counts.open_issues}件`;
  return `${dateLabel} — 書く${counts.to_write}件・課題${openIssueLabel}・作成済み${counts.created}件・待つ${counts.waiting}件・解決${counts.resolved}件`;
}

type WorkspaceCount =
  ReportsTodayWorkspaceResponse['count_metadata'][keyof ReportsTodayWorkspaceResponse['count_metadata']];

export function formatWorkspaceCountLabel(
  count: WorkspaceCount | null | undefined,
  visibleFallback: number,
): string {
  if (!count) return `${visibleFallback}件`;
  const prefix =
    count.count_basis === 'database_total' || count.count_basis === 'full_result' ? '' : '抽出内';
  if (count.hidden_count > 0) {
    return `${prefix}先頭${count.visible_count}件 / 他${count.hidden_count}件`;
  }
  return `${prefix}${count.visible_count}件`;
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
  const firstVisit = cockpit?.today_visits[0] ?? null;
  const visitCount = cockpit?.today_visits.length ?? 0;
  return buildDailyOpsNextAction(cockpit, {
    actionLabel: firstVisit ? '訪問準備を確認する' : '今日の予定を確認する',
    description:
      visitCount > 0
        ? `本日の訪問 ${visitCount}件の準備状況を確認します。`
        : 'いま期限で止まっている作業はありません。',
    actionHref: firstVisit ? buildScheduleFocusHref(firstVisit.id) : '/schedules',
  });
}

/** 止まっている理由: cockpit の blocked_reasons をレール表示形へ変換 */
export function buildWorkspaceBlockedReasons(
  cockpit: DashboardCockpitResponse | null,
): BlockedReason[] {
  return buildDailyOpsBlockedReasons(cockpit);
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
