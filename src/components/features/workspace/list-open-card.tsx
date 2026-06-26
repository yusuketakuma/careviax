'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * design/ v1.9 共通のリスト行カード(p0_04 お知らせ / p0_05 全体検索の結果)。
 * 左にカテゴリバッジ、太字タイトル+サブ文、右端に「開く」アウトラインボタン。
 */

export type ListOpenCardProps = {
  badgeLabel: string;
  badgeClassName?: string;
  title: string;
  subtitle?: string | null;
  /** 未読などの強調ドット */
  highlighted?: boolean;
  openLabel?: string;
  onOpen: () => void;
  className?: string;
};

export function ListOpenCard({
  badgeLabel,
  badgeClassName,
  title,
  subtitle,
  highlighted = false,
  openLabel = '開く',
  onOpen,
  className,
}: ListOpenCardProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border border-border/70 bg-card px-4 py-4 shadow-xs',
        className,
      )}
      data-testid="list-open-card"
    >
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
          badgeClassName ?? 'bg-muted text-muted-foreground border-border',
        )}
      >
        {badgeLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-bold leading-6 text-foreground">
          <span className="truncate">{title}</span>
          {highlighted && (
            <span
              className="size-2 shrink-0 rounded-full bg-primary"
              aria-label="未読"
              role="status"
            />
          )}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-sm leading-5 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        className="!h-auto !min-h-11 shrink-0 px-5"
        onClick={onOpen}
      >
        {openLabel}
      </Button>
    </div>
  );
}
