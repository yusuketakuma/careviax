import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PageShortcutLinks, type PageShortcutLink } from './page-shortcut-links';
import { WorkflowBackLink } from './workflow-back-link';
import { WorkflowPageHeader } from './workflow-page-header';

type WorkflowPageIntroProps = {
  backHref: string;
  backLabel: string;
  title: string;
  description: string;
  shortcuts?: readonly PageShortcutLink[];
  actions?: ReactNode;
  controls?: ReactNode;
  className?: string;
};

export function WorkflowPageIntro({
  backHref,
  backLabel,
  title,
  description,
  shortcuts = [],
  actions,
  controls,
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
    <div className={cn('mb-6 space-y-3', className)}>
      <WorkflowBackLink href={backHref} label={backLabel} />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <WorkflowPageHeader title={title} description={description} className="mb-0" />
        </div>
        {rightRail ? (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">{rightRail}</div>
        ) : null}
      </div>
    </div>
  );
}
