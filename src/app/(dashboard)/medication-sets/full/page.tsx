import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getMedicationSetFullShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { MedicationSetFullContent } from './medication-set-full-content';

export const metadata: Metadata = {
  title: 'セット計画（詳細） — CareViaX',
};

type MedicationSetFullPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export default async function MedicationSetFullPage({
  searchParams,
}: MedicationSetFullPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const planId = readString(resolvedSearchParams?.plan_id);

  return (
    <div className="p-6">
      <div className="mb-4">
        <WorkflowBackLink href="/medication-sets" label="セット管理へ戻る" />
      </div>

      <WorkflowPageHeader
        title="セット計画（詳細）"
        description="セット方式、スロットグリッド、持参パック生成の確認面です。"
        className="mb-6"
      >
        <PageShortcutLinks links={getMedicationSetFullShortcutLinks(planId)} />
      </WorkflowPageHeader>

      <Suspense fallback={<Loading />}>
        <MedicationSetFullContent />
      </Suspense>
    </div>
  );
}
