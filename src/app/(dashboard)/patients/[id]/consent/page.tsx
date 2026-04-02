import { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientConsentShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { ConsentRecordsContent } from './consent-records-content';

export const metadata: Metadata = {
  title: '同意記録 — CareViaX',
};

export default async function ConsentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/patients/${id}`}
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者詳細へ戻る
        </Link>
        <WorkflowPageHeader
          title="同意記録"
          description="同意の取得状況、期限、撤回を患者文脈で追跡します。"
          className="mb-0 mt-2"
        >
          <PageShortcutLinks links={getPatientConsentShortcutLinks(id)} />
        </WorkflowPageHeader>
      </div>

      <ConsentRecordsContent />
    </div>
  );
}
