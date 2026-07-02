import { describe, expect, it } from 'vitest';
import { trimStringOrUndefined } from './string';

describe('trimStringOrUndefined', () => {
  it('normalizes nullish and blank strings to undefined', () => {
    expect(trimStringOrUndefined(null)).toBeUndefined();
    expect(trimStringOrUndefined(undefined)).toBeUndefined();
    expect(trimStringOrUndefined('')).toBeUndefined();
    expect(trimStringOrUndefined('   \n\t  ')).toBeUndefined();
  });

  it('trims non-blank strings', () => {
    expect(trimStringOrUndefined('  patient_1  ')).toBe('patient_1');
  });

  it('passes non-string values through for the downstream schema to validate', () => {
    const value = { id: 'patient_1' };

    expect(trimStringOrUndefined(123)).toBe(123);
    expect(trimStringOrUndefined(false)).toBe(false);
    expect(trimStringOrUndefined(value)).toBe(value);
  });
});
