'use client';

import Link from 'next/link';
import { List, CalendarDays } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

type Props = {
  activeView: 'list' | 'calendar';
};

export function ScheduleViewToggle({ activeView }: Props) {
  const searchParams = useSearchParams();

  const buildHref = (view: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    return `/schedules?${params.toString()}`;
  };

  return (
    <div
      className="flex rounded-lg border bg-muted p-0.5"
      role="group"
      aria-label="表示切替"
    >
      <Link
        href={buildHref('list')}
        className={[
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          activeView === 'list'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
        aria-current={activeView === 'list' ? 'page' : undefined}
      >
        <List className="size-4" aria-hidden="true" />
        リスト
      </Link>
      <Link
        href={buildHref('calendar')}
        className={[
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          activeView === 'calendar'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
        aria-current={activeView === 'calendar' ? 'page' : undefined}
      >
        <CalendarDays className="size-4" aria-hidden="true" />
        カレンダー
      </Link>
    </div>
  );
}
