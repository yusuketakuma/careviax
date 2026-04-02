import { Metadata } from 'next';
import { Suspense } from 'react';
import { getMedicationSetFullShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
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
      <WorkflowPageIntro
        backHref="/medication-sets"
        backLabel="セット管理へ戻る"
        title="セット計画（詳細）"
        description="セット方式、スロットグリッド、持参パック生成の確認面です。"
        shortcuts={getMedicationSetFullShortcutLinks(planId)}
        className="mb-6"
      />

      <Suspense fallback={<Loading />}>
        <MedicationSetFullContent />
      </Suspense>
    </div>
  );
}
