import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { MedicationSetsContent } from './medication-sets-content';

export const metadata: Metadata = {
  title: 'セット管理 — CareViaX',
};

export default function MedicationSetsPage() {
  return (
    <div className="p-6">
      <WorkflowPageHeader
        title="セット管理"
        description="薬剤セット対象患者の一覧・セットプラン作成・セット鑑査を行います"
      >
        <PageShortcutLinks
          links={[
            { href: '/workflow', label: 'ワークフロー' },
            { href: '/schedules', label: 'スケジュール' },
          ]}
        />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <MedicationSetsContent />
      </Suspense>
    </div>
  );
}
