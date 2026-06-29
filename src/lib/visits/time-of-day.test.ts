import { describe, expect, it } from 'vitest';

import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import {
  applyTimeDateToDate,
  timeDateToClockParts,
  timeDateToMinutes,
  timeIsoToMinutes,
  timeIsoToString,
  timeDateToString,
} from './time-of-day';

// @db.Time() values are stored as a UTC 1970-01-01 date. These helpers MUST
// read the clock via UTC accessors so the time is not shifted by the server's
// local timezone. The Vitest runner is pinned to Asia/Tokyo (UTC+9), so a
// local-timezone implementation (getHours/getMinutes) would shift a 09:00 value
// to 18:00 here — these assertions catch that regression.
describe('time-of-day @db.Time helpers (UTC, tz-safe)', () => {
  const NINE_AM = new Date('1970-01-01T09:00:00Z');
  const HALF_PAST_SIX_PM = new Date('1970-01-01T18:30:00Z');
  const MIDNIGHT = new Date('1970-01-01T00:00:00Z');

  it('timeDateToClockParts returns UTC clock parts regardless of server tz', () => {
    expect(timeDateToClockParts(NINE_AM)).toEqual({ hours: 9, minutes: 0 });
    expect(timeDateToClockParts(HALF_PAST_SIX_PM)).toEqual({ hours: 18, minutes: 30 });
    expect(timeDateToClockParts(MIDNIGHT)).toEqual({ hours: 0, minutes: 0 });
  });

  it('timeDateToString formats UTC HH:MM and returns undefined for nullish', () => {
    expect(timeDateToString(NINE_AM)).toBe('09:00');
    expect(timeDateToString(HALF_PAST_SIX_PM)).toBe('18:30');
    expect(timeDateToString(MIDNIGHT)).toBe('00:00');
    expect(timeDateToString(null)).toBeUndefined();
    expect(timeDateToString(undefined)).toBeUndefined();
  });

  it('timeDateToMinutes returns UTC minutes-of-day and null for nullish', () => {
    expect(timeDateToMinutes(NINE_AM)).toBe(9 * 60);
    expect(timeDateToMinutes(HALF_PAST_SIX_PM)).toBe(18 * 60 + 30);
    expect(timeDateToMinutes(null)).toBeNull();
    expect(timeDateToMinutes(undefined)).toBeNull();
  });

  it('timeIso helpers read @db.Time ISO sentinels via UTC clock parts', () => {
    expect(timeIsoToString('1970-01-01T09:00:00.000Z')).toBe('09:00');
    expect(timeIsoToMinutes('1970-01-01T09:00:00.000Z')).toBe(9 * 60);
    expect(timeIsoToString('1970-01-01T09:00:00.000+09:00')).toBe('09:00');
    expect(timeIsoToMinutes('1970-01-01T09:00:00.000+09:00')).toBe(9 * 60);
    expect(timeIsoToString('1970-01-01T09:00:00.000-08:00')).toBe('09:00');
    expect(timeIsoToMinutes('1970-01-01T09:00:00.000-08:00')).toBe(9 * 60);
    expect(timeIsoToString('1970-01-01T09:00:00.000-0800')).toBe('09:00');
    expect(timeIsoToMinutes('1970-01-01T09:00:00.000-0800')).toBe(9 * 60);
    expect(timeIsoToString('10:30:15')).toBe('10:30');
    expect(timeIsoToMinutes('10:30:15')).toBe(10 * 60 + 30);
    expect(timeIsoToString('not-a-date')).toBeUndefined();
    expect(timeIsoToMinutes('not-a-date')).toBeNull();
  });

  it('round-trips the UTC @db.Time writer through the scheduling read helpers', () => {
    const value = hhmmToTimeDate('09:30');
    expect(value.toISOString()).toBe('1970-01-01T09:30:00.000Z');
    expect(timeDateToClockParts(value)).toEqual({ hours: 9, minutes: 30 });
    expect(timeDateToString(value)).toBe('09:30');
    expect(timeDateToMinutes(value)).toBe(9 * 60 + 30);
  });

  it('applyTimeDateToDate stamps the UTC clock time onto a base date (local fields)', () => {
    const base = new Date(2026, 5, 12, 0, 0, 0, 0);
    const stamped = applyTimeDateToDate(base, NINE_AM, '00:00');
    expect(stamped.getHours()).toBe(9);
    expect(stamped.getMinutes()).toBe(0);
  });

  it('applyTimeDateToDate uses the fallback when the time value is nullish', () => {
    const base = new Date(2026, 5, 12, 0, 0, 0, 0);
    const stamped = applyTimeDateToDate(base, null, '07:45');
    expect(stamped.getHours()).toBe(7);
    expect(stamped.getMinutes()).toBe(45);
  });
});
