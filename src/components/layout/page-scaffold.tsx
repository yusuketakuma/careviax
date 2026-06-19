import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

type PageScaffoldProps = ComponentPropsWithoutRef<'div'> & {
  variant?: 'card' | 'bare';
  stackClassName?: string;
  testId?: string;
};

const stackVariants = {
  card: [
    '[&>*]:overflow-hidden',
    '[&>*]:rounded-xl',
    '[&>*]:border',
    '[&>*]:border-border/70',
    '[&>*]:bg-card',
    '[&>*]:px-4',
    '[&>*]:py-4',
    '[&>*]:shadow-sm',
    'sm:[&>*]:rounded-2xl',
    'sm:[&>*]:px-6',
    'sm:[&>*]:py-6',
    '[&>[data-page-header=true]]:border-border/70',
    '[&>[data-page-header=true]]:bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_35%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))]',
    '[&>[data-page-header=true]]:shadow-sm',
    '[&>[data-page-header=true]]:px-5',
    '[&>[data-page-header=true]]:py-5',
    'sm:[&>[data-page-header=true]]:px-6',
    'sm:[&>[data-page-header=true]]:py-6',
  ].join(' '),
  bare: '',
} as const;

export function PageScaffold({
  children,
  className,
  variant = 'card',
  stackClassName,
  testId = 'page-scaffold',
  ...props
}: PageScaffoldProps) {
  return (
    <div
      className={cn(
        'min-h-full w-full bg-muted/20 p-3 sm:p-4 lg:p-5 xl:p-6 print:bg-background print:p-0',
        className,
      )}
      data-testid={testId}
      {...props}
    >
      <div
        data-testid={`${testId}-stack`}
        className={cn('min-h-full w-full space-y-6', stackVariants[variant], stackClassName)}
      >
        {children}
      </div>
    </div>
  );
}
