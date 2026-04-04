import { Metadata } from 'next';
import { Suspense } from 'react';
import { getPatientMedicationCalendarShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
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
    <PageScaffold className="print:p-2">
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="Medication Calendar"
        title="服薬カレンダー"
        description="月間服薬スケジュールの確認・印刷"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">画面の役割</p>
            <p className="text-sm text-muted-foreground">
              服薬予定の全体像を月単位で確認し、印刷や個別確認へつなげます。
            </p>
          </div>
        }
        shortcuts={getPatientMedicationCalendarShortcutLinks(id)}
        className="print:hidden"
      />

      <Suspense fallback={<Loading />}>
        <MedicationCalendarContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
