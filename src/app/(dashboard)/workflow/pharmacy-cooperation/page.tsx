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
        eyebrow="薬局間協力"
        title="薬局間協力ワークフロー"
        description="共有ケース、訪問依頼、協力記録、請求・報告書作成の停滞を同じ作業面で確認します。"
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
