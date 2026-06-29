import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addUtcDays,
  japanDateKey,
  localDateKey,
  optionalUtcDateFromLocalKey,
  todayUtcRange,
  utcDateFromLocalKey,
} from './date-boundary';

const ORIGINAL_TZ = process.env.TZ;

describe('date-boundary (JST 前提)', () => {
  beforeAll(() => {
    // @db.Date 境界バグは JST(UTC+9)で顕在化するため、TZ を固定して検証する
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('localDateKey', () => {
    it('JST 朝 8 時はローカル日付キーを返す(2026-06-12T08:00+09:00 → 2026-06-12)', () => {
      expect(localDateKey(new Date('2026-06-12T08:00:00+09:00'))).toBe('2026-06-12');
    });

    it('JST 深夜 0:30(UTC では前日 15:30)でもローカル日付キーを返す', () => {
      // UTC では 2026-06-11T15:30Z だが、ローカル(JST)では 6/12
      expect(localDateKey(new Date('2026-06-12T00:30:00+09:00'))).toBe('2026-06-12');
    });

    it('引数省略時は現在時刻のローカル日付キーを返す', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      expect(localDateKey()).toBe('2026-06-12');
    });
  });

  describe('japanDateKey', () => {
    it('サーバーTZに依存せず JST 深夜直後の日本日付キーを返す', () => {
      // UTC では 2026-06-11 15:30 だが、日本国内業務日では 2026-06-12。
      expect(japanDateKey(new Date('2026-06-11T15:30:00.000Z'))).toBe('2026-06-12');
    });
  });

  describe('utcDateFromLocalKey', () => {
    it('日付キーを UTC 深夜の Date にする(2026-06-12 → 2026-06-12T00:00:00.000Z)', () => {
      expect(utcDateFromLocalKey('2026-06-12').toISOString()).toBe('2026-06-12T00:00:00.000Z');
    });

    it('ローカル深夜 setHours(0,0,0,0) とは一致しない(JST では前日 15:00Z になるため)', () => {
      const localMidnight = new Date('2026-06-12T08:00:00+09:00');
      localMidnight.setHours(0, 0, 0, 0);
      expect(localMidnight.toISOString()).toBe('2026-06-11T15:00:00.000Z');
      expect(utcDateFromLocalKey('2026-06-12').getTime()).not.toBe(localMidnight.getTime());
    });
  });

  describe('optionalUtcDateFromLocalKey', () => {
    it('preserves undefined and null for partial @db.Date updates', () => {
      expect(optionalUtcDateFromLocalKey(undefined)).toBeUndefined();
      expect(optionalUtcDateFromLocalKey(null)).toBeNull();
    });

    it('converts a date key to the same UTC midnight value as utcDateFromLocalKey', () => {
      expect(optionalUtcDateFromLocalKey('2026-06-12')?.toISOString()).toBe(
        '2026-06-12T00:00:00.000Z',
      );
    });
  });

  describe('addUtcDays', () => {
    it('UTC 深夜を保ったまま日数を加算する', () => {
      const base = utcDateFromLocalKey('2026-06-12');
      expect(addUtcDays(base, 1).toISOString()).toBe('2026-06-13T00:00:00.000Z');
      expect(addUtcDays(base, 7).toISOString()).toBe('2026-06-19T00:00:00.000Z');
      expect(addUtcDays(base, -1).toISOString()).toBe('2026-06-11T00:00:00.000Z');
    });

    it('月末・月初をまたいでも正しい', () => {
      expect(addUtcDays(utcDateFromLocalKey('2026-06-30'), 1).toISOString()).toBe(
        '2026-07-01T00:00:00.000Z',
      );
    });
  });

  describe('todayUtcRange', () => {
    it('JST 朝 8 時の「今日」は当日 UTC 深夜〜翌日 UTC 深夜のレンジになる', () => {
      const range = todayUtcRange(new Date('2026-06-12T08:00:00+09:00'));
      expect(range.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(range.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    });

    it('JST 深夜 0:30(UTC では前日)でもローカル日付のレンジになる', () => {
      const range = todayUtcRange(new Date('2026-06-12T00:30:00+09:00'));
      expect(range.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(range.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    });

    it('UTC 深夜で保存された当日の @db.Date 値がレンジに入る(取りこぼさない)', () => {
      const range = todayUtcRange(new Date('2026-06-12T08:00:00+09:00'));
      const storedToday = new Date('2026-06-12T00:00:00.000Z');
      const storedYesterday = new Date('2026-06-11T00:00:00.000Z');
      const storedTomorrow = new Date('2026-06-13T00:00:00.000Z');
      expect(storedToday >= range.gte && storedToday < range.lt).toBe(true);
      expect(storedYesterday >= range.gte).toBe(false);
      expect(storedTomorrow < range.lt).toBe(false);
    });

    it('引数省略時は現在時刻を基準にする', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T23:30:00+09:00'));
      const range = todayUtcRange();
      expect(range.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(range.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    });
  });
});
