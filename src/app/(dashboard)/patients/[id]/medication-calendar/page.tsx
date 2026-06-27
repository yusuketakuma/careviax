import { Metadata } from 'next';
import { Suspense } from 'react';
import { getPatientMedicationCalendarShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { Skeleton } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { MedicationCalendarContent } from './medication-calendar-content';

export const metadata: Metadata = {
  title: '服薬カレンダー — PH-OS',
};

// Suspense fallback はカレンダー形状の軽量スケルトン外枠（スピナー文言なし=false-empty 回避）。
function MedicationCalendarSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={`week-${i}`} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

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

      <Suspense fallback={<MedicationCalendarSkeleton />}>
        <MedicationCalendarContent patientId={id} />
      </Suspense>
    </PageScaffold>
  );
}
