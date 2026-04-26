import { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { BillingCandidatesContent } from './billing-candidates-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '月次請求候補 — CareViaX',
};

type BillingCandidatesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BillingCandidatesPage({ searchParams }: BillingCandidatesPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialBillingMonth = readFirstSearchParam(resolvedSearchParams.billing_month);
  const initialPatientId = readFirstSearchParam(resolvedSearchParams.patient_id);

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
        <BillingCandidatesContent
          initialBillingMonth={initialBillingMonth}
          initialPatientId={initialPatientId}
        />
      </Suspense>
    </PageScaffold>
  );
}
