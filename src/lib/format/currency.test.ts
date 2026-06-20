import { describe, expect, it } from 'vitest';
import { formatYen, YEN_PLACEHOLDER } from './currency';

describe('formatYen', () => {
  it('formats Japanese yen amounts with grouping', () => {
    expect(formatYen(1234)).toBe('1,234円');
    expect(formatYen(0)).toBe('0円');
  });

  it('uses the default or caller-provided fallback for missing values', () => {
    expect(formatYen(null)).toBe(YEN_PLACEHOLDER);
    expect(formatYen(undefined, '未記録')).toBe('未記録');
  });
});
