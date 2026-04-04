'use client';

import Link from 'next/link';
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
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import {
  fetchCalendarSchedules,
  formatCalendarTimeRange,
  groupCalendarSchedulesByDate,
  sortCalendarSchedules,
  type CalendarVisitSchedule,
  type ScheduleStatus,
} from './calendar-view.helpers';
import { VISIT_TYPE_LABELS, type BillingCadencePreview, type BillingRequirementAlert } from './day-view.shared';

// ---- Constants ------------------------------------------------------------

const STATUS_CONFIG: Record<ScheduleStatus, { label: string; className: string }> = {
  planned: { label: '予定', className: 'bg-blue-100 text-blue-800' },
  in_preparation: { label: '準備中', className: 'bg-blue-100 text-blue-800' },
  ready: { label: '準備完了', className: 'bg-green-100 text-green-800' },
  departed: { label: '出発', className: 'bg-green-200 text-green-900' },
  in_progress: { label: '訪問中', className: 'bg-yellow-100 text-yellow-800' },
  completed: { label: '完了', className: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'キャンセル', className: 'bg-red-100 text-red-800' },
  postponed: { label: '延期', className: 'bg-orange-100 text-orange-800' },
};

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

// ---- Hooks ----------------------------------------------------------------

function useMonthSchedules(orgId: string, year: number, month: number) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = endOfMonth(monthStart);
  const dateFrom = format(monthStart, 'yyyy-MM-dd');
  const dateTo = format(monthEnd, 'yyyy-MM-dd');

  return useRealtimeQuery<CalendarVisitSchedule[]>({
    queryKey: ['visit-schedules', 'calendar', orgId, year, month],
    queryFn: async () => {
      if (!orgId) return [];
      return fetchCalendarSchedules({
        orgId,
        dateFrom,
        dateTo,
      });
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    invalidateOn: ['workflow_refresh'],
  });
}

// ---- Sub-components -------------------------------------------------------

function isScheduleStatus(value: string): value is ScheduleStatus {
  return value in STATUS_CONFIG;
}

function ScheduleBadge({ schedule }: { schedule: CalendarVisitSchedule }) {
  const rawStatus = schedule.schedule_status;
  const config = isScheduleStatus(rawStatus)
    ? STATUS_CONFIG[rawStatus]
    : { label: rawStatus, className: 'bg-gray-100 text-gray-600' };
  const timeLabel = formatCalendarTimeRange(schedule);
  return (
    <span
      className={`block truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${config.className}`}
      title={timeLabel ? `${config.label} / ${timeLabel}` : config.label}
    >
      {timeLabel ? `${timeLabel} ${config.label}` : config.label}
    </span>
  );
}

function formatVisitTypeLabel(visitType: string) {
  return VISIT_TYPE_LABELS[visitType as keyof typeof VISIT_TYPE_LABELS] ?? visitType;
}

function DayPanel({
  date,
  schedules,
  onClose,
}: {
  date: Date;
  schedules: CalendarVisitSchedule[];
  onClose: () => void;
}) {
  const sortedSchedules = useMemo(() => sortCalendarSchedules(schedules), [schedules]);

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
      {sortedSchedules.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          この日のスケジュールはありません
        </p>
      ) : (
        <ul className="divide-y">
          {sortedSchedules.map((schedule) => {
            const patient = schedule.case_?.patient;
            const timeLabel = formatCalendarTimeRange(schedule) ?? '時間未定';
            return (
              <li key={schedule.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <ScheduleBadge schedule={schedule} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {patient?.name ?? '患者未設定'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timeLabel}
                      {' / '}
                      {formatVisitTypeLabel(schedule.visit_type)}
                      {schedule.route_order != null ? ` / 順路 ${schedule.route_order}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {patient?.id ? (
                    <Link
                      href={`/patients/${patient.id}`}
                      className="rounded border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      患者詳細
                    </Link>
                  ) : null}
                  <Link
                    href={`/visits/${schedule.id}/record`}
                    className="rounded border px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    訪問記録
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- Main Component -------------------------------------------------------

export function CalendarView() {
  const orgId = useOrgId();
  const isBootstrappingOrg = !orgId;
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const { data: schedules = [], isLoading } = useMonthSchedules(orgId, year, month);
  const isCalendarLoading = isBootstrappingOrg || isLoading;

  // Build calendar grid: Mon–Sun weeks covering the full month
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const schedulesByDate = useMemo(() => {
    return groupCalendarSchedulesByDate(schedules);
  }, [schedules]);
  const schedulePreviewRequests = useMemo(
    () =>
      schedules.map((schedule) => ({
        key: schedule.id,
        case_id: schedule.case_id,
        proposed_date: schedule.scheduled_date.slice(0, 10),
        pharmacist_id: schedule.pharmacist_id,
        visit_type: schedule.visit_type,
      })),
    [schedules],
  );
  const { data: schedulePreviewMap } = useQuery({
    queryKey: ['calendar-billing-preview-map', orgId, schedulePreviewRequests],
    queryFn: async () => {
      if (schedulePreviewRequests.length === 0) return new Map();
      const response = await fetch('/api/visit-schedule-proposals/billing-preview-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ items: schedulePreviewRequests }),
      });
      if (!response.ok) throw new Error('算定プレビューの取得に失敗しました');
      const payload = (await response.json()) as {
        data: Record<
          string,
          {
            alerts: BillingRequirementAlert[];
            cadence: BillingCadencePreview;
          }
        >;
      };
      return new Map(Object.entries(payload.data));
    },
    enabled: Boolean(orgId) && schedulePreviewRequests.length > 0,
  });

  const schedulesForDay = (day: Date) =>
    schedulesByDate.get(format(day, 'yyyy-MM-dd')) ?? [];

  const today = useMemo(() => new Date(), []);
  const selectedSchedules = selectedDate ? schedulesForDay(selectedDate) : [];

  const handleDayClick = (day: Date) => {
    if (!isSameMonth(day, currentMonth)) {
      setCurrentMonth(day);
    }
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
        {isCalendarLoading ? (
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
              const dayPreviewEntries = daySchedules
                .map((schedule) => schedulePreviewMap?.get(schedule.id) ?? null)
                .filter((value): value is { alerts: BillingRequirementAlert[]; cadence: BillingCadencePreview } => value != null);
              const hasCadenceWarning = dayPreviewEntries.some((entry) =>
                entry.alerts.some((alert) => alert.severity !== 'info'),
              );
              const hasNextBillable = dayPreviewEntries.some(
                (entry) => entry.cadence.next_billable_date === format(day, 'yyyy-MM-dd'),
              );

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
                    {(hasCadenceWarning || hasNextBillable) && (
                      <div className="mb-0.5 flex flex-wrap gap-1">
                        {hasCadenceWarning ? (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800">
                            算定注意
                          </span>
                        ) : null}
                        {hasNextBillable ? (
                          <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-medium text-emerald-800">
                            次回算定可
                          </span>
                        ) : null}
                      </div>
                    )}
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
