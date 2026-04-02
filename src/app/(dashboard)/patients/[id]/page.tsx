import { Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientHubShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
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
      <div className="mb-6">
        <WorkflowBackLink href="/patients" label="患者一覧へ戻る" />
      </div>

      <WorkflowPageHeader
        title="患者詳細"
        description="患者の基本情報、ケース進行、服薬と共有状態を横断して確認できます。"
        className="mb-6"
      >
        <PageShortcutLinks links={getPatientHubShortcutLinks(id)} />
      </WorkflowPageHeader>

      <PatientDetailTabs patientId={id} />
    </div>
  );
}
