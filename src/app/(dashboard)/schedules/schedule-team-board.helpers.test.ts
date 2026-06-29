import { describe, expect, it } from 'vitest';

import {
  formatScheduleTimeIso,
  formatTimeOfDayIso,
  minutesOfDayIso,
} from './schedule-team-board.helpers';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

describe('formatTimeOfDayIso', () => {
  it('keeps the compatibility export while using the shared time formatter', () => {
    expect(formatTimeOfDayIso(localIso(9, 5))).toBe('09:05');
    expect(formatTimeOfDayIso('not-a-date')).toBe('—');
  });
});

describe('schedule @db.Time ISO helpers', () => {
  it('reads UTC clock parts for visit and proposal time_start values', () => {
    expect(formatScheduleTimeIso('1970-01-01T09:05:00.000Z')).toBe('09:05');
    expect(minutesOfDayIso('1970-01-01T09:05:00.000Z')).toBe(9 * 60 + 5);
    expect(formatScheduleTimeIso('1970-01-01T09:05:00.000-08:00')).toBe('09:05');
    expect(minutesOfDayIso('1970-01-01T09:05:00.000-0800')).toBe(9 * 60 + 5);
  });
});
