import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

type PageScaffoldProps = ComponentPropsWithoutRef<'div'> & {
  variant?: 'card' | 'bare';
  canvasInset?: 'default' | 'flush-bottom';
  stackClassName?: string;
  testId?: string;
};

const stackVariants = {
  card: [
    '[&>*]:min-w-0',
    '[&>*]:rounded-md',
    '[&>*]:border',
    '[&>*]:border-border/70',
    '[&>*]:bg-card',
    '[&>*]:px-4',
    '[&>*]:py-4',
    'sm:[&>*]:px-6',
    'sm:[&>*]:py-6',
  ].join(' '),
  bare: '',
} as const;

export function PageScaffold({
  children,
  className,
  variant = 'card',
  canvasInset = 'default',
  stackClassName,
  testId = 'page-scaffold',
  ...props
}: PageScaffoldProps) {
  return (
    <div
      {...props}
      className={cn(
        'min-h-full w-full bg-muted/20 p-4 lg:p-6 print:bg-background print:p-0',
        canvasInset === 'flush-bottom' && 'pb-0 lg:pb-0',
        className,
      )}
      data-canvas-inset={canvasInset}
      data-testid={testId}
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
