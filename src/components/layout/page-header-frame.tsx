import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

type PageHeaderFrameProps = ComponentPropsWithoutRef<'div'> & {
  /** A nested header keeps the shared rhythm without declaring a second page header. */
  embedded?: boolean;
};

/**
 * Shared geometry and semantic marker for the page-heading region.
 *
 * This component intentionally does not fix the page-heading height: page context and
 * safety content vary by task. Only the global AppHeader owns a fixed block size.
 */
export function PageHeaderFrame({
  children,
  className,
  embedded = false,
  ...props
}: PageHeaderFrameProps) {
  return (
    <div
      {...props}
      className={cn('space-y-4', className)}
      data-page-header={embedded ? undefined : 'true'}
      data-page-header-frame="true"
    >
      {children}
    </div>
  );
}
