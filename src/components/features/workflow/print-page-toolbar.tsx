'use client';

import { PageShortcutLinks, type PageShortcutLink } from './page-shortcut-links';
import { PrintActionButton } from './print-action-button';
import { WorkflowPageIntro } from './workflow-page-intro';

type PrintPageToolbarProps = {
  backHref: string;
  backLabel: string;
  title: string;
  description: string;
  shortcuts: readonly PageShortcutLink[];
};

export function PrintPageToolbar({
  backHref,
  backLabel,
  title,
  description,
  shortcuts,
}: PrintPageToolbarProps) {
  return (
    <WorkflowPageIntro
      backHref={backHref}
      backLabel={backLabel}
      title={title}
      description={description}
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
