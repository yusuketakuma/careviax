const dayNameToIndex: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type SimpleRruleParseDiagnostics = {
  invalidBydayTokens: string[];
};

export type SimpleRruleParseOptions = {
  seriesAnchorDate?: Date | null;
};

export type SimpleRruleParseResult = {
  dates: Date[];
  diagnostics: SimpleRruleParseDiagnostics;
};

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const diff = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + diff + (nth - 1) * 7;
    if (day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null;
    return new Date(Date.UTC(year, month, day));
  }

  if (nth < 0) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    const day = last.getUTCDate() - diff + (nth + 1) * 7;
    if (day < 1) return null;
    return new Date(Date.UTC(year, month, day));
  }

  return null;
}

function compareDateAsc(left: Date, right: Date) {
  return left.getTime() - right.getTime();
}

function utcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcIsoWeek(value: Date) {
  const weekStart = utcDateOnly(value);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  return weekStart;
}

function utcIsoWeekOffset(date: Date, anchorDate: Date) {
  return Math.floor(
    (startOfUtcIsoWeek(date).getTime() - startOfUtcIsoWeek(anchorDate).getTime()) / WEEK_MS,
  );
}

function utcMonthIndex(value: Date) {
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

function addUtcDays(value: Date, days: number) {
  const normalized = utcDateOnly(value);
  normalized.setUTCDate(normalized.getUTCDate() + days);
  return normalized;
}

function parseWeeklyByday(byday: string) {
  const invalidBydayTokens: string[] = [];
  const targetDays = new Set<number>();

  for (const rawEntry of byday.split(',')) {
    const entry = rawEntry.trim().toUpperCase();
    const dayIndex = dayNameToIndex[entry];
    if (entry.length === 0 || dayIndex === undefined) {
      invalidBydayTokens.push(entry || rawEntry);
      continue;
    }
    targetDays.add(dayIndex);
  }

  return { targetDays, invalidBydayTokens };
}

function parseMonthlyByday(byday: string) {
  const invalidBydayTokens: string[] = [];
  const monthlyTargets: Array<{ nthOccurrence: number; targetDayIndex: number }> = [];

  for (const rawEntry of byday.split(',')) {
    const entry = rawEntry.trim().toUpperCase();
    const match = entry.match(/^(-?\d)([A-Z]{2})$/);
    const nthOccurrence = match ? Number.parseInt(match[1], 10) : 0;
    const targetDayIndex = match ? dayNameToIndex[match[2]] : undefined;
    if (
      !match ||
      nthOccurrence === 0 ||
      Math.abs(nthOccurrence) > 5 ||
      targetDayIndex === undefined
    ) {
      invalidBydayTokens.push(entry || rawEntry);
      continue;
    }
    monthlyTargets.push({ nthOccurrence, targetDayIndex });
  }

  return { monthlyTargets, invalidBydayTokens };
}

function parseRruleParts(rrule: string) {
  const parts: Record<string, string> = {};

  for (const part of rrule.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    if (!rawKey || rawValueParts.length === 0) continue;
    parts[rawKey.trim().toUpperCase()] = rawValueParts.join('=').trim();
  }

  return parts;
}

/**
 * Supports the subset used in PH-OS MVP:
 * - FREQ=WEEKLY;INTERVAL=n;BYDAY=MO,WE
 * - FREQ=MONTHLY;INTERVAL=n;BYDAY=1WE / -1FR / 1TU,3TU
 */
export function parseSimpleRruleDatesWithDiagnostics(
  rrule: string,
  startDate: Date,
  endDate: Date,
  options: SimpleRruleParseOptions = {},
): SimpleRruleParseResult {
  const startBoundary = utcDateOnly(startDate);
  const endBoundary = utcDateOnly(endDate);
  const seriesAnchorBoundary = utcDateOnly(options.seriesAnchorDate ?? startBoundary);
  const parts = parseRruleParts(rrule);

  const freq = parts['FREQ'];
  const interval = Number.parseInt(parts['INTERVAL'] ?? '1', 10);
  const byday = parts['BYDAY'];
  const diagnostics: SimpleRruleParseDiagnostics = { invalidBydayTokens: [] };

  if (!freq || !byday || Number.isNaN(interval) || interval <= 0) {
    return { dates: [], diagnostics };
  }

  const dates: Date[] = [];

  if (freq === 'WEEKLY') {
    const { targetDays, invalidBydayTokens } = parseWeeklyByday(byday);
    diagnostics.invalidBydayTokens.push(...invalidBydayTokens);
    if (targetDays.size === 0) return { dates, diagnostics };

    const current = new Date(startBoundary);

    while (current <= endBoundary) {
      const weekOffset = utcIsoWeekOffset(current, seriesAnchorBoundary);
      if (weekOffset >= 0 && weekOffset % interval === 0 && targetDays.has(current.getUTCDay())) {
        dates.push(
          new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())),
        );
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return { dates, diagnostics };
  }

  if (freq === 'MONTHLY') {
    const { monthlyTargets, invalidBydayTokens } = parseMonthlyByday(byday);
    diagnostics.invalidBydayTokens.push(...invalidBydayTokens);
    if (monthlyTargets.length === 0) return { dates, diagnostics };

    let monthCursor = new Date(
      Date.UTC(startBoundary.getUTCFullYear(), startBoundary.getUTCMonth(), 1),
    );
    const endMonth = new Date(Date.UTC(endBoundary.getUTCFullYear(), endBoundary.getUTCMonth(), 1));
    const anchorMonthIndex = utcMonthIndex(seriesAnchorBoundary);

    while (monthCursor <= endMonth) {
      const monthOffset = utcMonthIndex(monthCursor) - anchorMonthIndex;
      if (monthOffset >= 0 && monthOffset % interval === 0) {
        for (const target of monthlyTargets) {
          const date = nthWeekdayOfMonth(
            monthCursor.getUTCFullYear(),
            monthCursor.getUTCMonth(),
            target.targetDayIndex,
            target.nthOccurrence,
          );
          if (date && date >= startBoundary && date <= endBoundary) {
            dates.push(date);
          }
        }
      }

      monthCursor = new Date(
        Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1),
      );
    }
  }

  return {
    dates: dates
      .sort(compareDateAsc)
      .filter(
        (date, index, values) => index === 0 || values[index - 1].getTime() !== date.getTime(),
      ),
    diagnostics,
  };
}

export function parseSimpleRruleDates(
  rrule: string,
  startDate: Date,
  endDate: Date,
  options: SimpleRruleParseOptions = {},
): Date[] {
  return parseSimpleRruleDatesWithDiagnostics(rrule, startDate, endDate, options).dates;
}

export function getNextSimpleRruleOccurrence(
  rrule: string,
  baseDate: Date,
  maxDate?: Date | null,
  options: SimpleRruleParseOptions = {},
) {
  const baseBoundary = utcDateOnly(baseDate);
  const searchStart = addUtcDays(baseBoundary, 1);
  const searchEnd = maxDate ? utcDateOnly(maxDate) : addUtcDays(baseBoundary, 90);

  if (searchStart > searchEnd) {
    return null;
  }

  const dates = parseSimpleRruleDates(rrule, searchStart, searchEnd, {
    seriesAnchorDate: options.seriesAnchorDate ?? baseBoundary,
  });
  return dates.find((date) => date > baseBoundary) ?? null;
}
