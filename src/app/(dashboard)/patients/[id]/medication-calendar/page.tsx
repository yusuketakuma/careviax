import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { getPatientMedicationCalendarShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
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
      <div className="mb-6 print:hidden">
        <Link
          href={`/patients/${id}`}
          className="mb-4 inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          患者詳細へ戻る
        </Link>
        <WorkflowPageHeader
          title="服薬カレンダー"
          description="月間服薬スケジュールの確認・印刷"
          className="mb-0 mt-2"
        >
          <PageShortcutLinks links={getPatientMedicationCalendarShortcutLinks(id)} />
        </WorkflowPageHeader>
      </div>

      <Suspense fallback={<Loading />}>
        <MedicationCalendarContent patientId={id} />
      </Suspense>
    </div>
  );
}
