import type { ReactNode } from 'react';
import {
  PageShortcutLinks,
  type PageShortcutLink,
} from '@/components/features/workflow/page-shortcut-links';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageContextBar } from '@/components/layout/page-context-bar';
import { PageHeaderFrame } from '@/components/layout/page-header-frame';
import { SectionIntro } from '@/components/ui/section-intro';

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
  eyebrow,
  title,
  description,
  shortcuts = [],
  action,
  supportingContent = (
    <SectionIntro
      title="最初に見るポイント"
      description="対象データ、主要な設定値、関連導線を上から確認し、必要な管理操作へ進みます。"
    />
  ),
  childrenLabel = shortcuts.length > 0 ? '関連導線' : undefined,
}: AdminPageHeaderProps) {
  return (
    <PageHeaderFrame>
      <PageContextBar>
        <WorkflowBackLink href="/admin" label="マスターへ戻る" />
      </PageContextBar>
      <WorkflowPageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={action}
        supportingContent={supportingContent}
        childrenLabel={childrenLabel}
        embedded
      >
        {shortcuts.length > 0 ? <PageShortcutLinks links={shortcuts} /> : null}
      </WorkflowPageHeader>
    </PageHeaderFrame>
  );
}
