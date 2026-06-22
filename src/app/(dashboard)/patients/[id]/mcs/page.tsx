import { Metadata } from 'next';
import { getPatientMcsShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientMcsContent } from './mcs-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: 'MCS連携 — PH-OS',
};

export default async function PatientMcsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patientPathId = encodeURIComponent(id);

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${patientPathId}`}
        backLabel="患者詳細へ戻る"
        eyebrow="MCS Integration"
        title="MCS連携"
        description="Medical Care Station の連携状態、手動同期、取り込み済みメッセージを患者単位で確認します。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              連携状態、最新共有、再同期の必要有無を先に把握してから個別メッセージを確認します。
            </p>
          </div>
        }
        shortcuts={getPatientMcsShortcutLinks(id)}
        className="mb-6"
      />

      <PatientMcsContent patientId={id} />
    </PageScaffold>
  );
}
