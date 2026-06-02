import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ActionRailProps = {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end' | 'between';
};

const alignClassName = {
  start: 'justify-start',
  end: 'justify-end',
  between: 'justify-between',
} as const;

export function ActionRail({ children, className, align = 'end' }: ActionRailProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', alignClassName[align], className)}>
      {children}
    </div>
  );
}
