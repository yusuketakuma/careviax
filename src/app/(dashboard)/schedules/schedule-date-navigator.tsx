'use client';

import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ScheduleDateNavigatorProps = {
  /** 現在の対象日 (yyyy-MM-dd) */
  value: string;
  /** 日付が選択されたとき (yyyy-MM-dd)。空入力は呼び出し側で無視される前提で発火しない */
  onSelectDate: (date: string) => void;
  /** input の id (label との関連付け用、画面ごとに一意にする) */
  inputId: string;
  /** ラベル文言 */
  label?: string;
  /** 日付 input の aria-label (label を隠したい画面向け) */
  ariaLabel?: string;
  className?: string;
};

function shiftDate(value: string, deltaDays: number): string | null {
  // yyyy-MM-dd 前提。不正値は前後移動の基準にできないため null を返し、移動を抑止する。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return format(addDays(parseISO(value), deltaDays), 'yyyy-MM-dd');
}

/**
 * day-view の日付ナビ(前後送り + ネイティブ date input)を、conflicts / emergency-route /
 * route-compare の各画面で共有するための presentational コンポーネント。
 * URL(?date=) 同期や state 更新は呼び出し側 (onSelectDate) の責務。
 */
export function ScheduleDateNavigator({
  value,
  onSelectDate,
  inputId,
  label = '対象日',
  ariaLabel,
  className,
}: ScheduleDateNavigatorProps) {
  const handleStep = (deltaDays: number) => {
    const next = shiftDate(value, deltaDays);
    if (next) onSelectDate(next);
  };

  return (
    <div className={['flex items-center gap-2', className].filter(Boolean).join(' ')}>
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => handleStep(-1)}
        aria-label="前日"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Input
        id={inputId}
        type="date"
        className="w-[160px]"
        value={value}
        aria-label={ariaLabel ?? label}
        onChange={(event) => {
          const next = event.target.value;
          if (next) onSelectDate(next);
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => handleStep(1)}
        aria-label="翌日"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
