import type { ReactNode } from 'react';
import {
  PageShortcutLinks,
  type PageShortcutLink,
} from '@/components/features/workflow/page-shortcut-links';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  shortcuts?: readonly PageShortcutLink[];
  action?: {
    href: string;
    label: string;
    icon?: ReactNode;
  };
  supportingContent?: ReactNode;
  childrenLabel?: string;
};

export function AdminPageHeader({
  eyebrow = 'Admin Console',
  title,
  description,
  shortcuts = [],
  action,
  supportingContent = (
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
      <p className="text-sm text-muted-foreground">
        対象データ、主要な設定値、関連導線を上から確認し、必要な管理操作へ進みます。
      </p>
    </div>
  ),
  childrenLabel = shortcuts.length > 0 ? '関連導線' : undefined,
}: AdminPageHeaderProps) {
  return (
    <div className="space-y-4" data-page-header="true">
      <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
        <WorkflowBackLink href="/admin" label="管理ダッシュボードへ戻る" />
      </div>
      <WorkflowPageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
        supportingContent={supportingContent}
        childrenLabel={childrenLabel}
        className="mb-0"
      >
        {shortcuts.length > 0 ? <PageShortcutLinks links={shortcuts} /> : null}
      </WorkflowPageHeader>
    </div>
  );
}
