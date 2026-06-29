import { describe, expect, it } from 'vitest';
import {
  getNextSimpleRruleOccurrence,
  parseSimpleRruleDates,
  parseSimpleRruleDatesWithDiagnostics,
} from './rrule';

function utcIso(date: Date) {
  return date.toISOString();
}

function withTimezone(timezone: string, run: () => void) {
  const originalTimezone = process.env.TZ;
  process.env.TZ = timezone;
  try {
    run();
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
}

describe('parseSimpleRruleDates', () => {
  it('supports monthly rules with multiple ordinal weekdays', () => {
    const dates = parseSimpleRruleDates(
      'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TU,3TU',
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-30T23:59:59.999Z'),
    );

    expect(dates.map((date) => utcIso(date))).toEqual([
      '2026-04-07T00:00:00.000Z',
      '2026-04-21T00:00:00.000Z',
    ]);
  });

  it('keeps monthly occurrence construction on UTC @db.Date boundaries in Asia/Tokyo', () => {
    withTimezone('Asia/Tokyo', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TU,-1FR',
        new Date(Date.UTC(2026, 3, 1)),
        new Date(Date.UTC(2026, 3, 30)),
      );

      expect(dates.map((date) => utcIso(date))).toEqual([
        '2026-04-07T00:00:00.000Z',
        '2026-04-24T00:00:00.000Z',
      ]);
    });
  });

  it('iterates weekly rules by UTC weekday in Asia/Tokyo', () => {
    withTimezone('Asia/Tokyo', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        new Date(Date.UTC(2026, 6, 1)),
        new Date(Date.UTC(2026, 6, 8)),
      );

      expect(dates.map((date) => utcIso(date))).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-07-08T00:00:00.000Z',
      ]);
    });
  });

  it('iterates weekly rules by UTC weekday in negative-offset timezones', () => {
    withTimezone('America/Los_Angeles', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        new Date(Date.UTC(2026, 6, 1)),
        new Date(Date.UTC(2026, 6, 8)),
      );

      expect(dates.map((date) => utcIso(date))).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-07-08T00:00:00.000Z',
      ]);
    });
  });

  it('keeps biweekly multi-BYDAY visits on the same ISO-week phase', () => {
    const dates = parseSimpleRruleDates(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      new Date(Date.UTC(2026, 6, 1)),
      new Date(Date.UTC(2026, 6, 31)),
    );

    expect(dates.map((date) => utcIso(date))).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z',
      '2026-07-29T00:00:00.000Z',
    ]);
  });

  it('keeps windowed weekly regeneration anchored to the original series week', () => {
    const dates = parseSimpleRruleDates(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      new Date(Date.UTC(2026, 6, 8)),
      new Date(Date.UTC(2026, 6, 31)),
      { seriesAnchorDate: new Date(Date.UTC(2026, 6, 1)) },
    );

    expect(dates.map((date) => utcIso(date))).toEqual([
      '2026-07-13T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z',
      '2026-07-27T00:00:00.000Z',
      '2026-07-29T00:00:00.000Z',
    ]);
  });

  it('normalizes non-midnight weekly start dates to UTC @db.Date boundaries', () => {
    withTimezone('America/Los_Angeles', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
        new Date('2026-03-08T12:34:56.000Z'),
        new Date('2026-03-10T23:59:59.999Z'),
      );

      expect(dates.map((date) => utcIso(date))).toEqual(['2026-03-09T00:00:00.000Z']);
    });
  });

  it('returns UTC-midnight next occurrences across negative-offset DST boundaries', () => {
    withTimezone('America/Los_Angeles', () => {
      expect(
        utcIso(
          getNextSimpleRruleOccurrence(
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
            new Date('2026-03-08T00:00:00.000Z'),
          )!,
        ),
      ).toBe('2026-03-09T00:00:00.000Z');
      expect(
        utcIso(
          getNextSimpleRruleOccurrence(
            'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
            new Date('2026-11-01T00:00:00.000Z'),
          )!,
        ),
      ).toBe('2026-11-02T00:00:00.000Z');
    });
  });

  it('advances monthly cursors by UTC month for date-only ranges in Asia/Tokyo', () => {
    withTimezone('Asia/Tokyo', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=MONTHLY;INTERVAL=1;BYDAY=1WE',
        new Date(Date.UTC(2026, 2, 31)),
        new Date(Date.UTC(2026, 4, 1)),
      );

      expect(dates.map((date) => utcIso(date))).toEqual(['2026-04-01T00:00:00.000Z']);
    });
  });

  it('keeps first-Wednesday monthly occurrences that land on the start date in Asia/Tokyo', () => {
    withTimezone('Asia/Tokyo', () => {
      const dates = parseSimpleRruleDates(
        'FREQ=MONTHLY;INTERVAL=1;BYDAY=1WE',
        new Date(Date.UTC(2026, 6, 1)),
        new Date(Date.UTC(2026, 8, 30)),
      );

      expect(dates.map((date) => utcIso(date))).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-08-05T00:00:00.000Z',
        '2026-09-02T00:00:00.000Z',
      ]);
    });
  });

  it('keeps windowed monthly regeneration anchored to the original series month', () => {
    const dates = parseSimpleRruleDates(
      'FREQ=MONTHLY;INTERVAL=2;BYDAY=1WE',
      new Date(Date.UTC(2026, 4, 1)),
      new Date(Date.UTC(2026, 7, 31)),
      { seriesAnchorDate: new Date(Date.UTC(2026, 0, 1)) },
    );

    expect(dates.map((date) => utcIso(date))).toEqual([
      '2026-05-06T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ]);
  });

  it('reports invalid BYDAY tokens while the legacy wrapper keeps compatible valid dates', () => {
    const result = parseSimpleRruleDatesWithDiagnostics(
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,XX,WE',
      new Date(Date.UTC(2026, 2, 30)),
      new Date(Date.UTC(2026, 3, 1)),
    );

    expect(result.diagnostics.invalidBydayTokens).toEqual(['XX']);
    expect(result.dates.map((date) => utcIso(date))).toEqual([
      '2026-03-30T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ]);
    expect(
      parseSimpleRruleDates(
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,XX,WE',
        new Date(Date.UTC(2026, 2, 30)),
        new Date(Date.UTC(2026, 3, 1)),
      ).map((date) => utcIso(date)),
    ).toEqual(['2026-03-30T00:00:00.000Z', '2026-04-01T00:00:00.000Z']);
  });

  it('reports invalid monthly BYDAY tokens without dropping valid ordinal weekdays silently', () => {
    const result = parseSimpleRruleDatesWithDiagnostics(
      'FREQ=MONTHLY;INTERVAL=1;BYDAY=1WE,9XY,-1FR',
      new Date(Date.UTC(2026, 3, 1)),
      new Date(Date.UTC(2026, 3, 30)),
    );

    expect(result.diagnostics.invalidBydayTokens).toEqual(['9XY']);
    expect(result.dates.map((date) => utcIso(date))).toEqual([
      '2026-04-01T00:00:00.000Z',
      '2026-04-24T00:00:00.000Z',
    ]);
  });

  it('returns the next occurrence on the original biweekly phase', () => {
    expect(
      utcIso(
        getNextSimpleRruleOccurrence(
          'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
          new Date('2026-07-01T00:00:00.000Z'),
        )!,
      ),
    ).toBe('2026-07-15T00:00:00.000Z');
  });
});
