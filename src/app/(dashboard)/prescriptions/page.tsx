import { type Metadata } from 'next';
import { FilePlus } from 'lucide-react';
import { MainWorkflowCompactNav } from '@/components/features/workflow/main-workflow-route';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { PrescriptionsWorkspace } from './prescriptions-workspace';

export const metadata: Metadata = {
  title: '処方箋受付 — PH-OS',
};

export default function PrescriptionsPage() {
  return (
    <PageScaffold variant="bare" className="pb-0" stackClassName="space-y-3">
      <WorkflowPageHeader
        eyebrow="処方受付"
        title="処方受付"
        description="受付状況、疑義、調剤待ちを見て、対象処方の詳細確認へ進みます。"
        action={{
          href: '/prescriptions/new',
          label: '新規受付',
          icon: <FilePlus className="size-4" aria-hidden="true" />,
        }}
        className="space-y-3"
      />
      <PrescriptionsWorkspace className="h-[calc(100dvh-9rem)] min-h-[34rem]" />
      <div className="pb-6">
        <MainWorkflowCompactNav
          currentSteps={['prescriptions']}
          description="この画面が主業務フローのどこにあるかを固定表示し、前後工程を見失わないようにしています。"
        />
      </div>
    </PageScaffold>
  );
}
