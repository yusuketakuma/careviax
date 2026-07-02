import * as React from 'react';
import { cn } from '@/lib/utils';
import { StateBadge } from '@/components/ui/state-badge';
import { STATUS_TOKENS } from '@/lib/constants/status-tokens';
import { Skeleton } from '@/components/ui/loading';

/**
 * 重大度。呼び出し側が「値 × 閾値」で都度算出して渡す。
 * カテゴリ固定で常時点灯させない（偽シグナル＝alert fatigue 防止）。
 */
export type SignalSeverity = 'normal' | 'warning' | 'critical';

export type SignalTileProps = {
  label: string;
  /** 主数値。等幅数字で表示。loading 中は無視される。 */
  value?: React.ReactNode;
  unit?: string;
  /** 値×閾値から算出した重大度。normal では色を点さない。 */
  severity?: SignalSeverity;
  /** 閾値や基準の補足（例: "目標 < 500ms"）。 */
  hint?: React.ReactNode;
  /** 重大度がついたときのバッジ文言（既定: 要確認/緊急）。 */
  badgeLabel?: string;
  /**
   * ロード中。true の間はスケルトンを描画し、値や 0 を実測のように見せない（false-zero 防止）。
   */
  loading?: boolean;
  className?: string;
};

// アクセントは SSOT(STATUS_TOKENS.accentClassName)へ寄せる。normal は中立のため role を持たない。
const SEVERITY_ACCENT: Record<SignalSeverity, string> = {
  normal: 'border-l-foreground/15',
  warning: STATUS_TOKENS.confirm.accentClassName,
  critical: STATUS_TOKENS.blocked.accentClassName,
};

const SEVERITY_BADGE: Record<
  Exclude<SignalSeverity, 'normal'>,
  { role: 'confirm' | 'blocked'; label: string }
> = {
  warning: { role: 'confirm', label: '要確認' },
  critical: { role: 'blocked', label: '緊急' },
};

/**
 * 監視ダッシュボードの信号タイル（performance/realtime/analytics 等で重複していた表現を統合）。
 * 設計の要点:
 * - 全面塗りしない。重大度は左ボーダー＋小バッジの「点・線・ラベル」で示す（塗り面積最小）。
 * - severity は値×閾値で都度算出して渡す。normal では一切色を点さない。
 * - loading 中はスケルトン。0 を実測値のように描かない（取得失敗・ロードと空を混同しない）。
 */
export function SignalTile({
  label,
  value,
  unit,
  severity = 'normal',
  hint,
  badgeLabel,
  loading = false,
  className,
}: SignalTileProps) {
  const badge = severity === 'normal' ? null : SEVERITY_BADGE[severity];
  // loading でなく値が無い＝取得不能。空欄で実測のように見せず明示する（false-empty 防止）。
  const unavailable = !loading && (value === null || value === undefined);

  return (
    <div
      data-severity={severity}
      aria-busy={loading || undefined}
      className={cn(
        'rounded-md border border-l-2 bg-card p-3 ring-1 ring-foreground/10',
        SEVERITY_ACCENT[severity],
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {badge ? (
          <StateBadge role={badge.role} className="ml-auto">
            {badgeLabel ?? badge.label}
          </StateBadge>
        ) : null}
      </div>
      {loading ? (
        <div className="mt-2">
          <Skeleton className="h-7 w-20" data-slot="signal-skeleton" />
          <span role="status" className="sr-only">
            読み込み中
          </span>
        </div>
      ) : unavailable ? (
        <div className="mt-1 flex items-baseline gap-1" data-slot="signal-unavailable">
          <span
            aria-hidden
            className="font-heading text-2xl leading-none font-semibold text-muted-foreground"
          >
            —
          </span>
          <span className="sr-only">データなし</span>
        </div>
      ) : (
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-heading text-2xl leading-none font-semibold tabular-nums">
            {value}
          </span>
          {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
        </div>
      )}
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
