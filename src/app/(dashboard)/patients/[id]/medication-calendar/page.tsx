import { Metadata } from 'next';
import { Suspense } from 'react';
import { getPatientMedicationCalendarShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { MedicationCalendarContent } from './medication-calendar-content';

export const metadata: Metadata = {
  title: '服薬カレンダー — CareViaX',
};

export default async function MedicationCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="p-6 print:p-2">
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        title="服薬カレンダー"
        description="月間服薬スケジュールの確認・印刷"
        shortcuts={getPatientMedicationCalendarShortcutLinks(id)}
        className="print:hidden"
      />

      <Suspense fallback={<Loading />}>
        <MedicationCalendarContent patientId={id} />
      </Suspense>
    </div>
  );
}
