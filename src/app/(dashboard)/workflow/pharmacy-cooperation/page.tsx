import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { PharmacyCooperationWorkflowContent } from './pharmacy-cooperation-workflow-content';

export const metadata: Metadata = {
  title: '薬局間協力ワークフロー — PH-OS',
};

export default function PharmacyCooperationWorkflowPage() {
  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/workflow"
        backLabel="ワークフローへ戻る"
        eyebrow="Pharmacy Cooperation"
        title="薬局間協力ワークフロー"
        description="患者共有ケース、協力薬局への訪問依頼、協力訪問記録の提出・確認・報告書ドラフト化を一つの作業面で確認します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              共有ケースの有効化、依頼の受諾状況、提出済み記録の確認待ちを順に確認します。
            </p>
          </div>
        }
        shortcuts={[
          { href: '/workflow', label: 'ワークフロー' },
          { href: '/admin/pharmacy-cooperation', label: '協力薬局設定' },
          { href: '/billing/partner-cooperation', label: '月次請求' },
          { href: '/external', label: '外部連携' },
        ]}
      />

      <Suspense fallback={<Loading />}>
        <PharmacyCooperationWorkflowContent />
      </Suspense>
    </PageScaffold>
  );
}
