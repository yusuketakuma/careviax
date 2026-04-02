import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { BillingCandidatesContent } from './billing-candidates-content';

export const metadata: Metadata = {
  title: '月次請求候補 — CareViaX',
};

export default function BillingCandidatesPage() {
  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref="/billing"
        backLabel="請求ダッシュボードへ戻る"
        title="月次請求候補"
        description="算定候補の確認・バリデーション・CSV出力"
        shortcuts={[
          { href: '/billing', label: '請求ダッシュボード' },
          { href: '/admin/billing-rules', label: '請求ルール' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
      />

      <Suspense fallback={<Loading />}>
        <BillingCandidatesContent />
      </Suspense>
    </div>
  );
}
