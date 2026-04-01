'use client';

import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays, List } from 'lucide-react';
import { Skeleton } from '@/components/ui/loading';

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

type ViewMode = 'day' | 'calendar';

export function ScheduleSection() {
  const [view, setView] = useState<ViewMode>('day');

  return (
    <section>
      <div className="mb-3 flex justify-end">
        <div
          className="flex rounded-lg border bg-muted p-0.5"
          role="group"
          aria-label="表示切替"
        >
          <button
            type="button"
            onClick={() => setView('day')}
            className={[
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === 'day'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
            aria-pressed={view === 'day'}
          >
            <List className="size-4" aria-hidden="true" />
            リスト
          </button>
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={[
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === 'calendar'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
            aria-pressed={view === 'calendar'}
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            カレンダー
          </button>
        </div>
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        {view === 'day' ? <ScheduleDayView /> : <CalendarView />}
      </Suspense>
    </section>
  );
}
