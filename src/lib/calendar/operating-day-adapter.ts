import { formatUtcDateKey } from '@/lib/date-key';
import type {
  HolidayRow,
  OperatingCalendar,
  OperatingHoursRow,
} from '@/lib/calendar/operating-day';
import { timeStringToMinutes } from '@/lib/calendar/operating-day';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type DbOperatingHoursRecord = {
  id?: string;
  site_id: string;
  weekday: number;
  is_open: boolean;
  open_time: Date | null;
  close_time: Date | null;
  note: string | null;
  updated_at?: Date;
};

export type DbHolidayRecord = {
  id?: string;
  site_id: string | null;
  date: Date;
  name?: string;
  holiday_type?: string;
  is_closed: boolean;
  open_time?: Date | null;
  close_time?: Date | null;
};

export type SerializedOperatingHoursRow = {
  id: string | null;
  site_id: string;
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  note: string | null;
  configured: boolean;
  source: 'stored' | 'default';
  updated_at?: string | null;
};

export type SerializedHolidayRow = {
  id?: string;
  date: string;
  site_id: string | null;
  name?: string;
  holiday_type?: string;
  is_closed: boolean;
  open_time: string | null;
  close_time: string | null;
};

export function timeDateToHHmm(value: Date | null | undefined): string | null {
  if (!value) return null;
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function hhmmToTimeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (timeStringToMinutes(value) == null || value.length !== 5) {
    throw new RangeError(`Invalid HH:mm time: ${value}`);
  }
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
}

export function serializeOperatingHoursRow(
  row: DbOperatingHoursRecord,
): SerializedOperatingHoursRow {
  return {
    id: row.id ?? null,
    site_id: row.site_id,
    weekday: row.weekday,
    is_open: row.is_open,
    open_time: timeDateToHHmm(row.open_time),
    close_time: timeDateToHHmm(row.close_time),
    note: row.note,
    configured: true,
    source: 'stored',
    ...(row.updated_at ? { updated_at: row.updated_at.toISOString() } : {}),
  };
}

export function serializeHolidayRow(row: DbHolidayRecord): SerializedHolidayRow {
  return {
    ...(row.id ? { id: row.id } : {}),
    date: formatUtcDateKey(row.date),
    site_id: row.site_id,
    ...(row.name ? { name: row.name } : {}),
    ...(row.holiday_type ? { holiday_type: row.holiday_type } : {}),
    is_closed: row.is_closed,
    open_time: timeDateToHHmm(row.open_time),
    close_time: timeDateToHHmm(row.close_time),
  };
}

export function defaultOperatingHoursRows(siteId: string): SerializedOperatingHoursRow[] {
  return WEEKDAYS.map((weekday) => ({
    id: null,
    site_id: siteId,
    weekday,
    is_open: true,
    open_time: null,
    close_time: null,
    note: null,
    configured: false,
    source: 'default',
  }));
}

export function materializeOperatingHoursRows(
  siteId: string,
  rows: DbOperatingHoursRecord[],
): SerializedOperatingHoursRow[] {
  const storedByWeekday = new Map(
    rows.map((row) => [row.weekday, serializeOperatingHoursRow(row)]),
  );
  return defaultOperatingHoursRows(siteId).map(
    (fallback) => storedByWeekday.get(fallback.weekday) ?? fallback,
  );
}

function toResolverWeeklyRow(row: SerializedOperatingHoursRow): OperatingHoursRow {
  return {
    weekday: row.weekday,
    is_open: row.is_open,
    open_time: row.open_time,
    close_time: row.close_time,
  };
}

function groupHolidayRows(rows: HolidayRow[]): Map<string, HolidayRow[]> {
  const map = new Map<string, HolidayRow[]>();
  for (const row of rows) {
    const existing = map.get(row.date);
    if (existing) existing.push(row);
    else map.set(row.date, [row]);
  }
  return map;
}

export function buildOperatingCalendarFromDbRows(
  siteId: string,
  weeklyRows: DbOperatingHoursRecord[],
  holidayRows: DbHolidayRecord[],
): OperatingCalendar {
  const weekly = weeklyRows.map((row) => toResolverWeeklyRow(serializeOperatingHoursRow(row)));
  const holidays = holidayRows.map(
    (row): HolidayRow => ({
      date: formatUtcDateKey(row.date),
      site_id: row.site_id,
      is_closed: row.is_closed,
      open_time: timeDateToHHmm(row.open_time),
      close_time: timeDateToHHmm(row.close_time),
    }),
  );
  return {
    siteId,
    weekly,
    holidays: groupHolidayRows(holidays),
  };
}
