import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { japanDateKey } from '@/lib/utils/date-boundary';

export type ExpiryThresholds = {
  /**
   * これ以内(日)は blocked(赤=至急)。既定 30 日(SSOT 7.3)。
   * 30 未満へは**緩和不可**(数値規範の下限 floor、改版規律 1.3)— 指定は広げる方向のみ有効。
   */
  criticalWithinDays?: number;
  /**
   * これ以内(日)は confirm(橙=要確認)。既定 90 日(SSOT 7.3)。
   * 90 未満へは**緩和不可**(floor)— 指定は広げる方向のみ有効。
   */
  warnWithinDays?: number;
};

export type ExpiryBadgeProps = {
  /**
   * 期限日。null/undefined/空文字 は「期限未設定」を中立で示す。
   * パースできない不正値は「期限日を確認」(要確認/橙) として未設定とは分離する（false-empty 防止）。
   */
  date: Date | string | null | undefined;
  /** 残日数→role の 2 段閾値(SSOT 7.3: 期限切れ/30日以内=blocked、90日以内=confirm、以遠=中立)。 */
  thresholds?: ExpiryThresholds;
  /** 比較基準日（テスト用に注入可。既定は現在時刻）。 */
  now?: Date;
  /**
   * true で「yyyy/MM/dd（期限切れ）」「yyyy/MM/dd（残N日）」の日付主体表記にする
   * （admin 一覧セル互換）。未設定はバッジでなく muted「—」を返す。
   */
  showDate?: boolean;
  className?: string;
};

export type ExpiryStatus = 'expired' | 'due-critical' | 'due-soon' | 'ok' | 'unset' | 'invalid';

const STATUS_ROLE: Record<ExpiryStatus, StatusRole> = {
  // 期限切れ/30日以内=赤(止まる/至急) / 90日以内=橙(要確認) / 期限内=灰(中立) / 未設定=灰 / 不正値=橙(要確認)
  expired: 'blocked',
  'due-critical': 'blocked',
  'due-soon': 'confirm',
  ok: 'readonly',
  unset: 'readonly',
  invalid: 'confirm',
};

/**
 * 日本業務日(Asia/Tokyo の date key)基準の残日数。ランタイム TZ に依存させない
 * (SSOT 2.8 Japan domestic date basis / JST 境界バグの再発防止)。
 */
function diffJstCalendarDays(target: Date, now: Date): number {
  const toUtcMidnight = (key: string) => Date.parse(`${key}T00:00:00Z`);
  return Math.round(
    (toUtcMidnight(japanDateKey(target)) - toUtcMidnight(japanDateKey(now))) / 86_400_000,
  );
}

/**
 * 期限を「期限切れ(赤) / 30日以内(赤) / 90日以内(橙) / 期限内(中立) / 未設定(中立) / 不正値(要確認)」
 * の 2 段閾値で表す(SSOT 7.3)。偽シグナル防止のため、状態はカテゴリ固定ではなく `date` と `now` の
 * 差から都度計算する。不正値（パース不能）は「未設定」と混同せず分離する（false-empty 防止）。
 * 色だけに依存しない（StateBadge がアイコン+テキストを常に伴う）。
 */
function normalizedThreshold(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function classifyExpiry(
  date: Date | string | null | undefined,
  thresholds: ExpiryThresholds = {},
  now: Date = new Date(),
): { status: ExpiryStatus; days: number | null } {
  // SSOT 7.3 の数値規範(<=30=blocked / <=90=confirm)は普遍下限。カスタム閾値は
  // 「広げる」方向のみ許可し、下回る指定は floor へ引き上げる(改版規律 1.3: 緩和不可)。
  const criticalWithinDays = Math.max(normalizedThreshold(thresholds.criticalWithinDays, 30), 30);
  const warnWithinDays = Math.max(
    normalizedThreshold(thresholds.warnWithinDays, 90),
    90,
    criticalWithinDays,
  );
  if (date == null || date === '') return { status: 'unset', days: null };
  const target = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(target.getTime())) return { status: 'invalid', days: null };
  const days = diffJstCalendarDays(target, now);
  if (days < 0) return { status: 'expired', days };
  if (days <= criticalWithinDays) return { status: 'due-critical', days };
  if (days <= warnWithinDays) return { status: 'due-soon', days };
  return { status: 'ok', days };
}

function relativeLabel(status: ExpiryStatus, days: number | null): string {
  switch (status) {
    case 'expired':
      return days === -1 ? '昨日 期限切れ' : `${Math.abs(days ?? 0)}日 期限切れ`;
    case 'due-critical':
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

function dateLabel(status: ExpiryStatus, days: number | null, formatted: string): string {
  switch (status) {
    case 'expired':
      return `${formatted}（期限切れ）`;
    case 'due-critical':
    case 'due-soon':
      return `${formatted}（残${days}日）`;
    case 'ok':
      return formatted;
    case 'unset':
      return '期限未設定';
    case 'invalid':
      return '期限日を確認';
  }
}

export function ExpiryBadge({
  date,
  thresholds,
  now,
  showDate = false,
  className,
}: ExpiryBadgeProps) {
  const { status, days } = classifyExpiry(date, thresholds, now);
  if (showDate && status === 'unset') {
    // admin 一覧セル互換: 未設定はバッジにせず muted で。取得失敗(不正値)とは分離済み。
    return <span className={className ?? 'text-xs text-muted-foreground'}>—</span>;
  }
  // 表示日付も分類と同じ日本業務日 date key から導く(ランタイム TZ で分類と表示が
  // 食い違う JST 境界バグを防ぐ。SSOT 2.8)。
  const text = showDate
    ? dateLabel(
        status,
        days,
        date && status !== 'invalid'
          ? japanDateKey(typeof date === 'string' ? new Date(date) : date).replaceAll('-', '/')
          : '',
      )
    : relativeLabel(status, days);
  return (
    <StateBadge role={STATUS_ROLE[status]} className={className}>
      <span className="tabular-nums">{text}</span>
    </StateBadge>
  );
}
