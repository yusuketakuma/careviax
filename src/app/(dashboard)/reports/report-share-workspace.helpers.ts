import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type { EvidenceItem } from '@/components/features/workspace/action-rail';
import { buildExternalHref } from '@/lib/dashboard/home-link-builders';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { familyNameOf as sharedFamilyNameOf } from '@/lib/utils/person-name';
import type { ReportsTodayWorkspaceResponse } from '@/types/reports-today-workspace';

/**
 * new_10_report(報告・共有)の表示用ヘルパー。
 * 右レール(次にやること/止まっている理由)は `/api/care-reports/today-workspace`
 * の action_rail contract から組み立てる。/reports では dashboard cockpit を再取得しない。
 */

export { formatTimeOfDay };

/** 経過分 → 「30分」「2時間」「1日」 */
export const formatAgeLabel = formatElapsedLabel;

/** 「田中 一郎」→「田中」 */
export const familyNameOf = sharedFamilyNameOf;

/** ヘッダーメタ「6/11(木) — 書く3件・候補1件・待つ2件・解決1件」 */
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
  return `${dateLabel} — 書く${counts.to_write}件・候補${counts.report_candidates}件・課題${openIssueLabel}・作成済み${counts.created}件・待つ${counts.waiting}件・解決${counts.resolved}件`;
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
