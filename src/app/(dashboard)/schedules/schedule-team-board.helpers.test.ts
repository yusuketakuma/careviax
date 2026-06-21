import { describe, expect, it } from 'vitest';

import { formatTimeOfDayIso } from './schedule-team-board.helpers';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

describe('formatTimeOfDayIso', () => {
  it('keeps the compatibility export while using the shared time formatter', () => {
    expect(formatTimeOfDayIso(localIso(9, 5))).toBe('09:05');
    expect(formatTimeOfDayIso('not-a-date')).toBe('—');
  });
});
