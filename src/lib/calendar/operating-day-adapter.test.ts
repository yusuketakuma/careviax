import { describe, expect, it } from 'vitest';

import { resolveOperatingState } from '@/lib/calendar/operating-day';
import {
  buildOperatingCalendarFromDbRows,
  defaultOperatingHoursRows,
  hhmmToTimeDate,
  materializeOperatingHoursRows,
  serializeHolidayRow,
  timeDateToHHmm,
} from './operating-day-adapter';

describe('operating-day DB adapter', () => {
  it('roundtrips HH:mm through UTC @db.Time dates', () => {
    const value = hhmmToTimeDate('09:30');

    expect(value).toEqual(new Date('1970-01-01T09:30:00.000Z'));
    expect(timeDateToHHmm(value)).toBe('09:30');
    expect(timeDateToHHmm(new Date('1970-01-01T18:05:00.000Z'))).toBe('18:05');
    expect(timeDateToHHmm(null)).toBeNull();
    expect(hhmmToTimeDate(null)).toBeNull();
  });

  it('rejects malformed API time strings before creating DB dates', () => {
    expect(() => hhmmToTimeDate('9:30')).toThrow(RangeError);
    expect(() => hhmmToTimeDate('24:00')).toThrow(RangeError);
    expect(() => hhmmToTimeDate('09:00:00')).toThrow(RangeError);
  });

  it('materializes missing weekly rows as visible default-open fallback rows', () => {
    const rows = materializeOperatingHoursRows('site_1', [
      {
        id: 'hours_1',
        site_id: 'site_1',
        weekday: 1,
        is_open: true,
        open_time: new Date('1970-01-01T09:00:00.000Z'),
        close_time: new Date('1970-01-01T18:00:00.000Z'),
        note: '平日',
        updated_at: new Date('2026-06-27T00:00:00.000Z'),
      },
    ]);

    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      site_id: 'site_1',
      weekday: 0,
      is_open: true,
      open_time: null,
      close_time: null,
      configured: false,
      source: 'default',
    });
    expect(rows[1]).toMatchObject({
      id: 'hours_1',
      weekday: 1,
      open_time: '09:00',
      close_time: '18:00',
      configured: true,
      source: 'stored',
    });
  });

  it('serializes BusinessHoliday date and time values for resolved read models', () => {
    expect(
      serializeHolidayRow({
        id: 'holiday_1',
        date: new Date('2026-06-27T00:00:00.000Z'),
        site_id: null,
        name: '全店休業',
        holiday_type: 'org_event',
        is_closed: false,
        open_time: new Date('1970-01-01T10:00:00.000Z'),
        close_time: new Date('1970-01-01T14:30:00.000Z'),
      }),
    ).toEqual({
      id: 'holiday_1',
      date: '2026-06-27',
      site_id: null,
      name: '全店休業',
      holiday_type: 'org_event',
      is_closed: false,
      open_time: '10:00',
      close_time: '14:30',
    });
  });

  it('builds a pure OperatingCalendar without leaking DB Date values', () => {
    const calendar = buildOperatingCalendarFromDbRows(
      'site_1',
      [
        {
          site_id: 'site_1',
          weekday: 6,
          is_open: true,
          open_time: new Date('1970-01-01T09:00:00.000Z'),
          close_time: new Date('1970-01-01T18:00:00.000Z'),
          note: null,
        },
      ],
      [
        {
          date: new Date('2026-06-27T00:00:00.000Z'),
          site_id: null,
          is_closed: true,
        },
        {
          date: new Date('2026-06-28T00:00:00.000Z'),
          site_id: 'site_1',
          is_closed: false,
          open_time: new Date('1970-01-01T10:00:00.000Z'),
          close_time: new Date('1970-01-01T12:00:00.000Z'),
        },
      ],
    );

    expect(calendar.weekly.find((row) => row.weekday === 6)).toEqual({
      weekday: 6,
      is_open: true,
      open_time: '09:00',
      close_time: '18:00',
    });
    expect(resolveOperatingState(calendar, '2026-06-27')).toEqual({
      open: false,
      reason: 'holiday',
    });
    expect(resolveOperatingState(calendar, '2026-06-28')).toEqual({
      open: true,
      from: '10:00',
      to: '12:00',
      source: 'holiday',
    });
    expect(resolveOperatingState(calendar, '2026-06-29')).toEqual({
      open: true,
      from: null,
      to: null,
      source: 'default',
    });
  });

  it('generates seven default rows for unconfigured sites', () => {
    expect(defaultOperatingHoursRows('site_1')).toHaveLength(7);
    expect(defaultOperatingHoursRows('site_1').every((row) => row.configured === false)).toBe(true);
  });
});
