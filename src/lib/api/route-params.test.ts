import { describe, expect, it } from 'vitest';
import { normalizeRequiredRouteParam } from './route-params';

describe('normalizeRequiredRouteParam', () => {
  it('trims non-empty route params', () => {
    expect(normalizeRequiredRouteParam('  file_1  ')).toBe('file_1');
  });

  it('returns null for blank route params', () => {
    expect(normalizeRequiredRouteParam('   ')).toBeNull();
  });

  it('treats tabs, newlines, and non-breaking spaces as route param padding', () => {
    expect(normalizeRequiredRouteParam('\t\n\r')).toBeNull();
    expect(normalizeRequiredRouteParam('\u00a0file_1\u00a0')).toBe('file_1');
  });
});
