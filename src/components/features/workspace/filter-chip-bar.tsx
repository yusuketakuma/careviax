'use client';

import { cn } from '@/lib/utils';

/**
 * design/ v1.9 共通のフィルタチップ行(p0_04 お知らせ / p0_05 全体検索)。
 * 選択中 = 青塗り、非選択 = 白アウトライン。
 */

export type FilterChipOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
  disabled?: boolean;
  disabledReason?: string;
};

export function FilterChipBar<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: Array<FilterChipOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            disabled={option.disabled}
            title={option.disabledReason}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors sm:min-h-9',
              option.disabled
                ? 'cursor-not-allowed border-border bg-muted/40 text-muted-foreground/70'
                : isActive
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {option.label}
            {option.count != null && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
