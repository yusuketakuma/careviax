import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
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
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
          服薬カレンダー
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          月間服薬スケジュールの確認・印刷
        </p>
      </div>

      <Suspense fallback={<Loading />}>
        <MedicationCalendarContent patientId={id} />
      </Suspense>
    </div>
  );
}
