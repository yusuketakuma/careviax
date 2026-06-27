import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 月次カレンダーの汎用 UI プリミティブ。
 *
 * 業務セマンティクス（休業日・服薬スロット等）は持たず、日曜/月曜始まり・先頭空セル
 * パディング・grid-cols-7 レイアウト・前月/翌月ナビという「月グリッドの骨格」だけを提供する。
 * 各画面は `renderDay` でセル内容を、`getDayCellProps` でセル自体の挙動（clickable/selected 等）を注入する。
 *
 * docs/shared-month-grid-plan.md（R3）参照。
 */

/** 月内の 1 日を表すセル。dateKey は local 暦の `YYYY-MM-DD`（ゼロ埋め）。 */
export type MonthGridCell = { day: number; dateKey: string };

const WEEKDAY_LABELS_SUN = ['日', '月', '火', '水', '木', '金', '土'];

/** 既定の曜日見出しを weekStartsOn 起点に回転する（日始まり→月始まり等）。 */
function defaultWeekdayLabels(weekStartsOn: 0 | 1): string[] {
  return [...WEEKDAY_LABELS_SUN.slice(weekStartsOn), ...WEEKDAY_LABELS_SUN.slice(0, weekStartsOn)];
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function monthDateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** その月 1 日の曜日（0=日）。 */
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

/**
 * 月グリッドのセル配列を生成する。先頭に weekStartsOn を起点とした空セル（null）が入り、
 * その後 1..daysInMonth のセルが続く。挙動は各画面の現行ロジックと同一。
 */
export function useMonthGrid(params: { year: number; month: number; weekStartsOn?: 0 | 1 }): {
  cells: Array<MonthGridCell | null>;
  daysInMonth: number;
  firstWeekday: number;
} {
  const { year, month, weekStartsOn = 0 } = params;
  const daysInMonth = getDaysInMonth(year, month);
  // weekStartsOn を考慮した先頭オフセット（0..6）。
  const firstWeekday = (getFirstDayOfWeek(year, month) - weekStartsOn + 7) % 7;
  const cells: Array<MonthGridCell | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      dateKey: monthDateKey(year, month, index + 1),
    })),
  ];
  return { cells, daysInMonth, firstWeekday };
}

export type MonthGridNavProps = {
  year: number;
  month: number; // 0-11
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
};

/** 前月/翌月ナビ。PageSection の actions にそのまま差し込める独立部品。 */
export function MonthGridNav({
  year,
  month,
  onPrev,
  onNext,
  prevLabel = '前月',
  nextLabel = '翌月',
}: MonthGridNavProps) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onPrev} aria-label={prevLabel}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-24 text-center text-sm font-medium">
        {year}年{month + 1}月
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onNext} aria-label={nextLabel}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export type MonthGridProps = {
  year: number;
  month: number; // 0-11
  weekStartsOn?: 0 | 1;
  /** 省略時は weekStartsOn を起点に既定ラベル（日..土）を回転して使う。 */
  weekdayLabels?: string[];
  /** 日=text-state-blocked / 土=text-tag-info で曜日見出しを着色（実曜日基準）。 */
  weekendHeaderColors?: boolean;
  /** グリッド全体に付与する aria-label。 */
  ariaLabel?: string;
  /** グリッドコンテナの class（既定の枠線レイアウトを上書き）。 */
  className?: string;
  /** 日セルの class（既定 `min-h-16 bg-card p-1`）。 */
  cellClassName?: string;
  /** 空セルの class（既定 `min-h-16 bg-card`）。 */
  emptyCellClassName?: string;
  /** 日セル <div> へ merge する属性（onClick / aria-pressed / tabIndex 等）。 */
  getDayCellProps?: (cell: MonthGridCell) => HTMLAttributes<HTMLDivElement>;
  /** セル内容（日番号含む）を描画。 */
  renderDay: (cell: MonthGridCell) => ReactNode;
  /** 空セル全体を上書き描画。 */
  renderEmpty?: () => ReactNode;
};

const DEFAULT_GRID_CLASS =
  'grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border/70 bg-border/70';
const DEFAULT_CELL_CLASS = 'min-h-16 bg-card p-1';
const DEFAULT_EMPTY_CLASS = 'min-h-16 bg-card';

/**
 * 月グリッド本体。曜日見出し（7 セル）+ 先頭空セル + 日セルを grid-cols-7 で描画する。
 */
export function MonthGrid({
  year,
  month,
  weekStartsOn = 0,
  weekdayLabels,
  weekendHeaderColors = true,
  ariaLabel,
  className,
  cellClassName,
  emptyCellClassName,
  getDayCellProps,
  renderDay,
  renderEmpty,
}: MonthGridProps) {
  const { cells } = useMonthGrid({ year, month, weekStartsOn });
  const cellClass = cellClassName ?? DEFAULT_CELL_CLASS;
  const emptyClass = emptyCellClassName ?? DEFAULT_EMPTY_CLASS;
  // weekdayLabels 省略時は weekStartsOn と整合する回転済み既定ラベルを使う（cells との曜日ずれ防止）。
  const effectiveLabels = weekdayLabels ?? defaultWeekdayLabels(weekStartsOn);

  return (
    <div className={className ?? DEFAULT_GRID_CLASS} aria-label={ariaLabel}>
      {effectiveLabels.map((label, index) => {
        // 見出しセル index → 実曜日（0=日）。weekStartsOn 起点でずらす。
        const weekday = (weekStartsOn + index) % 7;
        const weekendClass = weekendHeaderColors
          ? weekday === 0
            ? 'text-state-blocked'
            : weekday === 6
              ? 'text-tag-info'
              : ''
          : '';
        return (
          <div
            key={label}
            className={`bg-card py-1 text-center text-xs font-medium ${weekendClass}`}
          >
            {label}
          </div>
        );
      })}
      {cells.map((cell, index) => {
        if (cell === null) {
          return renderEmpty ? (
            <div key={`empty-${index}`}>{renderEmpty()}</div>
          ) : (
            <div key={`empty-${index}`} className={emptyClass} />
          );
        }
        const dayProps = getDayCellProps?.(cell) ?? {};
        const { className: mergedClassName, ...restProps } = dayProps;
        return (
          <div
            key={cell.dateKey}
            className={mergedClassName ? `${cellClass} ${mergedClassName}` : cellClass}
            {...restProps}
          >
            {renderDay(cell)}
          </div>
        );
      })}
    </div>
  );
}
