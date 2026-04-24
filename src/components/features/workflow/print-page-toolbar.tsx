'use client';

import { type MainWorkflowStepKey } from './main-workflow-route';
import { PageShortcutLinks, type PageShortcutLink } from './page-shortcut-links';
import { PrintActionButton } from './print-action-button';
import { WorkflowPageIntro } from './workflow-page-intro';

type PrintPageToolbarProps = {
  backHref: string;
  backLabel: string;
  title: string;
  description: string;
  shortcuts: readonly PageShortcutLink[];
  mainWorkflowSteps?: MainWorkflowStepKey[];
  mainWorkflowDescription?: string;
};

export function PrintPageToolbar({
  backHref,
  backLabel,
  title,
  description,
  shortcuts,
  mainWorkflowSteps,
  mainWorkflowDescription,
}: PrintPageToolbarProps) {
  return (
    <WorkflowPageIntro
      backHref={backHref}
      backLabel={backLabel}
      title={title}
      description={description}
      mainWorkflowSteps={mainWorkflowSteps}
      mainWorkflowDescription={mainWorkflowDescription}
      className="mb-4 print:hidden"
      controls={
        <>
          <PrintActionButton />
          <PageShortcutLinks links={shortcuts} />
        </>
      }
    />
  );
}
