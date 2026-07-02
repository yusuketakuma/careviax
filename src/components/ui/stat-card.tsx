import * as React from 'react';
import { cn } from '@/lib/utils';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import { StatusDot } from '@/components/ui/status-dot';

export type StatCardProps = {
  /** 上部の小見出し（指標名）。 */
  label: string;
  /** label の要素。画面内の見出し階層を保つ必要がある場合だけ指定する。 */
  labelElement?: 'span' | 'h2' | 'h3';
  labelClassName?: string;
  /** 主数値。等幅数字で表示する。 */
  value: React.ReactNode;
  /** 主数値の追加 className。状態を数値そのものへ塗らない画面では中立色を明示する。 */
  valueClassName?: string;
  /** 数値の後置単位（件 / % / 円 など）。 */
  unit?: string;
  /** 補足（前期間比・内訳など）。 */
  hint?: React.ReactNode;
  /**
   * 状態アクセント。指定時のみ左ボーダー＋小ドットで色を点す（全面塗りしない）。
   * 良し悪しが「ない」中立指標では undefined のままにする。
   */
  role?: StatusRole;
  /** role の表示ラベル。未指定なら role の標準ラベル。 */
  roleLabel?: string;
  /** role ラベルを視覚表示するか。false でも sr-only ラベルは出す。 */
  showRoleLabel?: boolean;
  /** アイコン（指標名の左に小さく添える）。 */
  icon?: React.ReactNode;
  /** アイコン wrapper の追加 className。レスポンシブ表示制御が必要な画面で使う。 */
  iconClassName?: string;
  /** 補足 wrapper の追加 className。レスポンシブ表示制御が必要な画面で使う。 */
  hintClassName?: string;
  /** 進捗バー。指定時のみ中立 track と clamped fill を表示する。 */
  progress?: {
    percent: number;
    className?: string;
  };
  /**
   * フィルタチップとして使うとき。指定するとボタンとして描画し aria-pressed を付ける。
   * 監査の「選択中キューが視覚的に判別できない」是正用。
   */
  onSelect?: () => void;
  /** onSelect 指定時、現在選択中か。 */
  active?: boolean;
  className?: string;
};

function clampProgressPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(Math.max(percent, 0), 100);
}

/**
 * KPI / 件数ストリップの共通カード。各画面で再実装されていた MetricCard/KpiCard/SummaryCard を統合する。
 * - 数値は tabular-nums（縦揃え・誤読防止）。
 * - 状態色は左ボーダー＋ドットの「点・線」のみ（塗り面積最小、全面塗り禁止）。
 * - onSelect 指定でフィルタチップ化（button + aria-pressed）。
 */
export function StatCard({
  label,
  labelElement: LabelElement = 'span',
  labelClassName,
  value,
  valueClassName,
  unit,
  hint,
  role,
  roleLabel,
  showRoleLabel = false,
  icon,
  iconClassName,
  hintClassName,
  progress,
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
          <span aria-hidden className={cn('text-muted-foreground/80', iconClassName)}>
            {icon}
          </span>
        ) : null}
        <LabelElement className={cn('truncate', labelClassName)}>{label}</LabelElement>
        {role ? (
          <StatusDot
            role={role}
            label={roleLabel}
            showLabel={showRoleLabel}
            className="ml-auto shrink-0 text-muted-foreground"
          />
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            'font-heading text-2xl leading-none font-semibold tabular-nums',
            valueClassName,
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      {hint ? (
        <div className={cn('mt-1 text-xs text-muted-foreground', hintClassName)}>{hint}</div>
      ) : null}
      {progress ? (
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', progress.className ?? 'bg-muted-foreground/45')}
            style={{ width: `${clampProgressPercent(progress.percent)}%` }}
          />
        </div>
      ) : null}
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
