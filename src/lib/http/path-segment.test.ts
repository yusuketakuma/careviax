import { describe, expect, it } from 'vitest';
import { encodePathSegment } from './path-segment';

describe('encodePathSegment', () => {
  it('通常の id はそのまま round-trip する', () => {
    expect(encodePathSegment('patient_1')).toBe('patient_1');
    expect(encodePathSegment('abc-123')).toBe('abc-123');
  });

  it('slash / query / hash を含む hostile id を単一セグメントに encode する', () => {
    expect(encodePathSegment('pt/1?x=y#z')).toBe(encodeURIComponent('pt/1?x=y#z'));
    const out = encodePathSegment('pt/1?x=y#z');
    expect(out).not.toContain('/');
    expect(out).not.toContain('?x=y');
    expect(out).not.toContain('#z');
  });

  it("exact '.' / '..' は RangeError で fail-fast する", () => {
    expect(() => encodePathSegment('.')).toThrow(RangeError);
    expect(() => encodePathSegment('..')).toThrow(RangeError);
  });

  it("'.' を含むが exact dot ではない id は許容する", () => {
    expect(encodePathSegment('..foo')).toBe('..foo');
    expect(encodePathSegment('a.b')).toBe('a.b');
  });

  it('既に encode 風の id を渡しても二重 encode せず raw として扱う', () => {
    // 呼び出し側が raw を渡す前提: 'a%2Fb' の '%' は1回だけ encode され %252F になる。
    expect(encodePathSegment('a%2Fb')).toBe('a%252Fb');
    expect(encodePathSegment('a%2Fb').match(/%252F/g)).toHaveLength(1);
  });
});
