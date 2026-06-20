import { describe, expect, it } from 'vitest';

import { formatTimeOfDay } from './time-of-day';

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
