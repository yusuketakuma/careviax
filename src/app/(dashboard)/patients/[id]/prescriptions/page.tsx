import { type Metadata } from 'next';
import { getPatientPrescriptionShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { PatientMcsSummarySection } from '@/components/patient-mcs/patient-mcs-summary-section';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
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
        <WorkflowPageIntro
          backHref={`/patients/${id}`}
          backLabel="患者詳細へ戻る"
          title="処方内容一覧"
          description="患者詳細から直近の処方履歴を追い、次の受付や服薬管理へ移れます。"
          shortcuts={getPatientPrescriptionShortcutLinks(id)}
          className="mb-0"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <PatientMcsSummarySection
          patientId={id}
          title="MCS共有要点"
          description="看護師やケアマネからの共有で、処方確認や折返しが必要な点を先に整理します。"
          compact
        />
        <PatientVisitBriefSection
          patientId={id}
          title="処方要点サマリー"
          description="直近の処方変更、調剤方法、連携更新を先に確認できます。"
        />
      </div>
      <PrescriptionHistoryContent />
    </div>
  );
}
