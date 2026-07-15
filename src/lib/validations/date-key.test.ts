import { afterEach, describe, expect, it } from 'vitest';
import { isValidDateKey, parseSourceDate } from './date-key';

function expectValid(value: string, policy: Parameters<typeof parseSourceDate>[1], iso: string) {
  const parsed = parseSourceDate(value, policy);
  expect(parsed).toMatchObject({ status: 'valid' });
  if (parsed.status === 'valid') expect(parsed.date.toISOString()).toBe(iso);
}

describe('parseSourceDate', () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it.each([
    ['20000229', '2000-02-29T00:00:00.000Z'],
    ['20240229', '2024-02-29T00:00:00.000Z'],
  ])('accepts Gregorian leap date %s', (value, expected) => {
    expectValid(value, 'ssk', expected);
  });

  it.each(['19000229', '21000229', '20260230', '20260431', '20260001', '20261301'])(
    'rejects rollover calendar date %s',
    (value) => {
      expect(parseSourceDate(value, 'ssk')).toEqual({
        status: 'invalid',
        reason: 'invalid_calendar_date',
      });
    },
  );

  it('keeps documented SSK sentinels nullable and rejects other formats', () => {
    expect(parseSourceDate(null, 'ssk')).toEqual({ status: 'missing' });
    expect(parseSourceDate('0', 'ssk')).toEqual({ status: 'missing' });
    expect(parseSourceDate('99999999', 'ssk')).toEqual({ status: 'missing' });
    expect(parseSourceDate('2026/04/01', 'ssk')).toEqual({
      status: 'invalid',
      reason: 'invalid_format',
    });
  });

  it('accepts explicit MHLW/PMDA Gregorian and Japanese-era formats', () => {
    expectValid('2026/04/01', 'mhlw_pmda', '2026-04-01T00:00:00.000Z');
    expectValid('2026-4-1', 'mhlw_pmda', '2026-04-01T00:00:00.000Z');
    expectValid('R1.5.1', 'mhlw_pmda', '2019-05-01T00:00:00.000Z');
    expectValid('令和1年5月1日改訂', 'mhlw_pmda', '2019-05-01T00:00:00.000Z');
    expectValid('令和元年5月1日改訂', 'mhlw_pmda', '2019-05-01T00:00:00.000Z');
    expect(parseSourceDate('令和元年4月30日', 'mhlw_pmda')).toEqual({
      status: 'invalid',
      reason: 'invalid_era_boundary',
    });
    // Bare YY.M.D is intentionally ambiguous and must not imply Reiwa.
    expect(parseSourceDate('1.5.1', 'mhlw_pmda')).toEqual({
      status: 'invalid',
      reason: 'invalid_format',
    });
  });

  it.each([
    ['M010907', 'invalid_era_boundary'],
    ['M010908', null],
    ['S011224', 'invalid_era_boundary'],
    ['S011225', null],
    ['S640107', null],
    ['S640108', 'invalid_era_boundary'],
    ['H010107', 'invalid_era_boundary'],
    ['H010108', null],
    ['R010430', 'invalid_era_boundary'],
    ['R010501', null],
    ['T010101', 'invalid_era_boundary'],
    ['T010730', null],
    ['H000108', 'invalid_era_boundary'],
  ] as const)('enforces the actual Japanese-era boundary for %s', (value, reason) => {
    const parsed = parseSourceDate(value, 'jahis');
    if (reason === null) expect(parsed.status).toBe('valid');
    else expect(parsed).toEqual({ status: 'invalid', reason });
  });

  it('accepts only official fixed JAHIS date formats', () => {
    expectValid('20260401', 'jahis', '2026-04-01T00:00:00.000Z');
    expectValid('S330303', 'jahis', '1958-03-03T00:00:00.000Z');
    for (const value of ['2026/04/01', ' 20260401', 'r010501', '20260401 ']) {
      expect(parseSourceDate(value, 'jahis')).toEqual({
        status: 'invalid',
        reason: 'invalid_format',
      });
    }
  });

  it('applies calendar validity and era boundaries without an inconsistent product-year cap', () => {
    expectValid('18991231', 'jahis', '1899-12-31T00:00:00.000Z');
    expectValid('M321231', 'jahis', '1899-12-31T00:00:00.000Z');
    expectValid('21170101', 'jahis', '2117-01-01T00:00:00.000Z');
    expectValid('R990101', 'jahis', '2117-01-01T00:00:00.000Z');
  });

  it('treats non-date era mentions as missing but validates complete text candidates', () => {
    expect(parseSourceDate('令和8年度の薬価改定資料', 'japanese_era_text')).toEqual({
      status: 'missing',
    });
    expectValid('適用日：令和元年5月1日', 'japanese_era_text', '2019-05-01T00:00:00.000Z');
    expect(parseSourceDate('適用日：令和元年4月30日', 'japanese_era_text')).toEqual({
      status: 'invalid',
      reason: 'invalid_era_boundary',
    });
  });

  it('returns the same UTC instant in Tokyo and New York process timezones', () => {
    for (const timezone of ['Asia/Tokyo', 'America/New_York']) {
      process.env.TZ = timezone;
      expectValid('20260228', 'import_source_token', '2026-02-28T00:00:00.000Z');
    }
  });
});

describe('isValidDateKey', () => {
  it('uses strict UTC calendar round-tripping', () => {
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('0000-01-01')).toBe(false);
  });
});
