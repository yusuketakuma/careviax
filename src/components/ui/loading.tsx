import { cn } from '@/lib/utils';

// Skeleton for list/table loading states
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded bg-muted', className)}
      aria-hidden="true"
    />
  );
}

// Row-based skeleton for data tables
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="読み込み中">
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
    <div className="flex min-h-[200px] items-center justify-center" role="status" aria-label={label}>
      <Spinner size="lg" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

// Spinner for button/inline loading states
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const spinnerSizes = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-current border-b-transparent',
        spinnerSizes[size],
        className
      )}
      role="status"
      aria-label="読み込み中"
    >
      <span className="sr-only">読み込み中...</span>
    </span>
  );
}
