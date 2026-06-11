import Link from 'next/link';
import type { ReactNode } from 'react';
import { HelpPopover } from '@/components/ui/help-popover';
import { cn } from '@/lib/utils';
import {
  MainWorkflowCompactNav,
  type MainWorkflowStepKey,
} from './main-workflow-route';

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
  /** 複数アクション。先頭のみ primary(主操作は 1 画面 1 つ)、以降は outline。 */
  actions?: WorkflowPageHeaderAction[];
  supportingContent?: ReactNode;
  childrenLabel?: string;
  children?: ReactNode;
  mainWorkflowSteps?: MainWorkflowStepKey[];
  mainWorkflowDescription?: string;
  className?: string;
};

export function WorkflowPageHeader({
  eyebrow,
  title,
  description,
  action,
  actions,
  supportingContent,
  childrenLabel,
  children,
  mainWorkflowSteps,
  mainWorkflowDescription,
  className,
}: WorkflowPageHeaderProps) {
  const resolvedActions = actions ?? (action ? [action] : []);
  const effectiveChildrenLabel = children ? (childrenLabel ?? '関連導線') : undefined;
  return (
    <div className={cn('space-y-5', className)} data-page-header="true">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {eyebrow ? (
            <p className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[2rem]">
                {title}
              </h1>
              <HelpPopover title={title} description={description} />
            </div>
          </div>
          {supportingContent ? (
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 shadow-sm">
              {supportingContent}
            </div>
          ) : null}
        </div>

        {resolvedActions.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {resolvedActions.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-auto sm:px-3.5',
                  index === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {children ? (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-background/75 px-4 py-4">
          {effectiveChildrenLabel ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {effectiveChildrenLabel}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-start gap-2">{children}</div>
        </div>
      ) : null}
      {mainWorkflowSteps && mainWorkflowSteps.length > 0 ? (
        <MainWorkflowCompactNav
          currentSteps={mainWorkflowSteps}
          description={
            mainWorkflowDescription ??
            'この画面が主業務フローのどこにあるかを固定表示し、前後工程を見失わないようにしています。'
          }
        />
      ) : null}
    </div>
  );
}
