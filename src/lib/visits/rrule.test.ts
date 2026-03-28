import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { parseSimpleRruleDates } from './rrule';

describe('parseSimpleRruleDates', () => {
  it('supports monthly rules with multiple ordinal weekdays', () => {
    const dates = parseSimpleRruleDates(
      'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TU,3TU',
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-30T23:59:59.999Z')
    );

    expect(dates.map((date) => format(date, 'yyyy-MM-dd'))).toEqual([
      '2026-04-07',
      '2026-04-21',
    ]);
  });
});
