import type { ReactNode } from 'react';
import { PageContextBar } from '@/components/layout/page-context-bar';
import { PageHeaderFrame } from '@/components/layout/page-header-frame';
import { PageShortcutLinks, type PageShortcutLink } from './page-shortcut-links';
import { MainWorkflowCompactNav, type MainWorkflowStepKey } from './main-workflow-route';
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
  mainWorkflowSteps?: MainWorkflowStepKey[];
  mainWorkflowDescription?: string;
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
  mainWorkflowSteps,
  mainWorkflowDescription,
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
    <PageHeaderFrame className={className}>
      <PageContextBar>
        <WorkflowBackLink href={backHref} label={backLabel} />
      </PageContextBar>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <WorkflowPageHeader
            eyebrow={eyebrow}
            title={title}
            description={description}
            supportingContent={supportingContent}
            embedded
          />
        </div>
        {rightRail ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-4 py-4 xl:justify-end">
            {rightRail}
          </div>
        ) : null}
      </div>
      {mainWorkflowSteps && mainWorkflowSteps.length > 0 ? (
        <MainWorkflowCompactNav
          currentSteps={mainWorkflowSteps}
          description={
            mainWorkflowDescription ??
            '詳細画面でも、主業務フロー上の現在地を固定表示して前後工程を見失わないようにしています。'
          }
        />
      ) : null}
    </PageHeaderFrame>
  );
}
