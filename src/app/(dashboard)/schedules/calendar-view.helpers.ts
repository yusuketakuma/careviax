import { timeIsoToMinutes } from '@/lib/visits/time-of-day';
import type { PatientOperationalSummary } from '@/lib/patient/operational-summary';
import { fetchVisitSchedulesWindow } from './visit-schedule-fetch.helpers';

// 状態 enum は canonical な validations/visit-schedule を単一ソースとする(型 drift 防止)。
// ローカル再定義は rescheduled / no_show が欠落し、実行時にそれらが来ると
// カレンダーで生 enum 露出＋灰色化していたため、正本へ寄せた。
// ローカルの型注釈で使うため import し、canonical 型として再エクスポートする
// (`export type { X } from '...'` は再エクスポートのみでローカル束縛を作らない)。
import type { ScheduleStatus } from '@/lib/validations/visit-schedule';

export type { ScheduleStatus };

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
  patient_summary?: PatientOperationalSummary | null;
};

function timeSortValue(value: string | null | undefined) {
  if (!value) return '99:99';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  return '99:99';
}

export function formatCalendarTimeRange(
  schedule: Pick<CalendarVisitSchedule, 'time_window_start' | 'time_window_end'>,
) {
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
  return timeIsoToMinutes(value) ?? fallback;
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
