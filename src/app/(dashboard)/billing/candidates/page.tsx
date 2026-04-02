import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { BillingCandidatesContent } from './billing-candidates-content';

export const metadata: Metadata = {
  title: '月次請求候補 — CareViaX',
};

export default function BillingCandidatesPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/billing"
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          請求ダッシュボードへ戻る
        </Link>
        <WorkflowPageHeader
          title="月次請求候補"
          description="算定候補の確認・バリデーション・CSV出力"
          className="mb-0 mt-2"
        >
          <PageShortcutLinks
            links={[
              { href: '/billing', label: '請求ダッシュボード' },
              { href: '/admin/billing-rules', label: '請求ルール' },
              { href: '/workflow', label: 'ワークフロー' },
            ]}
          />
        </WorkflowPageHeader>
      </div>

      <Suspense fallback={<Loading />}>
        <BillingCandidatesContent />
      </Suspense>
    </div>
  );
}
