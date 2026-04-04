import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type WorkflowPageHeaderAction = {
  href: string;
  label: string;
  icon?: ReactNode;
};

type WorkflowPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: WorkflowPageHeaderAction;
  supportingContent?: ReactNode;
  childrenLabel?: string;
  children?: ReactNode;
  className?: string;
};

export function WorkflowPageHeader({
  eyebrow,
  title,
  description,
  action,
  supportingContent,
  childrenLabel,
  children,
  className,
}: WorkflowPageHeaderProps) {
  const effectiveChildrenLabel = children ? (childrenLabel ?? '関連導線') : undefined;
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>
          {supportingContent ? (
            <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
              {supportingContent}
            </div>
          ) : null}
        </div>

        {action ? (
          <Link
            href={action.href}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-auto sm:px-2.5"
          >
            {action.icon}
            {action.label}
          </Link>
        ) : null}
      </div>

      {children ? (
        <div className="space-y-2 border-t border-border/70 pt-4">
          {effectiveChildrenLabel ? (
            <p className="text-xs font-medium text-muted-foreground">{effectiveChildrenLabel}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
