import { Metadata } from 'next';
import { Suspense } from 'react';
import { getPatientShareShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
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
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        title="外部共有"
        description="医療情報の一時共有リンクを発行します（JWT + OTP）"
        shortcuts={getPatientShareShortcutLinks(id)}
      />

      <Suspense fallback={<Loading />}>
        <ExternalShareContent patientId={id} />
      </Suspense>
    </div>
  );
}
