import { describe, expect, it, vi } from 'vitest';
import {
  assertJahisShiftJisByteLimit,
  encodeJahisShiftJis,
  JAHIS_SHIFT_JIS_REPLACEMENT_CODE,
} from './jahis-shift-jis';

describe('encodeJahisShiftJis', () => {
  it('encodes ASCII, halfwidth kana, and JIS double-byte characters into one byte stream', () => {
    const mapper = vi.fn((character: string) => (character === '漢' ? 0x8abf : undefined));

    expect([...encodeJahisShiftJis('A,ｱ漢\r\n', mapper)]).toEqual([
      0x41, 0x2c, 0xb1, 0x8a, 0xbf, 0x0d, 0x0a,
    ]);
  });

  it.each(['😀', '髙'])('rejects an unrepresentable character without replacement: %s', (value) => {
    expect(() => encodeJahisShiftJis(value, () => undefined)).toThrow(
      'JAHIS_SHIFT_JIS_UNREPRESENTABLE',
    );
  });

  it('rejects the reserved external-character replacement square', () => {
    expect(() => encodeJahisShiftJis('■', () => JAHIS_SHIFT_JIS_REPLACEMENT_CODE)).toThrow(
      'JAHIS_SHIFT_JIS_UNREPRESENTABLE',
    );
  });

  it('measures field limits in Shift-JIS bytes rather than JavaScript characters', () => {
    const mapper = vi.fn(() => 0x8abf);

    expect(() => assertJahisShiftJisByteLimit('漢'.repeat(20), 40, mapper)).not.toThrow();
    expect(() => assertJahisShiftJisByteLimit(`${'漢'.repeat(20)}A`, 40, mapper)).toThrow(
      'JAHIS_FIELD_BYTE_LIMIT_EXCEEDED',
    );
  });
});
