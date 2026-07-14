import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/** Shared place/purpose row used above workflow and administration page titles. */
export function PageContextBar({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'flex min-h-11 items-center rounded-md border border-border/70 bg-muted/20 px-1',
        className,
      )}
      data-page-context-bar="true"
    >
      {children}
    </div>
  );
}
