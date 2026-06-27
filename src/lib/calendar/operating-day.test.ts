import { describe, expect, it } from 'vitest';

import {
  addOperatingDays,
  buildOperatingCalendarLegacy,
  isOperatingDay,
  isValidOperatingWindow,
  nearestOperatingDay,
  resolveOperatingState,
  shiftDateKey,
  timeStringToMinutes,
  weekdayOfDateKey,
  type HolidayRow,
  type OperatingCalendar,
  type OperatingHoursRow,
} from './operating-day';

const SITE = 'site_1';
const OTHER_SITE = 'site_2';

function calendar(
  partial: Partial<Omit<OperatingCalendar, 'siteId'>> & { siteId?: string } = {},
): OperatingCalendar {
  return {
    siteId: partial.siteId ?? SITE,
    weekly: partial.weekly ?? [],
    holidays: partial.holidays ?? new Map(),
  };
}

function holidayMap(rows: HolidayRow[]): Map<string, HolidayRow[]> {
  const map = new Map<string, HolidayRow[]>();
  for (const row of rows) {
    const existing = map.get(row.date);
    if (existing) existing.push(row);
    else map.set(row.date, [row]);
  }
  return map;
}

const weekdayRow = (
  overrides: Partial<OperatingHoursRow> & { weekday: number },
): OperatingHoursRow => ({
  is_open: true,
  open_time: '09:00',
  close_time: '18:00',
  ...overrides,
});

describe('weekdayOfDateKey', () => {
  it('is timezone-independent (UTC-based)', () => {
    // 2026-06-27 is a Saturday (6); 2026-06-28 a Sunday (0).
    expect(weekdayOfDateKey('2026-06-27')).toBe(6);
    expect(weekdayOfDateKey('2026-06-28')).toBe(0);
    expect(weekdayOfDateKey('2026-06-29')).toBe(1);
  });

  it('rejects malformed keys', () => {
    expect(() => weekdayOfDateKey('2026-6-1')).toThrow(RangeError);
    expect(() => weekdayOfDateKey('not-a-date')).toThrow(RangeError);
  });
});

describe('shiftDateKey', () => {
  it('adds and subtracts calendar days across month/year boundaries', () => {
    expect(shiftDateKey('2026-06-27', 1)).toBe('2026-06-28');
    expect(shiftDateKey('2026-06-30', 1)).toBe('2026-07-01');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('timeStringToMinutes / isValidOperatingWindow', () => {
  it('parses HH:mm and HH:mm:ss', () => {
    expect(timeStringToMinutes('09:00')).toBe(540);
    expect(timeStringToMinutes('18:30')).toBe(1110);
    expect(timeStringToMinutes('09:00:00')).toBe(540);
    expect(timeStringToMinutes(null)).toBeNull();
    expect(timeStringToMinutes('')).toBeNull();
    expect(timeStringToMinutes('bad')).toBeNull();
  });

  it('treats null open/close as a valid (all-day) window', () => {
    expect(isValidOperatingWindow(null, null)).toBe(true);
    expect(isValidOperatingWindow('09:00', null)).toBe(true);
    expect(isValidOperatingWindow(null, '18:00')).toBe(true);
  });

  it('rejects from >= to', () => {
    expect(isValidOperatingWindow('09:00', '18:00')).toBe(true);
    expect(isValidOperatingWindow('18:00', '09:00')).toBe(false);
    expect(isValidOperatingWindow('09:00', '09:00')).toBe(false);
  });
});

describe('resolveOperatingState — fallback (§1)', () => {
  it('defaults to open when there are no weekly rows and no holidays', () => {
    const result = resolveOperatingState(calendar(), '2026-06-27');
    expect(result).toEqual({ open: true, from: null, to: null, source: 'default' });
  });
});

describe('resolveOperatingState — weekly (§1 step 2)', () => {
  it('is closed on a regular day off', () => {
    const cal = calendar({ weekly: [weekdayRow({ weekday: 0, is_open: false })] });
    // 2026-06-28 is Sunday (0)
    expect(resolveOperatingState(cal, '2026-06-28')).toEqual({
      open: false,
      reason: 'regular_closed',
    });
  });

  it('is open with weekly hours on a business weekday', () => {
    const cal = calendar({
      weekly: [weekdayRow({ weekday: 6, open_time: '09:00', close_time: '13:00' })],
    });
    // 2026-06-27 is Saturday (6)
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({
      open: true,
      from: '09:00',
      to: '13:00',
      source: 'weekly',
    });
  });
});

describe('resolveOperatingState — holiday precedence (§1.1)', () => {
  const weekly = [weekdayRow({ weekday: 6 })]; // Saturday open by default

  it('site-specific closure closes only that site', () => {
    const cal = calendar({
      weekly,
      holidays: holidayMap([{ date: '2026-06-27', site_id: SITE, is_closed: true }]),
    });
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({ open: false, reason: 'holiday' });
  });

  it('org-wide closure closes every site', () => {
    const cal = calendar({
      weekly,
      holidays: holidayMap([{ date: '2026-06-27', site_id: null, is_closed: true }]),
    });
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({ open: false, reason: 'holiday' });
  });

  it('org-wide closed CANNOT be overridden by a site-specific open (conservative §1.1)', () => {
    const cal = calendar({
      weekly,
      holidays: holidayMap([
        { date: '2026-06-27', site_id: null, is_closed: true },
        {
          date: '2026-06-27',
          site_id: SITE,
          is_closed: false,
          open_time: '10:00',
          close_time: '12:00',
        },
      ]),
    });
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({ open: false, reason: 'holiday' });
  });

  it('site closed wins even when an org-wide open row exists', () => {
    const cal = calendar({
      weekly,
      holidays: holidayMap([
        {
          date: '2026-06-27',
          site_id: null,
          is_closed: false,
          open_time: '10:00',
          close_time: '15:00',
        },
        { date: '2026-06-27', site_id: SITE, is_closed: true },
      ]),
    });
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({ open: false, reason: 'holiday' });
  });

  it('holiday open row marks 臨時/短縮営業 with its window (source=holiday)', () => {
    const cal = calendar({
      weekly: [weekdayRow({ weekday: 0, is_open: false })], // Sunday normally closed
      holidays: holidayMap([
        {
          date: '2026-06-28',
          site_id: SITE,
          is_closed: false,
          open_time: '10:00',
          close_time: '14:00',
        },
      ]),
    });
    // Sunday, but a 臨時営業 holiday row opens it
    expect(resolveOperatingState(cal, '2026-06-28')).toEqual({
      open: true,
      from: '10:00',
      to: '14:00',
      source: 'holiday',
    });
  });

  it('prefers a site-specific open row over an org-wide open row', () => {
    const cal = calendar({
      holidays: holidayMap([
        {
          date: '2026-06-27',
          site_id: null,
          is_closed: false,
          open_time: '09:00',
          close_time: '17:00',
        },
        {
          date: '2026-06-27',
          site_id: SITE,
          is_closed: false,
          open_time: '10:00',
          close_time: '12:00',
        },
      ]),
    });
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({
      open: true,
      from: '10:00',
      to: '12:00',
      source: 'holiday',
    });
  });

  it('ignores holiday rows belonging to another site', () => {
    const cal = calendar({
      holidays: holidayMap([{ date: '2026-06-27', site_id: OTHER_SITE, is_closed: true }]),
    });
    // other site's closure does not apply → falls through to default open
    expect(resolveOperatingState(cal, '2026-06-27')).toEqual({
      open: true,
      from: null,
      to: null,
      source: 'default',
    });
  });
});

describe('isOperatingDay', () => {
  it('reflects resolveOperatingState.open', () => {
    const cal = calendar({
      weekly: [weekdayRow({ weekday: 0, is_open: false })],
    });
    expect(isOperatingDay(cal, '2026-06-27')).toBe(true); // Saturday default open
    expect(isOperatingDay(cal, '2026-06-28')).toBe(false); // Sunday closed
  });
});

describe('nearestOperatingDay', () => {
  // Closed every Sunday; org-wide closure on 2026-06-29 (Mon) and 2026-06-30 (Tue)
  const cal = calendar({
    weekly: [
      weekdayRow({ weekday: 0, is_open: false }),
      ...[1, 2, 3, 4, 5, 6].map((weekday) => weekdayRow({ weekday })),
    ],
    holidays: holidayMap([
      { date: '2026-06-29', site_id: null, is_closed: true },
      { date: '2026-06-30', site_id: null, is_closed: true },
    ]),
  });

  it('returns the start date when it is already an operating day', () => {
    expect(nearestOperatingDay(cal, '2026-06-27', 'backward')).toBe('2026-06-27');
    expect(nearestOperatingDay(cal, '2026-06-27', 'forward')).toBe('2026-06-27');
  });

  it('walks backward to the previous operating day (前倒し原則)', () => {
    // 2026-06-29 Mon is a holiday; 06-28 Sun is closed; 06-27 Sat is open
    expect(nearestOperatingDay(cal, '2026-06-29', 'backward')).toBe('2026-06-27');
  });

  it('walks forward across a multi-day closure', () => {
    // 06-28 Sun closed, 06-29/06-30 holidays, 07-01 Wed open
    expect(nearestOperatingDay(cal, '2026-06-28', 'forward')).toBe('2026-07-01');
  });

  it('returns the start date when nothing is found within maxScan', () => {
    const allClosed = calendar({
      weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => weekdayRow({ weekday, is_open: false })),
    });
    expect(nearestOperatingDay(allClosed, '2026-06-27', 'forward', 10)).toBe('2026-06-27');
  });
});

describe('addOperatingDays', () => {
  const cal = calendar({
    weekly: [
      weekdayRow({ weekday: 0, is_open: false }), // Sunday closed
      ...[1, 2, 3, 4, 5, 6].map((weekday) => weekdayRow({ weekday })),
    ],
  });

  it('returns the start date for n=0', () => {
    expect(addOperatingDays(cal, '2026-06-27', 0)).toBe('2026-06-27');
  });

  it('counts only operating days forward (skips Sunday)', () => {
    // From Sat 06-27: +1 op day skips Sun 06-28 → Mon 06-29
    expect(addOperatingDays(cal, '2026-06-27', 1)).toBe('2026-06-29');
    // +2 → Tue 06-30
    expect(addOperatingDays(cal, '2026-06-27', 2)).toBe('2026-06-30');
  });

  it('counts only operating days backward', () => {
    // From Mon 06-29: -1 op day skips Sun 06-28 → Sat 06-27
    expect(addOperatingDays(cal, '2026-06-29', -1)).toBe('2026-06-27');
  });

  it('returns null when the target is unreachable within maxScan', () => {
    const allClosed = calendar({
      weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => weekdayRow({ weekday, is_open: false })),
    });
    expect(addOperatingDays(allClosed, '2026-06-27', 1, 30)).toBeNull();
  });
});

describe('buildOperatingCalendarLegacy (R1 behavior-preserving adapter)', () => {
  const utcDate = (key: string) => new Date(`${key}T00:00:00.000Z`);

  it('includes only is_closed=true rows and leaves weekly empty', () => {
    const cal = buildOperatingCalendarLegacy(SITE, [
      { date: utcDate('2026-06-29'), site_id: null, is_closed: true },
      { date: utcDate('2026-06-30'), site_id: SITE, is_closed: false }, // 臨時営業 → ignored in legacy
    ]);
    expect(cal.siteId).toBe(SITE);
    expect(cal.weekly).toEqual([]);
    expect(cal.holidays.get('2026-06-29')).toEqual([
      { date: '2026-06-29', site_id: null, is_closed: true },
    ]);
    // is_closed=false row is dropped (legacy planner never saw weekly/open semantics)
    expect(cal.holidays.has('2026-06-30')).toBe(false);
  });

  it('drops closures belonging to another site but keeps org-wide closures', () => {
    const cal = buildOperatingCalendarLegacy(SITE, [
      { date: utcDate('2026-07-01'), site_id: OTHER_SITE, is_closed: true },
      { date: utcDate('2026-07-02'), site_id: null, is_closed: true },
    ]);
    expect(cal.holidays.has('2026-07-01')).toBe(false);
    expect(cal.holidays.get('2026-07-02')).toEqual([
      { date: '2026-07-02', site_id: null, is_closed: true },
    ]);
  });

  it('produces a calendar that resolves legacy closures correctly (no weekly closures)', () => {
    const cal = buildOperatingCalendarLegacy(SITE, [
      { date: utcDate('2026-06-29'), site_id: null, is_closed: true },
    ]);
    // closed on the holiday
    expect(resolveOperatingState(cal, '2026-06-29')).toEqual({ open: false, reason: 'holiday' });
    // every other day is default-open (legacy has no weekly day-offs) — including Sunday
    expect(resolveOperatingState(cal, '2026-06-28')).toEqual({
      open: true,
      from: null,
      to: null,
      source: 'default',
    });
  });
});
