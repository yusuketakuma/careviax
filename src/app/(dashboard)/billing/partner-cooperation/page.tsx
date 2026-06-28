import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { Loading } from '@/components/ui/loading';
import { PartnerCooperationBillingContent } from './partner-cooperation-billing-content';

export const metadata: Metadata = {
  title: '薬局間協力 月次処理 — PH-OS',
};

export default function PartnerCooperationBillingPage() {
  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/billing"
        backLabel="算定チェックへ戻る"
        title="薬局間協力 月次処理"
        description="協力薬局訪問の候補生成、請求書ドラフト、無償実績報告書を月次で確認します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              未生成件数、未確認訪問、有償/無償の内訳を確認してから月次ドキュメントを作成します。
            </p>
          </div>
        }
        shortcuts={[
          { href: '/billing', label: '算定チェック' },
          { href: '/billing/candidates', label: '通常請求候補' },
          { href: '/admin/billing-rules', label: '請求ルール' },
        ]}
      />

      <Suspense fallback={<Loading />}>
        <PartnerCooperationBillingContent />
      </Suspense>
    </PageScaffold>
  );
}
