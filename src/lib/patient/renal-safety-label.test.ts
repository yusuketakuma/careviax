import { afterEach, describe, expect, it } from 'vitest';
import { formatRenalObservationDate, formatRenalSafetyLabel } from './renal-safety-label';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe('formatRenalObservationDate', () => {
  it('formats a mid-day JST instant using the safer 和式 date label (no bare M/d)', () => {
    expect(formatRenalObservationDate(new Date('2026-06-01T04:00:00.000Z'))).toBe('2026年6月1日');
  });

  it('does not roll the date back a day when the server runtime timezone is UTC', () => {
    process.env.TZ = 'UTC';
    // 2026-06-30T15:30:00.000Z is 2026-07-01T00:30 JST — just after the JST
    // midnight boundary. date-fns `format()` under TZ=UTC would render this as
    // 6/30 (previous day). The shared formatter must resolve the Asia/Tokyo
    // calendar date (7/1) regardless of process.env.TZ.
    expect(formatRenalObservationDate(new Date('2026-06-30T15:30:00.000Z'))).toBe('2026年7月1日');
  });

  it('does not roll the date forward a day when the server runtime timezone is behind JST', () => {
    process.env.TZ = 'America/Los_Angeles';
    // 2026-06-01T09:00:00.000Z is 2026-06-01T18:00 JST but 2026-06-01T02:00
    // America/Los_Angeles — still the same JST calendar date either way, so
    // this pins the JST-anchored result independent of a westward TZ.
    expect(formatRenalObservationDate(new Date('2026-06-01T09:00:00.000Z'))).toBe('2026年6月1日');
  });
});

describe('formatRenalSafetyLabel', () => {
  it('builds the shared eGFR safety label', () => {
    expect(formatRenalSafetyLabel(38, new Date('2026-06-01T04:00:00.000Z'))).toBe(
      'eGFR 38(2026年6月1日)',
    );
  });

  it('accepts a text lab value', () => {
    expect(formatRenalSafetyLabel('測定不能', new Date('2026-06-01T04:00:00.000Z'))).toBe(
      'eGFR 測定不能(2026年6月1日)',
    );
  });
});
