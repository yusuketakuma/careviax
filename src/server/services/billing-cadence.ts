import type { ScheduleStatus } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

export const ACTIVE_BILLING_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
  'completed',
];

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    throw new RangeError('Invalid Japan business date key');
  }
  return { year, month, day };
}

export function startOfBillingDay(value: Date) {
  return utcDateFromLocalKey(japanDateKey(value));
}

export function startOfBillingWeek(value: Date) {
  const businessDate = startOfBillingDay(value);
  return addUtcDays(businessDate, -businessDate.getUTCDay());
}

export function endOfBillingWeek(value: Date) {
  const weekEnd = startOfBillingWeek(value);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return weekEnd;
}

export function buildBillingWeekKey(value: Date) {
  return formatUtcDateKey(startOfBillingWeek(value));
}

export function startOfBillingMonth(value: Date) {
  const { year, month } = parseDateKey(japanDateKey(value));
  return utcDateFromLocalKey(`${year}-${String(month).padStart(2, '0')}-01`);
}

export function endOfBillingMonth(value: Date) {
  const { year, month } = parseDateKey(japanDateKey(value));
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

export function buildBillingMonthKey(value: Date) {
  return formatUtcDateKey(startOfBillingMonth(value));
}
