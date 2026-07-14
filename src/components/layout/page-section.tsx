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
  /** Selected/focused sections share one emphasis treatment instead of local ring classes. */
  emphasis?: 'default' | 'selected';
  /** Immersive mobile workflows can remove panel chrome without raw geometry overrides. */
  mobileSurface?: 'default' | 'bare';
};

const toneClassName = {
  default: 'border-border/70 bg-card text-card-foreground',
  subtle: 'border-border/70 bg-muted/20 text-foreground',
  warning: 'border-state-confirm/30 bg-state-confirm/10 text-foreground',
  danger: 'border-destructive/30 bg-destructive/5 text-foreground',
} as const;

const emphasisClassName = {
  default: '',
  selected: 'ring-2 ring-primary/25',
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
  emphasis = 'default',
  mobileSurface = 'default',
  ...props
}: PageSectionProps) {
  const generatedId = React.useId();
  const titleId = headingId ?? `${generatedId}-heading`;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';

  return (
    <section
      {...props}
      aria-labelledby={titleId}
      className={cn(
        'min-w-0 overflow-visible rounded-md border',
        toneClassName[tone],
        emphasisClassName[emphasis],
        mobileSurface === 'bare' &&
          'max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:ring-0',
        className,
      )}
      data-clinical-section="true"
      data-page-section="true"
      data-slot="page-section"
      data-tone={tone}
      data-emphasis={emphasis}
      data-mobile-surface={mobileSurface}
    >
      <div
        className={cn(
          'flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-start sm:justify-between',
          mobileSurface === 'bare' && 'max-md:px-0',
          headerClassName,
        )}
        data-slot="page-section-header"
      >
        <div className="min-w-0">
          <Heading id={titleId} className="font-heading text-base font-semibold text-foreground">
            {title}
          </Heading>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div
        className={cn('p-4', mobileSurface === 'bare' && 'max-md:p-0', contentClassName)}
        data-slot="page-section-content"
      >
        {children}
      </div>
    </section>
  );
}
