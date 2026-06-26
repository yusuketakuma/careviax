import { addDays, format, isSameDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DayNavigatorProps = {
  /** 表示中の対象日。 */
  value: Date | string;
  /** 別日へ移動したときに呼ばれる。 */
  onChange: (next: Date) => void;
  /** 「今日」判定・移動の基準日（テスト用に注入可）。 */
  now?: Date;
  className?: string;
};

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/**
 * 前日 / 今日 / 翌日で対象日を移動する共通ナビ。
 * 毎日運用する day-board・conflicts・emergency-route・route-compare に欠けていた
 * 日付移動手段を統一する。日付ラベルは曜日付きで常時表示する。
 * 操作面は Button の既定（モバイル 44px / デスクトップは密度優先で縮小）に委ねる。
 */
export function DayNavigator({ value, onChange, now, className }: DayNavigatorProps) {
  const current = toDate(value);
  const today = now ?? new Date();
  const valid = !Number.isNaN(current.getTime());
  const isToday = valid && isSameDay(current, today);
  const label = valid ? format(current, 'M月d日(EEE)', { locale: ja }) : '日付を確認';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="前日"
        disabled={!valid}
        onClick={() => onChange(addDays(current, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-label="今日へ移動"
        disabled={isToday}
        onClick={() => onChange(today)}
      >
        今日
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="翌日"
        disabled={!valid}
        onClick={() => onChange(addDays(current, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
      <span aria-live="polite" className="ml-1 text-sm font-medium tabular-nums">
        {label}
      </span>
    </div>
  );
}
