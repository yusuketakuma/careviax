'use client';

import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/loading';
import { ScheduleViewToggle, type ScheduleViewMode } from '@/app/(dashboard)/schedules/schedule-view-toggle';

const ScheduleDayView = dynamic(
  () =>
    import('@/app/(dashboard)/schedules/day-view').then(
      (mod) => mod.ScheduleDayView
    ),
  {
    loading: () => <ScheduleSkeleton />,
    ssr: false,
  }
);

const CalendarView = dynamic(
  () =>
    import('@/app/(dashboard)/schedules/calendar-view').then(
      (mod) => mod.CalendarView
    ),
  {
    loading: () => <ScheduleSkeleton />,
    ssr: false,
  }
);

function ScheduleSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="スケジュール読み込み中">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

export function ScheduleSection() {
  const [view, setView] = useState<ScheduleViewMode>('list');

  return (
    <section>
      <div className="mb-3 flex justify-end">
        <ScheduleViewToggle activeView={view} onChange={setView} />
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        {view === 'list' ? <ScheduleDayView /> : <CalendarView />}
      </Suspense>
    </section>
  );
}
