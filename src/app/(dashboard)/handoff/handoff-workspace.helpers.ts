import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import type {
  BlockedReason,
  EvidenceItem,
  NextActionPanelProps,
} from '@/components/features/workspace/action-rail';
import { buildDailyOpsBlockedReasons } from '@/lib/workspace/daily-ops-rail';
import { formatElapsedLabel } from '@/lib/ui/relative-time';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { STATUS_TOKENS } from '@/lib/constants/status-tokens';
import { familyNameOf as sharedFamilyNameOf } from '@/lib/utils/person-name';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';

/**
 * new_12_handoff(ハンドオフ=責任の移動)の表示用ヘルパー。
 * 状態色規約: 承諾待ち=紫 / 作業中=青 / 確認中(期限近い)=橙 / 完了=灰。
 * 右レール(次にやること/止まっている理由)は当日オペレーション共有データ
 * (/api/dashboard/cockpit)から組み立てる(09_set/10_report/11_billing と共通の文脈)。
 */

export type HandoffLifecycleStatus = 'proposed' | 'in_progress' | 'confirming' | 'completed';

/** 相談の状態(p0_27 薬剤師に相談 / 事務へ戻す)。 */
export type HandoffConsultStatus = 'open' | 'checking' | 'returned_to_clerk' | 'resolved';

/** 薬剤師の対応(p0_27)。 */
export type HandoffResolutionAction =
  | 'acknowledged'
  | 'escalated_to_physician'
  | 'returned_to_clerk';

export type HandoffBoardItem = {
  id: string;
  content: string;
  priority: string;
  entity_type: string | null;
  entity_id: string | null;
  read_by: string[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  recipient_user_id: string | null;
  recipient_label: string | null;
  recipient_name: string | null;
  lifecycle_status: string | null;
  scope: string | null;
  rationale: string | null;
  deadline: string | null;
  progress_done: number | null;
  progress_total: number | null;
  direction: 'outgoing' | 'incoming';
  // --- 相談解決フロー(p0_27)。consult_status がある行は薬剤師相談として扱う。---
  consult_status: string | null;
  resolution_action: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
};

export type HandoffRecipientOption = {
  id: string;
  name: string;
  role: string;
  role_label: string;
};

export const CONSULT_STATUS_ORDER: HandoffConsultStatus[] = [
  'open',
  'checking',
  'returned_to_clerk',
  'resolved',
];

/**
 * 相談一覧のグループ見出し。状態色は 6 軸セマンティックトークンへ寄せる(bespoke な Tailwind
 * 色をベタ書きしない。SSOT 色)。未対応=confirm(橙/要対応) / 確認中=info(青) /
 * 事務へ戻し=waiting(紫/他者待ち) / 完了=done(緑)。
 */
export const CONSULT_STATUS_META: Record<
  HandoffConsultStatus,
  { label: string; countClassName: string; labelClassName: string }
> = {
  open: {
    label: '未対応',
    labelClassName: 'text-state-confirm',
    countClassName: 'text-state-confirm',
  },
  checking: {
    label: '確認中',
    labelClassName: 'text-tag-info',
    countClassName: 'text-tag-info',
  },
  returned_to_clerk: {
    label: '事務へ戻し',
    labelClassName: 'text-state-waiting',
    countClassName: 'text-state-waiting',
  },
  resolved: {
    label: '完了',
    labelClassName: 'text-state-done',
    countClassName: 'text-state-done',
  },
};

/** 薬剤師の対応ラベル。 */
export const RESOLUTION_ACTION_LABEL: Record<HandoffResolutionAction, string> = {
  acknowledged: '内容を確認した',
  escalated_to_physician: '医師へ確認する',
  returned_to_clerk: '事務へ戻す',
};

/** ハンドオフ項目の種別。consult=相談 / transfer=責任移転 / message=薬局内フリー連絡(伝言)。 */
export type HandoffItemKind = 'transfer' | 'consult' | 'message';

/**
 * 1テーブル(HandoffItem)に同居する3種別を列の有無で判別する。
 * consult_status あり=相談 / lifecycle_status あり=責任移転 / それ以外(宛先のみ)=伝言。
 */
export function handoffItemKind(
  item: Pick<HandoffBoardItem, 'lifecycle_status' | 'consult_status'>,
): HandoffItemKind {
  if (item.consult_status != null) return 'consult';
  if (item.lifecycle_status != null) return 'transfer';
  return 'message';
}

/** consult_status を持つ相談だけを取り出す。 */
export function consultItemsOf(items: HandoffBoardItem[]): HandoffBoardItem[] {
  return items.filter((item) => item.consult_status != null);
}

/** 伝言(フリー連絡)だけを取り出す。 */
export function messageItemsOf(items: HandoffBoardItem[]): HandoffBoardItem[] {
  return items.filter((item) => handoffItemKind(item) === 'message');
}

/** 責任移転(仕事を渡す)だけを取り出す。 */
export function transferItemsOf(items: HandoffBoardItem[]): HandoffBoardItem[] {
  return items.filter((item) => handoffItemKind(item) === 'transfer');
}

/** 相談を状態ごとに件数集計する。 */
export function countConsultByStatus(
  items: HandoffBoardItem[],
): Record<HandoffConsultStatus, number> {
  const counts: Record<HandoffConsultStatus, number> = {
    open: 0,
    checking: 0,
    returned_to_clerk: 0,
    resolved: 0,
  };
  for (const item of items) {
    const status = item.consult_status as HandoffConsultStatus | null;
    if (status && status in counts) {
      counts[status] += 1;
    }
  }
  return counts;
}

export type HandoffBoardResponse = {
  id: string;
  shift_date: string;
  items: HandoffBoardItem[];
  recipient_options: HandoffRecipientOption[];
  month_item_count: number;
  summary: {
    outgoing_count: number;
    incoming_count: number;
  };
};

export { formatTimeOfDay };

/** 経過分 → 「30分」「2時間」「1日」 */
export const formatAgeLabel = formatElapsedLabel;

/** 「田中 一郎」→「田中」 */
export const familyNameOf = sharedFamilyNameOf;

/** ヘッダーメタ「6/11(木) — 渡した3・来た0」 */
export function buildHeaderMeta(
  now: Date,
  summary: HandoffBoardResponse['summary'] | null,
): string {
  const dateLabel = format(now, 'M/d(EEE)', { locale: ja });
  if (!summary) return dateLabel;
  return `${dateLabel} — 渡した${summary.outgoing_count}・来た${summary.incoming_count}`;
}

/** 期限までの残り時間ラベル(「30分」「2時間」)。期限超過は「超過」。 */
export function remainingLabel(deadlineIso: string, now: Date): string {
  const remainingMinutes = Math.floor((new Date(deadlineIso).getTime() - now.getTime()) / 60_000);
  if (remainingMinutes < 0) return '超過';
  return formatAgeLabel(remainingMinutes);
}

export type HandoffStatusBadge = {
  label: string;
  className: string;
};

// 状態色は 6 軸セマンティック（STATUS_TOKENS）を正本とする。
// 承諾待ち=waiting(紫) / 作業中=info(青) / 確認中=confirm(橙) / 完了=done(緑) / 薬剤師相談・要確認=confirm。
export function buildStatusBadge(item: HandoffBoardItem, now: Date): HandoffStatusBadge {
  switch (item.lifecycle_status) {
    case 'proposed':
      return { label: '承諾待ち', className: STATUS_TOKENS.waiting.badgeClassName };
    case 'in_progress': {
      const progress =
        item.progress_done != null && item.progress_total != null
          ? ` ${item.progress_done}/${item.progress_total}`
          : '';
      return { label: `作業中${progress}`, className: STATUS_TOKENS.info.badgeClassName };
    }
    case 'confirming': {
      const remaining = item.deadline ? ` ${remainingLabel(item.deadline, now)}` : '';
      return { label: `確認中${remaining}`, className: STATUS_TOKENS.confirm.badgeClassName };
    }
    case 'completed':
      return { label: '完了', className: STATUS_TOKENS.done.badgeClassName };
    default:
      break;
  }
  if (item.consult_status) {
    return { label: '薬剤師相談', className: STATUS_TOKENS.confirm.badgeClassName };
  }
  return { label: '要確認', className: STATUS_TOKENS.confirm.badgeClassName };
}

/** 進捗率(0-100)。作業中以外・進捗未設定は null。 */
export function progressPercent(item: HandoffBoardItem): number | null {
  if (item.lifecycle_status !== 'in_progress') return null;
  if (item.progress_done == null || item.progress_total == null || item.progress_total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((item.progress_done / item.progress_total) * 100)));
}

/** 件名「セット先行準備(施設GH) → 鈴木さん(事務)」 */
export function buildItemTitle(item: HandoffBoardItem): string {
  const recipient = item.recipient_label ?? item.recipient_name;
  return recipient ? `${item.content} → ${recipient}` : item.content;
}

/**
 * サブ行の説明文。承諾待ち=根拠 / 作業中=許可済みの範囲 / 確認中=影響(根拠)。
 */
export function buildItemSubText(item: HandoffBoardItem): string | null {
  if (item.lifecycle_status === 'proposed') {
    return item.rationale ? `根拠: ${item.rationale}` : null;
  }
  if (item.lifecycle_status === 'in_progress') {
    return item.scope ? `許可済みの範囲: ${item.scope}` : null;
  }
  return item.rationale ?? item.scope ?? null;
}

/** 新デザインで使う戻り先(ダッシュボード/セット/報告・共有)+既存 entity 種別 */
const WORKSPACE_ENTITY_ACTIONS: Record<string, { href: string; label: string }> = {
  dashboard: { href: '/dashboard', label: '→ ダッシュボードへ' },
  medication_set: { href: '/set', label: '→ セットへ' },
  set_plan: { href: '/set', label: '→ セットへ' },
  reports: { href: '/reports', label: '→ 報告・共有へ' },
};

export function buildItemEntityAction(
  item: Pick<HandoffBoardItem, 'entity_type' | 'entity_id'>,
): { href: string; label: string } | null {
  if (item.entity_type && WORKSPACE_ENTITY_ACTIONS[item.entity_type]) {
    return WORKSPACE_ENTITY_ACTIONS[item.entity_type];
  }
  return null;
}

/**
 * 次にやること: 監査キュー先頭(麻薬優先)を主操作にする。
 * 12_handoff の主操作(青)は「+ 仕事を渡す」なので、レール側ボタンは
 * 共通文言のまま据え置き(画面の主操作はヘッダー側 1 つ)。
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
    return {
      actionLabel: topAudit.due_at
        ? `${auditLabel}を開始 — ${formatTimeOfDay(topAudit.due_at)}期限`
        : `${auditLabel}を開始する`,
      description: visit?.time_start
        ? `${formatTimeOfDay(visit.time_start)}訪問(${familyNameOf(topAudit.patient_name)}様)の持参薬です。完了で午後の予定がすべて確定します。`
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
  return buildDailyOpsBlockedReasons(cockpit);
}

/**
 * 許可済み事務作業の範囲の規程版数。委譲規程の管理データソースが未整備のため
 * 表示用の固定値(整備後は設定 API から取得する)。
 */
export const CLERICAL_SCOPE_POLICY_VERSION = '規程 v3';

/** 根拠・記録: ハンドオフ履歴 / 許可済み事務作業の範囲 */
export function buildHandoffEvidence(board: HandoffBoardResponse | null): EvidenceItem[] {
  return [
    {
      id: 'handoff-history',
      label: 'ハンドオフ履歴',
      meta: `今月${board?.month_item_count ?? 0}件`,
      href: '/handoff',
    },
    {
      id: 'clerical-scope',
      label: '許可済み事務作業の範囲',
      meta: CLERICAL_SCOPE_POLICY_VERSION,
      href: '/admin/staff',
    },
  ];
}
