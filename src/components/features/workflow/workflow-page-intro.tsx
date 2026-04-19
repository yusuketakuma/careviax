import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PageShortcutLinks, type PageShortcutLink } from './page-shortcut-links';
import { WorkflowBackLink } from './workflow-back-link';
import { WorkflowPageHeader } from './workflow-page-header';

type WorkflowPageIntroProps = {
  backHref: string;
  backLabel: string;
  eyebrow?: string;
  title: string;
  description: string;
  shortcuts?: readonly PageShortcutLink[];
  actions?: ReactNode;
  controls?: ReactNode;
  supportingContent?: ReactNode;
  className?: string;
};

export function WorkflowPageIntro({
  backHref,
  backLabel,
  eyebrow,
  title,
  description,
  shortcuts = [],
  actions,
  controls,
  supportingContent,
  className,
}: WorkflowPageIntroProps) {
  const rightRail =
    controls ??
    (actions || shortcuts.length > 0 ? (
      <>
        {actions}
        {shortcuts.length > 0 ? <PageShortcutLinks links={shortcuts} /> : null}
      </>
    ) : null);

  return (
    <div className={cn('space-y-4', className)} data-page-header="true">
      <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
        <WorkflowBackLink href={backHref} label={backLabel} />
      </div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <WorkflowPageHeader
            eyebrow={eyebrow}
            title={title}
            description={description}
            supportingContent={supportingContent}
            className="mb-0"
          />
        </div>
        {rightRail ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/75 px-4 py-4 xl:justify-end">
            {rightRail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
