import { Metadata } from 'next';
import { Suspense } from 'react';
import { getPatientShareShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { ExternalShareContent } from './external-share-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '外部共有 — CareViaX',
};

export default async function ExternalSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="External Sharing"
        title="外部共有"
        description="医療情報の一時共有リンクを発行します（JWT + OTP）"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">画面の役割</p>
            <p className="text-sm text-muted-foreground">
              共有先、期限、閲覧状況を患者文脈で管理し、必要な共有だけを安全に発行します。
            </p>
          </div>
        }
        shortcuts={getPatientShareShortcutLinks(id)}
      />

      <Suspense fallback={<Loading />}>
        <ExternalShareContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
