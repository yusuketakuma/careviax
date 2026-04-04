import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

type PageScaffoldProps = ComponentPropsWithoutRef<'div'> & {
  variant?: 'card' | 'bare';
  stackClassName?: string;
  testId?: string;
};

const stackVariants = {
  card: '[&>*]:overflow-hidden [&>*]:rounded-xl [&>*]:border [&>*]:border-border/70 [&>*]:bg-card [&>*]:px-4 [&>*]:py-4 [&>*]:shadow-sm sm:[&>*]:rounded-2xl sm:[&>*]:px-6 sm:[&>*]:py-6',
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
    <div className={cn('p-3 md:p-4 xl:p-5', className)} data-testid={testId} {...props}>
      <div
        data-testid={`${testId}-stack`}
        className={cn(
          'space-y-4 sm:space-y-6',
          stackVariants[variant],
          stackClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
