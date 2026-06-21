import { describe, expect, it } from 'vitest';
import { familyNameOf } from './person-name';

describe('familyNameOf', () => {
  it('extracts the first token across half-width and full-width spaces', () => {
    expect(familyNameOf('田中 一郎')).toBe('田中');
    expect(familyNameOf('佐藤　花子')).toBe('佐藤');
    expect(familyNameOf('  山田 太郎  ')).toBe('山田');
  });

  it('keeps unsplit names and normalizes empty names', () => {
    expect(familyNameOf('山本')).toBe('山本');
    expect(familyNameOf('')).toBe('');
    expect(familyNameOf('　 ')).toBe('');
  });
});
