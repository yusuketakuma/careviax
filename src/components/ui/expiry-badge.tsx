import { differenceInCalendarDays } from 'date-fns';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';

export type ExpiryBadgeProps = {
  /**
   * 期限日。null/undefined/空文字 は「期限未設定」を中立で示す。
   * パースできない不正値は「期限日を確認」(要確認/橙) として未設定とは分離する（false-empty 防止）。
   */
  date: Date | string | null | undefined;
  /** これ以内に迫ると「要確認(橙)」にする日数。既定 30 日。 */
  warnWithinDays?: number;
  /** 比較基準日（テスト用に注入可。既定は現在時刻）。 */
  now?: Date;
  /** 期限内（余裕あり）のときバッジを出さず null を返す。一覧の視覚ノイズ削減用。 */
  hideWhenOk?: boolean;
  className?: string;
};

export type ExpiryStatus = 'expired' | 'due-soon' | 'ok' | 'unset' | 'invalid';

const STATUS_ROLE: Record<ExpiryStatus, StatusRole> = {
  // 期限切れ=赤(止まっている/失効) / 期限間近=橙(要確認) / 期限内=灰(閲覧のみ=中立) / 未設定=灰 / 不正値=橙(要確認)
  expired: 'blocked',
  'due-soon': 'confirm',
  ok: 'readonly',
  unset: 'readonly',
  invalid: 'confirm',
};

/**
 * 期限を「期限切れ(赤) / あとN日(橙) / 期限内(中立) / 未設定(中立) / 不正値(要確認)」の段階で表す。
 * 偽シグナル防止のため、状態はカテゴリ固定ではなく `date` と `now` の差から都度計算する。
 * 不正値（パース不能）は「未設定」と混同せず分離する（取得失敗・入力誤りを空に潰さない＝false-empty 防止）。
 * 色だけに依存しない（StateBadge がアイコン+テキストを常に伴う）。
 */
export function classifyExpiry(
  date: Date | string | null | undefined,
  warnWithinDays = 30,
  now: Date = new Date(),
): { status: ExpiryStatus; days: number | null } {
  if (date == null || date === '') return { status: 'unset', days: null };
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return { status: 'invalid', days: null };
  const days = differenceInCalendarDays(target, now);
  if (days < 0) return { status: 'expired', days };
  if (days <= warnWithinDays) return { status: 'due-soon', days };
  return { status: 'ok', days };
}

function label(status: ExpiryStatus, days: number | null): string {
  switch (status) {
    case 'expired':
      return days === -1 ? '昨日 期限切れ' : `${Math.abs(days ?? 0)}日 期限切れ`;
    case 'due-soon':
      return days === 0 ? '本日まで' : `あと${days}日`;
    case 'ok':
      return '期限内';
    case 'unset':
      return '期限未設定';
    case 'invalid':
      return '期限日を確認';
  }
}

export function ExpiryBadge({
  date,
  warnWithinDays = 30,
  now,
  hideWhenOk = false,
  className,
}: ExpiryBadgeProps) {
  const { status, days } = classifyExpiry(date, warnWithinDays, now);
  if (hideWhenOk && status === 'ok') return null;
  return (
    <StateBadge role={STATUS_ROLE[status]} className={className}>
      <span className="tabular-nums">{label(status, days)}</span>
    </StateBadge>
  );
}
