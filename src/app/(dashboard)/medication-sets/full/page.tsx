import { Metadata } from 'next';
import { Suspense } from 'react';
import { getMedicationSetFullShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { MedicationSetFullContent } from './medication-set-full-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'セット計画（詳細） — CareViaX',
};

type MedicationSetFullPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export default async function MedicationSetFullPage({ searchParams }: MedicationSetFullPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const planId = readString(resolvedSearchParams?.plan_id);

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/medication-sets"
        backLabel="セット管理へ戻る"
        eyebrow="Set Plan Detail"
        title="セット計画（詳細）"
        description="セット方式、スロットグリッド、持参パック生成の確認面です。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              セット方式、構成状況、持参パック生成前の確認事項を先に把握します。
            </p>
          </div>
        }
        shortcuts={getMedicationSetFullShortcutLinks(planId)}
        className="mb-6"
      />

      <Suspense fallback={<Loading />}>
        <MedicationSetFullContent />
      </Suspense>
    </PageScaffold>
  );
}
