import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';
import { ScheduleDayView } from './day-view';
import { Loading } from '@/components/ui/loading';

export const metadata: Metadata = {
  title: '訪問スケジュール — CareViaX',
};

export default function SchedulesPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            訪問スケジュール
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            薬剤師の訪問予定を管理します
          </p>
        </div>
        <Link
          href="/schedules/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CalendarPlus className="size-4" aria-hidden="true" />
          新規訪問予定
        </Link>
      </div>

      <Suspense fallback={<Loading />}>
        <ScheduleDayView />
      </Suspense>
    </div>
  );
}
