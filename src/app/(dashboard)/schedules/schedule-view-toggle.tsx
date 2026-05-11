'use client';

import Link from 'next/link';
import { List, CalendarDays } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export type ScheduleViewMode = 'list' | 'calendar';

type Props = {
  activeView: ScheduleViewMode;
  onChange?: (view: ScheduleViewMode) => void;
};

export function ScheduleViewToggle({ activeView, onChange }: Props) {
  const searchParams = useSearchParams();

  const buildHref = (view: ScheduleViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    return `/schedules?${params.toString()}`;
  };

  const itemClassName = (view: ScheduleViewMode) =>
    [
      'inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:px-2.5',
      activeView === view
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    ].join(' ');

  const items: Array<{
    view: ScheduleViewMode;
    label: string;
    icon: typeof List;
  }> = [
    { view: 'list', label: 'リスト', icon: List },
    { view: 'calendar', label: 'カレンダー', icon: CalendarDays },
  ];

  return (
    <div className="flex rounded-lg border bg-muted p-0.5" role="group" aria-label="表示切替">
      {items.map(({ view, label, icon: Icon }) =>
        onChange ? (
          <button
            key={view}
            type="button"
            onClick={() => onChange(view)}
            className={itemClassName(view)}
            aria-pressed={activeView === view}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ) : (
          <Link
            key={view}
            href={buildHref(view)}
            className={itemClassName(view)}
            aria-current={activeView === view ? 'page' : undefined}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ),
      )}
    </div>
  );
}
