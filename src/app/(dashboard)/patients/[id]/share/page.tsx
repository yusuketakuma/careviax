import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientShareShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { ExternalShareContent } from './external-share-content';

export const metadata: Metadata = {
  title: '外部共有 — CareViaX',
};

export default async function ExternalSharePage({
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
          title="外部共有"
          description="医療情報の一時共有リンクを発行します（JWT + OTP）"
          className="mb-0 mt-2"
        >
          <PageShortcutLinks links={getPatientShareShortcutLinks(id)} />
        </WorkflowPageHeader>
      </div>

      <Suspense fallback={<Loading />}>
        <ExternalShareContent patientId={id} />
      </Suspense>
    </div>
  );
}
