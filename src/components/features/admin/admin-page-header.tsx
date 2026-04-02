import type { ReactNode } from 'react';
import { PageShortcutLinks, type PageShortcutLink } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

type AdminPageHeaderProps = {
  title: string;
  description: string;
  shortcuts?: readonly PageShortcutLink[];
  action?: {
    href: string;
    label: string;
    icon?: ReactNode;
  };
};

export function AdminPageHeader({
  title,
  description,
  shortcuts = [],
  action,
}: AdminPageHeaderProps) {
  return (
    <div className="mb-6 space-y-3">
      <WorkflowBackLink href="/admin" label="管理ダッシュボードへ戻る" />
      <WorkflowPageHeader
        title={title}
        description={description}
        action={action}
        className="mb-0"
      >
        {shortcuts.length > 0 ? <PageShortcutLinks links={shortcuts} /> : null}
      </WorkflowPageHeader>
    </div>
  );
}
