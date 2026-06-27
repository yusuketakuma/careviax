import { describe, expect, it } from 'vitest';

import { canVisitOn, type VisitAvailabilityShift } from './visit-availability';
import type { HolidayRow, OperatingCalendar, OperatingHoursRow } from './operating-day';

const SITE = 'site_1';
const OTHER_SITE = 'site_2';
const DATE_KEY = '2026-06-29'; // Monday

const openShift = (overrides: Partial<VisitAvailabilityShift> = {}): VisitAvailabilityShift => ({
  site_id: SITE,
  available: true,
  available_from: '09:00',
  available_to: '18:00',
  ...overrides,
});

const weeklyRow = (overrides: Partial<OperatingHoursRow> = {}): OperatingHoursRow => ({
  weekday: 1,
  is_open: true,
  open_time: '09:00',
  close_time: '18:00',
  ...overrides,
});

function holidayMap(rows: HolidayRow[]): Map<string, HolidayRow[]> {
  const map = new Map<string, HolidayRow[]>();
  for (const row of rows) {
    const existing = map.get(row.date);
    if (existing) existing.push(row);
    else map.set(row.date, [row]);
  }
  return map;
}

function calendar(overrides: Partial<Omit<OperatingCalendar, 'siteId'>> = {}): OperatingCalendar {
  return {
    siteId: SITE,
    weekly: overrides.weekly ?? [weeklyRow()],
    holidays: overrides.holidays ?? new Map(),
  };
}

describe('canVisitOn', () => {
  it('allows a visit when the pharmacy is operating and the shift covers the visit window', () => {
    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '10:00', to: '11:00' },
      }),
    ).toEqual({
      canVisit: true,
      dateKey: DATE_KEY,
      siteId: SITE,
      operatingState: {
        open: true,
        from: '09:00',
        to: '18:00',
        source: 'weekly',
      },
    });
  });

  it('blocks when the pharmacy calendar is closed by an org-wide holiday', () => {
    expect(
      canVisitOn({
        calendar: calendar({
          holidays: holidayMap([{ date: DATE_KEY, site_id: null, is_closed: true }]),
        }),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '10:00', to: '11:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacy_holiday',
    });
  });

  it('blocks when weekly operating hours mark the site regularly closed', () => {
    expect(
      canVisitOn({
        calendar: calendar({ weekly: [weeklyRow({ is_open: false })] }),
        dateKey: DATE_KEY,
        shift: openShift(),
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacy_regular_closed',
    });
  });

  it('blocks visits outside the pharmacy operating window before checking the shift window', () => {
    expect(
      canVisitOn({
        calendar: calendar({ weekly: [weeklyRow({ open_time: '10:00', close_time: '14:00' })] }),
        dateKey: DATE_KEY,
        shift: openShift({ available_from: '09:00', available_to: '18:00' }),
        visitWindow: { from: '15:00', to: '16:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'outside_pharmacy_operating_window',
    });
  });

  it('blocks invalid pharmacy operating windows fail-closed', () => {
    expect(
      canVisitOn({
        calendar: calendar({ weekly: [weeklyRow({ open_time: '18:00', close_time: '09:00' })] }),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '10:00', to: '11:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'invalid_pharmacy_operating_window',
    });
  });

  it('blocks when there is no pharmacist shift or the shift is unavailable', () => {
    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: null,
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacist_shift_missing',
    });

    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift({ available: false }),
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacist_unavailable',
    });
  });

  it('blocks missing or mismatched shift sites before time-window checks', () => {
    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift({ site_id: null }),
        visitWindow: { from: '10:00', to: '11:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacist_shift_site_missing',
    });

    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift({ site_id: OTHER_SITE }),
        visitWindow: { from: '10:00', to: '11:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'pharmacist_shift_site_mismatch',
    });
  });

  it('blocks malformed or reversed shift and visit windows fail-closed', () => {
    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift({ available_from: '99:99' }),
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'invalid_pharmacist_shift_window',
    });

    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '12:00', to: '10:00' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'invalid_visit_window',
    });
  });

  it('blocks visits outside the pharmacist shift window', () => {
    expect(
      canVisitOn({
        calendar: calendar({ weekly: [weeklyRow({ open_time: '08:00', close_time: '20:00' })] }),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '08:30', to: '09:30' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'outside_pharmacist_shift_window',
    });

    expect(
      canVisitOn({
        calendar: calendar({ weekly: [weeklyRow({ open_time: '08:00', close_time: '20:00' })] }),
        dateKey: DATE_KEY,
        shift: openShift(),
        visitWindow: { from: '17:30', to: '18:30' },
      }),
    ).toMatchObject({
      canVisit: false,
      reason: 'outside_pharmacist_shift_window',
    });
  });

  it('treats omitted time bounds as unbounded while preserving site/calendar checks', () => {
    expect(
      canVisitOn({
        calendar: calendar(),
        dateKey: DATE_KEY,
        shift: openShift({ available_from: null, available_to: null }),
      }),
    ).toMatchObject({
      canVisit: true,
      siteId: SITE,
    });
  });
});
