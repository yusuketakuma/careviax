import { Metadata } from 'next';
import { getPatientHubShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientDetailTabs } from './patient-detail-tabs';
import { PageScaffold } from '@/components/layout/page-scaffold';

export const metadata: Metadata = {
  title: '患者詳細 — CareViaX',
};

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        eyebrow="Patient Hub"
        title="患者詳細"
        description="患者の基本情報、ケース進行、服薬と共有状態を横断して確認できます。"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認の流れ</p>
            <p className="text-sm text-muted-foreground">
              基本情報とケース状況を確認し、必要に応じて服薬管理、共有履歴、個別作業へ進みます。
            </p>
          </div>
        }
        shortcuts={getPatientHubShortcutLinks(id)}
        className="mb-6"
      />

      <PatientDetailTabs patientId={id} />
    </PageScaffold>
  );
}
