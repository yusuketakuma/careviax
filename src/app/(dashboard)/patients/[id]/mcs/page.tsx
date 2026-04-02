import { Metadata } from 'next';
import { getPatientMcsShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PatientMcsContent } from './mcs-content';

export const metadata: Metadata = {
  title: 'MCS連携 — CareViaX',
};

export default async function PatientMcsPage({
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
        title="MCS連携"
        description="Medical Care Station の連携状態、手動同期、取り込み済みメッセージを患者単位で確認します。"
        shortcuts={getPatientMcsShortcutLinks(id)}
        className="mb-6"
      />

      <PatientMcsContent patientId={id} />
    </div>
  );
}
