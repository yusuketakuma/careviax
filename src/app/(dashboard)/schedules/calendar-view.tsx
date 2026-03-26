'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  format,
  addMonths,
  subMonths,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';

// ---- Types ----------------------------------------------------------------

type ScheduleStatus =
  | 'planned'
  | 'in_preparation'
  | 'ready'
  | 'departed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'postponed';

type VisitSchedule = {
  id: string;
  scheduled_date: string;
  schedule_status: ScheduleStatus;
  visit_type: string;
  pharmacist_id: string;
  case_id: string;
  cycle_id: string | null;
};

// ---- Constants ------------------------------------------------------------

const STATUS_STYLES: Record<ScheduleStatus, string> = {
  planned: 'bg-blue-100 text-blue-800',
  in_preparation: 'bg-blue-100 text-blue-800',
  ready: 'bg-green-100 text-green-800',
  departed: 'bg-green-200 text-green-900',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
  postponed: 'bg-orange-100 text-orange-800',
};

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
};

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

// ---- Hooks ----------------------------------------------------------------

function useMonthSchedules(orgId: string, year: number, month: number) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = endOfMonth(monthStart);
  const dateFrom = format(monthStart, 'yyyy-MM-dd');
  const dateTo = format(monthEnd, 'yyyy-MM-dd');

  return useQuery<VisitSchedule[]>({
    queryKey: ['visit-schedules', 'calendar', orgId, year, month],
    queryFn: async () => {
      if (!orgId) return [];
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, limit: '200' });
      const res = await fetch(`/api/visit-schedules?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as VisitSchedule[];
    },
    enabled: Boolean(orgId),
  });
}

// ---- Sub-components -------------------------------------------------------

function ScheduleBadge({ schedule }: { schedule: VisitSchedule }) {
  const status = schedule.schedule_status as ScheduleStatus;
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`block truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${style}`}>
      {label}
    </span>
  );
}

function DayPanel({
  date,
  schedules,
  onClose,
}: {
  date: Date;
  schedules: VisitSchedule[];
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          {format(date, 'yyyy年M月d日(E)', { locale: ja })} のスケジュール
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="閉じる"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {schedules.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          この日のスケジュールはありません
        </p>
      ) : (
        <ul className="divide-y">
          {schedules.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <ScheduleBadge schedule={s} />
              <span className="truncate text-sm text-foreground">{s.visit_type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Main Component -------------------------------------------------------

export function CalendarView() {
  const orgId = useOrgId();
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const { data: schedules = [], isLoading } = useMonthSchedules(orgId, year, month);

  // Build calendar grid: Mon–Sun weeks covering the full month
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const schedulesByDate = useMemo(() => {
    const map = new Map<string, VisitSchedule[]>();
    for (const s of schedules) {
      const key = s.scheduled_date.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    return map;
  }, [schedules]);

  const schedulesForDay = (day: Date) =>
    schedulesByDate.get(format(day, 'yyyy-MM-dd')) ?? [];

  const today = useMemo(() => new Date(), []);
  const selectedSchedules = selectedDate ? schedulesForDay(selectedDate) : [];

  const handleDayClick = (day: Date) => {
    if (selectedDate && isSameDay(selectedDate, day)) {
      setSelectedDate(null);
    } else {
      setSelectedDate(day);
    }
  };

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {format(currentMonth, 'yyyy年M月', { locale: ja })}
        </h2>
        <div className="flex gap-1">
          <button
            onClick={() => { setCurrentMonth((m) => subMonths(m, 1)); setSelectedDate(null); }}
            className="rounded-md p-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="前月"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            onClick={() => { setCurrentMonth(new Date()); setSelectedDate(null); }}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            今月
          </button>
          <button
            onClick={() => { setCurrentMonth((m) => addMonths(m, 1)); setSelectedDate(null); }}
            className="rounded-md p-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="翌月"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg border overflow-hidden">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const daySchedules = schedulesForDay(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const isToday = isSameDay(day, today);
              const visible = daySchedules.slice(0, 3);
              const overflow = daySchedules.length - visible.length;

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => handleDayClick(day)}
                  className={[
                    'min-h-[80px] border-b border-r p-1.5 text-left last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isCurrentMonth ? 'bg-background' : 'bg-muted/30',
                    isSelected ? 'ring-2 ring-inset ring-primary' : '',
                  ].join(' ')}
                  aria-label={`${format(day, 'M月d日')}${daySchedules.length > 0 ? ` ${daySchedules.length}件` : ''}`}
                  aria-pressed={isSelected}
                >
                  <span
                    className={[
                      'mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium',
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : isCurrentMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {format(day, 'd')}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {visible.map((s) => (
                      <ScheduleBadge key={s.id} schedule={s} />
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{overflow}件
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <DayPanel
          date={selectedDate}
          schedules={selectedSchedules}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
