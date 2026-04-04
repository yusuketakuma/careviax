import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { MedicationSetsContent } from './medication-sets-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット管理 — CareViaX',
};

export default function MedicationSetsPage() {
  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="Medication Set"
        title="セット管理"
        description="セット対象患者、セット計画、セット鑑査を同じテーマで確認し、訪問準備へ接続します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">
              候補サイクル、計画作成、鑑査待ちを順に確認し、訪問準備へ漏れなく渡します。
            </p>
          </div>
        }
        childrenLabel="関連導線"
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
    </PageScaffold>
  );
}
