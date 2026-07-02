import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Skeleton for list/table loading states
// rest props(data-slot 等)を透過する。aria-hidden は装飾契約として常に固定(上書き不可)。
// as="span" でインライン文脈(<span>内の値プレースホルダ等)でも不正な DOM 入れ子を作らない。
export function Skeleton({
  className,
  as: Comp = 'div',
  ...props
}: ComponentProps<'div'> & { as?: 'div' | 'span' }) {
  return (
    <Comp
      {...props}
      className={cn(
        'animate-pulse rounded bg-muted motion-reduce:animate-none',
        Comp === 'span' && 'inline-block',
        className,
      )}
      aria-hidden="true"
    />
  );
}

// Row-based skeleton for data tables
export function SkeletonRows({
  rows = 5,
  cols = 4,
  status = true,
}: {
  rows?: number;
  cols?: number;
  status?: boolean;
}) {
  return (
    <div
      className="space-y-2"
      role={status ? 'status' : undefined}
      aria-label={status ? '読み込み中' : undefined}
      aria-hidden={status ? undefined : true}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">読み込み中...</span>
    </div>
  );
}

// Full-page loading state
export function Loading({ label = '読み込み中...' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[200px] items-center justify-center"
      role="status"
      aria-label={label}
    >
      <Spinner size="lg" label={null} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Spinner for button/inline loading states
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string | null;
}

const spinnerSizes = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ size = 'md', className, label = '読み込み中' }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-current border-b-transparent',
        'motion-reduce:animate-none',
        spinnerSizes[size],
        className,
      )}
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      {label ? <span className="sr-only">{label}...</span> : null}
    </span>
  );
}
