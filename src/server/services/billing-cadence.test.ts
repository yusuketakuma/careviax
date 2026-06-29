import { describe, expect, it } from 'vitest';
import {
  buildBillingMonthKey,
  buildBillingWeekKey,
  endOfBillingMonth,
  endOfBillingWeek,
  startOfBillingDay,
  startOfBillingMonth,
  startOfBillingWeek,
} from './billing-cadence';

describe('billing-cadence', () => {
  it('uses Japan business dates even when the timestamp is still previous-day UTC', () => {
    const jstJustAfterMidnight = new Date('2026-06-30T15:30:00.000Z');

    expect(startOfBillingDay(jstJustAfterMidnight).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(startOfBillingMonth(jstJustAfterMidnight).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(endOfBillingMonth(jstJustAfterMidnight).toISOString()).toBe('2026-07-31T23:59:59.999Z');
    expect(buildBillingMonthKey(jstJustAfterMidnight)).toBe('2026-07-01');
  });

  it('builds Sunday-to-Saturday billing weeks from Japan business dates', () => {
    const sunday = new Date('2026-04-12T00:00:00.000Z');
    const saturday = new Date('2026-04-18T00:00:00.000Z');
    const nextSunday = new Date('2026-04-19T00:00:00.000Z');

    expect(startOfBillingWeek(sunday).toISOString()).toBe('2026-04-12T00:00:00.000Z');
    expect(endOfBillingWeek(saturday).toISOString()).toBe('2026-04-18T23:59:59.999Z');
    expect(buildBillingWeekKey(sunday)).toBe('2026-04-12');
    expect(buildBillingWeekKey(saturday)).toBe('2026-04-12');
    expect(buildBillingWeekKey(nextSunday)).toBe('2026-04-19');
  });
});
