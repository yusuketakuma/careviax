import { type Metadata } from 'next';
import { FilePlus } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PrescriptionsWorkspace } from './prescriptions-workspace';

export const metadata: Metadata = {
  title: '処方箋受付 — PH-OS',
};

export default function PrescriptionsPage() {
  return (
    <PageScaffold variant="bare" className="pb-0">
      <WorkflowPageHeader
        eyebrow="Prescription Intake"
        title="処方受付"
        description="受付状況、疑義、調剤待ちを先に確認し、一覧と詳細を往復しながらそのまま次工程へつなげるワークスペースです。"
        action={{
          href: '/prescriptions/new',
          label: '新規受付',
          icon: <FilePlus className="size-4" aria-hidden="true" />,
        }}
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              受付件数、疑義、調剤待ちを見て、状態フィルタで絞り込みながら対象処方の詳細確認へ進みます。
            </p>
          </div>
        }
        mainWorkflowSteps={['prescriptions']}
        childrenLabel="関連導線"
      >
        <PageShortcutLinks
          links={[
            { href: '/prescriptions/qr-drafts', label: 'QR下書き' },
            { href: '/dispensing', label: '調剤キュー' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>
      <PrescriptionsWorkspace className="h-[calc(100vh-28rem)] min-h-[34rem]" />
    </PageScaffold>
  );
}
