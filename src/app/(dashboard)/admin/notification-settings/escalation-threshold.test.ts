import { describe, expect, it } from 'vitest';

import { parseEscalationThresholdHoursInput } from './escalation-threshold';

describe('parseEscalationThresholdHoursInput', () => {
  it.each([
    ['1', 1],
    ['24', 24],
    [' 720 ', 720],
  ])('parses canonical integer input %s', (input, expected) => {
    expect(parseEscalationThresholdHoursInput(input)).toBe(expected);
  });

  it.each(['', ' ', '1e2', '10.0', '10abc', '-1', '0', '721'])(
    'rejects malformed or out-of-range input %s',
    (input) => {
      expect(parseEscalationThresholdHoursInput(input)).toBeNull();
    },
  );
});
