import { Metadata } from 'next';
import { getPatientHubShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientDetailTabs } from './patient-detail-tabs';

export const metadata: Metadata = {
  title: '患者詳細 — CareViaX',
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6">
      <WorkflowPageIntro
        backHref="/patients"
        backLabel="患者一覧へ戻る"
        title="患者詳細"
        description="患者の基本情報、ケース進行、服薬と共有状態を横断して確認できます。"
        shortcuts={getPatientHubShortcutLinks(id)}
        className="mb-6"
      />

      <PatientDetailTabs patientId={id} />
    </div>
  );
}
