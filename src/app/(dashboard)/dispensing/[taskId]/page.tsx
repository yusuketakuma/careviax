import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { DispenseForm } from './dispense-form';

export const metadata: Metadata = {
  title: '調剤入力 — CareViaX',
};

export default async function DispenseTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <Link
          href="/dispensing"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          調剤キューへ戻る
        </Link>
      </div>

      <WorkflowPageHeader
        title="調剤入力"
        description="処方明細を確認して調剤実績を入力してください"
        className="mb-4"
      >
        <PageShortcutLinks
          links={[
            { href: `/dispensing/${taskId}/confirm`, label: '確認画面' },
            { href: '/auditing', label: '鑑査一覧' },
          ]}
        />
      </WorkflowPageHeader>

      <div className="mx-auto max-w-3xl">
        <DispenseForm taskId={taskId} />
      </div>
    </div>
  );
}
