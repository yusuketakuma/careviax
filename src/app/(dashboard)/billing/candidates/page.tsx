import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { BillingCandidatesContent } from './billing-candidates-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '月次請求候補 — CareViaX',
};

export default function BillingCandidatesPage() {
  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/billing"
        backLabel="請求ダッシュボードへ戻る"
        eyebrow="Billing Candidates"
        title="月次請求候補"
        description="算定候補の確認・バリデーション・CSV出力"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              レビュー待ち、除外候補、締め準備を先に確認し、その後に確定や出力を進めます。
            </p>
          </div>
        }
        shortcuts={[
          { href: '/billing', label: '請求ダッシュボード' },
          { href: '/admin/billing-rules', label: '請求ルール' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
      />

      <Suspense fallback={<Loading />}>
        <BillingCandidatesContent />
      </Suspense>
    </PageScaffold>
  );
}
