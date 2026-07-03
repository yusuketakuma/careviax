import { describe, expect, it } from 'vitest';

import { formatFileSize } from './format-file-size';

describe('formatFileSize', () => {
  it.each([
    [0, '0B'],
    [512, '512B'],
    [1023, '1023B'],
    [1024, '1KB'],
    [1536, '2KB'],
    [1024 * 1024, '1.0MB'],
    [1536 * 1024, '1.5MB'],
  ])('formats %i bytes as %s', (sizeBytes, expected) => {
    expect(formatFileSize(sizeBytes)).toBe(expected);
  });
});
