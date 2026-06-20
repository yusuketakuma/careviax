import { describe, expect, it } from 'vitest';

import { formatDateDisplay } from './date-display';

describe('formatDateDisplay', () => {
  it('keeps the existing date-string display behavior', () => {
    expect(formatDateDisplay('2026-06-11T10:15:00.000Z')).toBe('2026-06-11');
    expect(formatDateDisplay('2026-06-11')).toBe('2026-06-11');
  });

  it('uses a placeholder for empty values', () => {
    expect(formatDateDisplay(null)).toBe('-');
    expect(formatDateDisplay(undefined)).toBe('-');
    expect(formatDateDisplay('')).toBe('-');
  });
});
