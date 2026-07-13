import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
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
  addJapanCalendarDays,
  addJapanCalendarYears,
  formatDateKey,
  hasAnyKeyword,
  parseConferenceSections,
  parseDateFromConferenceText,
  startOfDay,
  startOfRuntimeDay,
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

  it('parses conference dates into stable UTC date sentinels', () => {
    const parsed = parseDateFromConferenceText('2026-04-02');
    expect(parsed?.toISOString()).toBe('2026-04-02T00:00:00.000Z');
    expect(parseDateFromConferenceText('2026-02-30')).toBeNull();
    expect(parseDateFromConferenceText('invalid')).toBeNull();
  });

  it('formats date keys consistently', () => {
    expect(formatDateKey(new Date('2026-04-02T12:34:56.000Z'))).toBe('2026-04-02');
  });

  it('matches keywords across combined text values', () => {
    expect(hasAnyKeyword(['服用しづらい', null, '一包化を検討'], ['一包化', '嚥下'])).toBe(true);
    expect(hasAnyKeyword(['安定しています'], ['一包化', '嚥下'])).toBe(false);
  });

  it('normalizes an instant to the Japan business-date sentinel', () => {
    expect(startOfDay(new Date('2026-04-01T14:59:59.999Z')).toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
    expect(startOfDay(new Date('2026-04-01T15:00:00.000Z')).toISOString()).toBe(
      '2026-04-02T00:00:00.000Z',
    );
  });

  it('adds Japan calendar days and years without using the runtime timezone', () => {
    const lateUtcInstant = new Date('2026-04-01T16:30:00.000Z');
    expect(addJapanCalendarDays(lateUtcInstant, 1).toISOString()).toBe('2026-04-03T00:00:00.000Z');
    expect(addJapanCalendarYears(new Date('2024-02-29T00:00:00.000Z'), 1).toISOString()).toBe(
      '2025-02-28T00:00:00.000Z',
    );
  });

  it('keeps the explicitly runtime-local SLA boundary available', () => {
    const normalized = startOfRuntimeDay(new Date('2026-04-02T12:34:56.000Z'));
    expect(normalized.getHours()).toBe(0);
    expect(normalized.getMinutes()).toBe(0);
    expect(normalized.getSeconds()).toBe(0);
  });
});
