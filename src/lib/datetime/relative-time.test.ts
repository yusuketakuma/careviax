import { describe, expect, it } from 'vitest';

import { formatElapsedLabel } from './relative-time';

describe('formatElapsedLabel', () => {
  it('formats elapsed minutes with minute, hour, and day boundaries', () => {
    expect(formatElapsedLabel(-1)).toBe('0分');
    expect(formatElapsedLabel(0)).toBe('0分');
    expect(formatElapsedLabel(59)).toBe('59分');
    expect(formatElapsedLabel(60)).toBe('1時間');
    expect(formatElapsedLabel(1439)).toBe('23時間');
    expect(formatElapsedLabel(1440)).toBe('1日');
  });
});
