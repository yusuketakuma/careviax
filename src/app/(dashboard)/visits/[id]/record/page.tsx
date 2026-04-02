import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { VisitRecordForm } from './visit-record-form';

export const metadata: Metadata = {
  title: '訪問記録入力 — CareViaX',
};

export default async function VisitRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/visits"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          訪問一覧へ戻る
        </Link>
      </div>

      <WorkflowPageHeader
        title="訪問記録入力"
        description="SOAP形式で訪問内容を記録します"
        className="mb-4"
      >
        <PageShortcutLinks
          links={[
            { href: `/visits/${id}`, label: '記録詳細' },
            { href: '/reports', label: '報告書' },
          ]}
        />
      </WorkflowPageHeader>

      <VisitRecordForm id={id} />
    </div>
  );
}
