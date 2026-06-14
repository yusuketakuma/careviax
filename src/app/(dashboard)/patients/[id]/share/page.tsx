import { Metadata } from 'next';
import { Suspense } from 'react';
import { CollaborationWorkflowPanel } from '@/components/features/workflow/collaboration-workflow-panel';
import { getPatientShareShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { ExternalShareContent } from './external-share-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '他職種向け共有 — PH-OS',
};

export default async function ExternalSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="External Sharing"
        title="他職種向け共有ページ"
        description="相手区分ごとに「相手に見える内容」を確認し、外部共有リンクの発行と返信のタスク化を行います（JWT + OTP）"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">画面の役割</p>
            <p className="text-sm text-muted-foreground">
              共有する相手・相手に見える内容・返信を 3
              カラムで管理し、必要な共有だけを安全に発行して、相手からの返信を次回訪問の確認タスクにつなげます。
            </p>
          </div>
        }
        shortcuts={getPatientShareShortcutLinks(id)}
      />
      <CollaborationWorkflowPanel
        focus="share"
        description="患者単位の外部共有を、訪問時の確認と報告書送付へつながる連携接点として扱います。"
      />

      <Suspense fallback={<Loading />}>
        <ExternalShareContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
