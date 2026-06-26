import * as React from 'react';
import { cn } from '@/lib/utils';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';

export type StatCardProps = {
  /** 上部の小見出し（指標名）。 */
  label: string;
  /** 主数値。等幅数字で表示する。 */
  value: React.ReactNode;
  /** 数値の後置単位（件 / % / 円 など）。 */
  unit?: string;
  /** 補足（前期間比・内訳など）。 */
  hint?: React.ReactNode;
  /**
   * 状態アクセント。指定時のみ左ボーダー＋小ドットで色を点す（全面塗りしない）。
   * 良し悪しが「ない」中立指標では undefined のままにする。
   */
  role?: StatusRole;
  /** アイコン（指標名の左に小さく添える）。 */
  icon?: React.ReactNode;
  /**
   * フィルタチップとして使うとき。指定するとボタンとして描画し aria-pressed を付ける。
   * 監査の「選択中キューが視覚的に判別できない」是正用。
   */
  onSelect?: () => void;
  /** onSelect 指定時、現在選択中か。 */
  active?: boolean;
  className?: string;
};

/**
 * KPI / 件数ストリップの共通カード。各画面で再実装されていた MetricCard/KpiCard/SummaryCard を統合する。
 * - 数値は tabular-nums（縦揃え・誤読防止）。
 * - 状態色は左ボーダー＋ドットの「点・線」のみ（塗り面積最小、全面塗り禁止）。
 * - onSelect 指定でフィルタチップ化（button + aria-pressed）。
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  role,
  icon,
  onSelect,
  active = false,
  className,
}: StatCardProps) {
  // 状態色は SSOT(STATUS_TOKENS)の完全な静的クラス文字列のみ使う（動的クラス名は Tailwind が検出できない）。
  const spec = role ? STATUS_TOKENS[role] : null;
  const accent = spec ? spec.accentClassName : 'border-l-transparent';

  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon ? (
          <span aria-hidden className="text-muted-foreground/80">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
        {spec ? (
          <span
            aria-hidden
            className={cn('ml-auto size-2 shrink-0 rounded-full', spec.dotClassName)}
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-heading text-2xl leading-none font-semibold tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );

  const base = cn(
    'block rounded-md border border-l-2 bg-card p-3 text-left ring-1 ring-foreground/10',
    accent,
    className,
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        data-active={active}
        className={cn(
          base,
          // タッチターゲット 44px 以上を部品契約として固定（WCAG 2.2 / 医療現場）。
          'min-h-11 min-w-11 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[active=true]:ring-2 data-[active=true]:ring-primary',
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={base}>{body}</div>;
}
