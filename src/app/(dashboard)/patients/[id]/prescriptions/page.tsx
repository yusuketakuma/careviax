import { type Metadata } from 'next';
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
      <PatientVisitBriefSection
        patientId={id}
        title="処方要点サマリー"
        description="直近の処方変更、調剤方法、連携更新を先に確認できます。"
      />
      <PrescriptionHistoryContent />
    </div>
  );
}
