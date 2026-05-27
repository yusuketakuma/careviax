import { addDays } from 'date-fns';

const dayNameToIndex: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  if (nth > 0) {
    const first = new Date(year, month, 1);
    const diff = (weekday - first.getDay() + 7) % 7;
    const day = 1 + diff + (nth - 1) * 7;
    if (day > new Date(year, month + 1, 0).getDate()) return null;
    return new Date(year, month, day);
  }

  if (nth < 0) {
    const last = new Date(year, month + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    const day = last.getDate() - diff + (nth + 1) * 7;
    if (day < 1) return null;
    return new Date(year, month, day);
  }

  return null;
}

function compareDateAsc(left: Date, right: Date) {
  return left.getTime() - right.getTime();
}

/**
 * Supports the subset used in PH-OS MVP:
 * - FREQ=WEEKLY;INTERVAL=n;BYDAY=MO,WE
 * - FREQ=MONTHLY;INTERVAL=n;BYDAY=1WE / -1FR / 1TU,3TU
 */
export function parseSimpleRruleDates(rrule: string, startDate: Date, endDate: Date): Date[] {
  const parts = Object.fromEntries(
    rrule.split(';').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );

  const freq = parts['FREQ'];
  const interval = Number.parseInt(parts['INTERVAL'] ?? '1', 10);
  const byday = parts['BYDAY'];

  if (!freq || !byday || Number.isNaN(interval) || interval <= 0) {
    return [];
  }

  const dates: Date[] = [];

  if (freq === 'WEEKLY') {
    const targetDays = byday
      .split(',')
      .map((entry) => dayNameToIndex[entry])
      .filter((entry) => entry !== undefined);
    const current = new Date(startDate);

    while (current <= endDate) {
      if (targetDays.includes(current.getDay())) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    if (interval === 1) {
      return dates;
    }

    const filtered: Date[] = [];
    const countPerDay: Record<number, number> = {};
    for (const date of dates) {
      const weekday = date.getDay();
      countPerDay[weekday] = (countPerDay[weekday] ?? 0) + 1;
      if ((countPerDay[weekday] - 1) % interval === 0) {
        filtered.push(date);
      }
    }
    return filtered;
  }

  if (freq === 'MONTHLY') {
    const monthlyTargets = byday
      .split(',')
      .map((entry) => entry.trim())
      .map((entry) => entry.match(/^(-?\d)([A-Z]{2})$/))
      .filter((match): match is RegExpMatchArray => match != null)
      .map((match) => ({
        nthOccurrence: Number.parseInt(match[1], 10),
        targetDayIndex: dayNameToIndex[match[2]],
      }))
      .filter(
        (target): target is { nthOccurrence: number; targetDayIndex: number } =>
          target.targetDayIndex !== undefined
      );
    if (monthlyTargets.length === 0) return dates;

    let monthCursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    let monthCount = 0;

    while (monthCursor <= endMonth) {
      if (monthCount % interval === 0) {
        for (const target of monthlyTargets) {
          const date = nthWeekdayOfMonth(
            monthCursor.getFullYear(),
            monthCursor.getMonth(),
            target.targetDayIndex,
            target.nthOccurrence
          );
          if (date && date >= startDate && date <= endDate) {
            dates.push(date);
          }
        }
      }

      monthCount += 1;
      monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    }
  }

  return dates
    .sort(compareDateAsc)
    .filter((date, index, values) => index === 0 || values[index - 1].getTime() !== date.getTime());
}

export function getNextSimpleRruleOccurrence(
  rrule: string,
  baseDate: Date,
  maxDate?: Date | null
) {
  const searchStart = addDays(baseDate, 1);
  const searchEnd = maxDate ?? addDays(baseDate, 90);

  if (searchStart > searchEnd) {
    return null;
  }

  const dates = parseSimpleRruleDates(rrule, searchStart, searchEnd);
  return dates.find((date) => date > baseDate) ?? null;
}
