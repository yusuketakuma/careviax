import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_CACHE_TTL_HOURS,
  OFFLINE_CACHE_TTL_MS,
  formatOfflineCacheUpdatedAt,
  isOfflineCacheFresh,
} from './cache-policy';

const FIXED_NOW = new Date('2026-05-04T12:00:00.000Z');

describe('cache-policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('OFFLINE_CACHE_TTL_MS', () => {
    it('is consistent with the hour-based constant', () => {
      expect(OFFLINE_CACHE_TTL_MS).toBe(OFFLINE_CACHE_TTL_HOURS * 60 * 60 * 1000);
    });
  });

  describe('isOfflineCacheFresh', () => {
    it('returns false for null', () => {
      expect(isOfflineCacheFresh(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isOfflineCacheFresh(undefined)).toBe(false);
    });

    it('returns false for an unparseable date string', () => {
      expect(isOfflineCacheFresh('not-a-date')).toBe(false);
    });

    it('returns true when updatedAt is exactly at the TTL boundary', () => {
      const boundary = new Date(FIXED_NOW.getTime() - OFFLINE_CACHE_TTL_MS);
      expect(isOfflineCacheFresh(boundary)).toBe(true);
    });

    it('returns false when updatedAt is one millisecond past the TTL boundary', () => {
      const expired = new Date(FIXED_NOW.getTime() - OFFLINE_CACHE_TTL_MS - 1);
      expect(isOfflineCacheFresh(expired)).toBe(false);
    });

    it('accepts ISO string input', () => {
      const recent = new Date(FIXED_NOW.getTime() - 60_000).toISOString();
      expect(isOfflineCacheFresh(recent)).toBe(true);
    });

    it('respects a custom ttl', () => {
      const updatedAt = new Date(FIXED_NOW.getTime() - 5_000);
      expect(isOfflineCacheFresh(updatedAt, 1_000)).toBe(false);
      expect(isOfflineCacheFresh(updatedAt, 10_000)).toBe(true);
    });
  });

  describe('formatOfflineCacheUpdatedAt', () => {
    it('returns null for null', () => {
      expect(formatOfflineCacheUpdatedAt(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(formatOfflineCacheUpdatedAt(undefined)).toBeNull();
    });

    it('returns null for an invalid date string', () => {
      expect(formatOfflineCacheUpdatedAt('garbage')).toBeNull();
    });

    it('formats Date instances as ISO strings', () => {
      expect(formatOfflineCacheUpdatedAt(new Date('2026-01-15T08:30:00.000Z'))).toBe(
        '2026-01-15T08:30:00.000Z',
      );
    });

    it('round-trips ISO string input', () => {
      const iso = '2026-02-01T00:00:00.000Z';
      expect(formatOfflineCacheUpdatedAt(iso)).toBe(iso);
    });
  });
});
