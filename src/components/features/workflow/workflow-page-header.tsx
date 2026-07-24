import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeaderFrame } from '@/components/layout/page-header-frame';
import { buttonVariants } from '@/components/ui/button-variants';
import { HelpPopover } from '@/components/ui/help-popover';
import { MainWorkflowCompactNav, type MainWorkflowStepKey } from './main-workflow-route';

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
  /** Keep the header content inside another shared page-header frame. */
  embedded?: boolean;
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
  embedded = false,
  className,
}: WorkflowPageHeaderProps) {
  const resolvedActions = actions ?? (action ? [action] : []);
  const effectiveChildrenLabel = children ? (childrenLabel ?? '関連導線') : undefined;
  return (
    <PageHeaderFrame embedded={embedded} className={className}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {eyebrow ? (
            <p className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[32px]">
                {title}
              </h1>
              <HelpPopover title={title} description={description} />
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="page-purpose">
              {description}
            </p>
          </div>
          {supportingContent ? (
            <div
              aria-label="補助情報"
              role="group"
              className="rounded-md border border-border/70 bg-muted/20 px-4 py-3"
            >
              {supportingContent}
            </div>
          ) : null}
        </div>

        {resolvedActions.length > 0 ? (
          <div
            aria-label="主要操作"
            role="group"
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            {resolvedActions.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                className={buttonVariants({
                  variant: index === 0 ? 'default' : 'outline',
                  size: 'lg',
                  className:
                    'h-auto min-h-11 w-full px-4 sm:h-auto sm:min-h-11 sm:w-auto sm:px-3.5',
                })}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {children ? (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 px-4 py-4">
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
    </PageHeaderFrame>
  );
}
