import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: vi.fn(),
}));

import {
  formatDateKey,
  hasAnyKeyword,
  parseConferenceSections,
  parseDateFromConferenceText,
  startOfDay,
} from './daily-helpers';

describe('daily-helpers', () => {
  it('extracts conference sections from structured content', () => {
    expect(
      parseConferenceSections({
        sections: [
          ['unexpected'],
          { key: 123, body: 'invalid' },
          { key: 'ignored_numeric_body', body: 123 },
          { key: 'next_meeting_date', body: '2026-04-02' },
          { key: 'memo', body: '共有事項' },
        ],
      }),
    ).toEqual([
      { key: 'next_meeting_date', body: '2026-04-02' },
      { key: 'memo', body: '共有事項' },
    ]);

    expect(parseConferenceSections({ sections: 'invalid' })).toEqual([]);
    expect(parseConferenceSections(null)).toEqual([]);
  });

  it('parses conference dates from ISO-like text and normalizes to start of day', () => {
    const parsed = parseDateFromConferenceText('2026-04-02');
    expect(parsed).not.toBeNull();
    expect(formatDateKey(parsed!)).toBe('2026-04-02');
    expect(parsed?.getHours()).toBe(0);
    expect(parsed?.getMinutes()).toBe(0);
    expect(parsed?.getSeconds()).toBe(0);
    expect(parseDateFromConferenceText('invalid')).toBeNull();
  });

  it('formats date keys consistently', () => {
    expect(formatDateKey(new Date('2026-04-02T12:34:56.000Z'))).toBe('2026-04-02');
  });

  it('matches keywords across combined text values', () => {
    expect(hasAnyKeyword(['服用しづらい', null, '一包化を検討'], ['一包化', '嚥下'])).toBe(true);
    expect(hasAnyKeyword(['安定しています'], ['一包化', '嚥下'])).toBe(false);
  });

  it('normalizes a date to the start of the day', () => {
    const normalized = startOfDay(new Date('2026-04-02T12:34:56.000Z'));
    expect(formatDateKey(normalized)).toBe('2026-04-02');
    expect(normalized.getHours()).toBe(0);
    expect(normalized.getMinutes()).toBe(0);
    expect(normalized.getSeconds()).toBe(0);
  });
});
