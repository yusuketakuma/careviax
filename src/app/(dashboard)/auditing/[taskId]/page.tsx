import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { AuditDetail } from './audit-detail';

export const metadata: Metadata = {
  title: '調剤鑑査詳細 — CareViaX',
};

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/auditing"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          鑑査一覧へ戻る
        </Link>
      </div>

      <WorkflowPageHeader
        title="調剤鑑査"
        description="処方原本・構造化明細・調剤実績を比較して鑑査を実施してください"
        className="mb-4"
      >
        <PageShortcutLinks
          links={[
            { href: `/dispensing/${taskId}`, label: '調剤入力' },
            { href: '/workflow', label: 'ワークフロー' },
          ]}
        />
      </WorkflowPageHeader>

      <AuditDetail taskId={taskId} />
    </div>
  );
}
