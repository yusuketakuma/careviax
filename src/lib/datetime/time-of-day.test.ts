import { describe, expect, it } from 'vitest';

import {
  clockPartsToTimeDate,
  clockStringToTimeDate,
  formatTimeOfDay,
  hhmmToTimeDate,
} from './time-of-day';

describe('clockPartsToTimeDate', () => {
  it('builds a UTC @db.Time sentinel date from clock parts', () => {
    expect(clockPartsToTimeDate(9, 5).toISOString()).toBe('1970-01-01T09:05:00.000Z');
    expect(clockPartsToTimeDate(9, 5, 30).toISOString()).toBe('1970-01-01T09:05:30.000Z');
  });

  it('rejects invalid clock parts', () => {
    expect(() => clockPartsToTimeDate(24, 0)).toThrow(RangeError);
    expect(() => clockPartsToTimeDate(9, 60)).toThrow(RangeError);
    expect(() => clockPartsToTimeDate(9, 0, 60)).toThrow(RangeError);
  });
});

describe('hhmmToTimeDate', () => {
  it('builds a UTC @db.Time sentinel date from HH:mm', () => {
    expect(hhmmToTimeDate('23:59').toISOString()).toBe('1970-01-01T23:59:00.000Z');
  });

  it('rejects non-HH:mm input', () => {
    expect(() => hhmmToTimeDate('9:00')).toThrow(RangeError);
  });
});

describe('clockStringToTimeDate', () => {
  it('builds a UTC @db.Time sentinel date from HH:mm or HH:mm:ss', () => {
    expect(clockStringToTimeDate('00:00').toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(clockStringToTimeDate('09:00').toISOString()).toBe('1970-01-01T09:00:00.000Z');
    expect(clockStringToTimeDate('23:59:58').toISOString()).toBe('1970-01-01T23:59:58.000Z');
  });

  it('rejects malformed clock strings', () => {
    expect(() => clockStringToTimeDate('9:00')).toThrow(RangeError);
    expect(() => clockStringToTimeDate('24:00')).toThrow(RangeError);
    expect(() => clockStringToTimeDate('09:60')).toThrow(RangeError);
  });
});

describe('formatTimeOfDay', () => {
  it('formats ISO timestamps as local HH:mm labels', () => {
    const date = new Date();
    date.setHours(9, 5, 0, 0);

    expect(formatTimeOfDay(date.toISOString())).toBe('09:05');
  });

  it('formats Date objects as local HH:mm labels', () => {
    expect(formatTimeOfDay(new Date(2026, 5, 12, 9, 5))).toBe('09:05');
  });

  it('returns a placeholder for invalid timestamps', () => {
    expect(formatTimeOfDay('not-a-date')).toBe('—');
  });
});
