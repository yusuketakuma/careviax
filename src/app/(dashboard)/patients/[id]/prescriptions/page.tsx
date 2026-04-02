import { type Metadata } from 'next';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientPrescriptionShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { PatientVisitBriefSection } from '@/components/visit-brief/patient-visit-brief-section';
import { PrescriptionHistoryContent } from './prescription-history-content';

export const metadata: Metadata = {
  title: '処方内容一覧 — CareViaX',
};

export default async function PatientPrescriptionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div className="px-6 pt-6">
        <div className="mb-4">
          <WorkflowBackLink href={`/patients/${id}`} label="患者詳細へ戻る" />
        </div>

        <WorkflowPageHeader
          title="処方内容一覧"
          description="患者詳細から直近の処方履歴を追い、次の受付や服薬管理へ移れます。"
          className="mb-0"
        >
          <PageShortcutLinks links={getPatientPrescriptionShortcutLinks(id)} />
        </WorkflowPageHeader>
      </div>

      <PatientVisitBriefSection
        patientId={id}
        title="処方要点サマリー"
        description="直近の処方変更、調剤方法、連携更新を先に確認できます。"
      />
      <PrescriptionHistoryContent />
    </div>
  );
}
