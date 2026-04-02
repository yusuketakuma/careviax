import { format, parseISO } from 'date-fns';
import { fetchVisitSchedulesWindow } from './visit-schedule-fetch.helpers';
import { timeLabel } from './day-view.shared';

export type ScheduleStatus =
  | 'planned'
  | 'in_preparation'
  | 'ready'
  | 'departed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'postponed';

export type CalendarVisitSchedule = {
  id: string;
  scheduled_date: string;
  schedule_status: ScheduleStatus;
  visit_type: string;
  pharmacist_id: string;
  case_id: string;
  cycle_id: string | null;
  route_order?: number | null;
  time_window_start?: string | null;
  time_window_end?: string | null;
  case_?: {
    patient?: {
      id: string;
      name: string;
    };
  };
};

function timeSortValue(value: string | null | undefined) {
  if (!value) return '99:99';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  return '99:99';
}

export function formatCalendarTimeRange(schedule: Pick<CalendarVisitSchedule, 'time_window_start' | 'time_window_end'>) {
  const start = schedule.time_window_start ? timeSortValue(schedule.time_window_start) : null;
  const end = schedule.time_window_end ? timeSortValue(schedule.time_window_end) : null;
  if (!start && !end) return null;
  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}

export function sortCalendarSchedules<T extends CalendarVisitSchedule>(schedules: T[]) {
  return [...schedules].sort((left, right) => {
    if (left.route_order != null || right.route_order != null) {
      if (left.route_order == null) return 1;
      if (right.route_order == null) return -1;
      if (left.route_order !== right.route_order) {
        return left.route_order - right.route_order;
      }
    }

    const timeDiff = timeSortValue(left.time_window_start).localeCompare(
      timeSortValue(right.time_window_start),
    );
    if (timeDiff !== 0) return timeDiff;

    return (left.case_?.patient?.name ?? '').localeCompare(right.case_?.patient?.name ?? '', 'ja');
  });
}

export function groupCalendarSchedulesByDate<T extends CalendarVisitSchedule>(schedules: T[]) {
  const grouped = new Map<string, T[]>();

  for (const schedule of schedules) {
    const key = schedule.scheduled_date.slice(0, 10);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(schedule);
    else grouped.set(key, [schedule]);
  }

  for (const [key, bucket] of grouped) {
    grouped.set(key, sortCalendarSchedules(bucket));
  }

  return grouped;
}

export async function fetchCalendarSchedules(args: {
  orgId: string;
  dateFrom: string;
  dateTo: string;
  fetchImpl?: typeof fetch;
  limit?: number;
  maxPages?: number;
}) {
  return fetchVisitSchedulesWindow<CalendarVisitSchedule>(args);
}

// ---- Day-view helpers -----------------------------------------------------

export function minutesFromTimestamp(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = parseISO(value);
  return parsed.getHours() * 60 + parsed.getMinutes();
}

export function roundDownToSlot(value: number, slotMinutes: number) {
  return Math.floor(value / slotMinutes) * slotMinutes;
}

export function roundUpToSlot(value: number, slotMinutes: number) {
  return Math.ceil(value / slotMinutes) * slotMinutes;
}

export function buildOrderedFacilityScheduleIds(
  group: {
    patients: Array<{
      scheduleId: string;
      unitName: string | null;
    }>;
  },
  routeDraft: Record<string, string>,
) {
  return [...group.patients]
    .sort((left, right) => {
      const leftOrder = Number.parseInt(routeDraft[left.scheduleId] ?? '', 10);
      const rightOrder = Number.parseInt(routeDraft[right.scheduleId] ?? '', 10);
      const resolvedLeft = Number.isNaN(leftOrder) ? Number.MAX_SAFE_INTEGER : leftOrder;
      const resolvedRight = Number.isNaN(rightOrder) ? Number.MAX_SAFE_INTEGER : rightOrder;
      if (resolvedLeft !== resolvedRight) return resolvedLeft - resolvedRight;

      const leftUnit = left.unitName ?? '';
      const rightUnit = right.unitName ?? '';
      return leftUnit.localeCompare(rightUnit, 'ja', {
        numeric: true,
        sensitivity: 'base',
      });
    })
    .map((patient) => patient.scheduleId);
}

export function formatMinutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatDistanceLabel(value: number | null) {
  if (value == null) return '距離未取得';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}km`;
  return `${value}m`;
}

export function formatDurationLabel(value: number | null) {
  if (value == null) return '時間未取得';
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

export function formatEtaLabel(
  baseDate: string,
  departureTime: string | null,
  offsetSeconds: number | null,
  fallbackTime: string | null,
) {
  if (offsetSeconds == null) return fallbackTime ? timeLabel(fallbackTime, null) : null;
  const normalizedDepartureTime = departureTime
    ? format(parseISO(departureTime), 'HH:mm:ss')
    : '09:00:00';
  const base = parseISO(`${baseDate}T${normalizedDepartureTime}`);
  const shifted = new Date(base.getTime() + offsetSeconds * 1000);
  return format(shifted, 'HH:mm');
}
