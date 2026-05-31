import { describe, expect, it } from 'vitest';
import {
  normalizeRecentOperations,
  parseRecentOperationsStorage,
  prependRecentOperation,
} from './recent-operations';

describe('recent operations helpers', () => {
  it('returns an empty list for malformed localStorage payloads', () => {
    expect(parseRecentOperationsStorage(null)).toEqual([]);
    expect(parseRecentOperationsStorage('{bad-json')).toEqual([]);
    expect(parseRecentOperationsStorage(JSON.stringify({ href: '/patients' }))).toEqual([]);
  });

  it('drops malformed entries before rendering recent operation history', () => {
    expect(
      normalizeRecentOperations([
        { href: '/patients', label: '患者', visitedAt: '2026-05-31T00:00:00.000Z' },
        { href: 'https://example.test', label: '外部', visitedAt: '2026-05-31T00:00:00.000Z' },
        { href: '/settings', label: '', visitedAt: '2026-05-31T00:00:00.000Z' },
        { href: '/bad-date', label: '不正日時', visitedAt: 'not-a-date' },
        ['not', 'an', 'object'],
      ]),
    ).toEqual([{ href: '/patients', label: '患者', visitedAt: '2026-05-31T00:00:00.000Z' }]);
  });

  it('prepends the current operation, deduplicates by href, and caps history', () => {
    const existing = Array.from({ length: 9 }, (_, index) => ({
      href: `/patients/${index}`,
      label: `患者 ${index}`,
      visitedAt: '2026-05-31T00:00:00.000Z',
    }));

    expect(
      prependRecentOperation(existing, '/patients/3', new Date('2026-05-31T12:00:00.000Z')),
    ).toEqual([
      { href: '/patients/3', label: '患者', visitedAt: '2026-05-31T12:00:00.000Z' },
      ...existing.filter((item) => item.href !== '/patients/3').slice(0, 7),
    ]);
  });
});
