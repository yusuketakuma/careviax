'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type PageSectionProps = React.ComponentPropsWithoutRef<'section'> & {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  contentClassName?: string;
  /** 見出し行(タイトル+説明+actions)に付与する追加クラス(モバイルで隠す等) */
  headerClassName?: string;
  headingId?: string;
  headingLevel?: 2 | 3;
  tone?: 'default' | 'subtle' | 'warning' | 'danger';
};

const toneClassName = {
  default: 'border-border/70 bg-card/95',
  subtle: 'border-border/70 bg-card/80',
  warning: 'border-amber-200/80 bg-amber-50/80',
  danger: 'border-destructive/30 bg-destructive/5',
} as const;

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  headerClassName,
  headingId,
  headingLevel = 2,
  tone = 'default',
  ...props
}: PageSectionProps) {
  const generatedId = React.useId();
  const titleId = headingId ?? `${generatedId}-heading`;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section
      aria-labelledby={titleId}
      className={cn('space-y-4 rounded-2xl border p-4', toneClassName[tone], className)}
      {...props}
    >
      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
          headerClassName,
        )}
      >
        <div className="min-w-0">
          <Heading id={titleId} className="text-base font-semibold text-foreground">
            {title}
          </Heading>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
