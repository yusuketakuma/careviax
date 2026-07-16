import toSJIS from 'qrcode/helper/to-sjis';

export const JAHIS_SHIFT_JIS_REPLACEMENT_CODE = 0x81a1;

export type JahisShiftJisMapper = (character: string) => number | undefined;

function appendDoubleByte(bytes: number[], code: number) {
  if (!Number.isInteger(code) || code < 0x8140 || code > 0xeafc) {
    throw new RangeError('JAHIS_SHIFT_JIS_UNREPRESENTABLE');
  }

  bytes.push((code >> 8) & 0xff, code & 0xff);
}

/**
 * Encodes the exact byte stream supplied to a JAHIS QR symbol.
 * Unsupported characters fail closed instead of being replaced or UTF-8 encoded.
 */
export function encodeJahisShiftJis(
  value: string,
  mapper: JahisShiftJisMapper = toSJIS,
): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    if (codePoint >= 0xff61 && codePoint <= 0xff9f) {
      bytes.push(codePoint - 0xff61 + 0xa1);
      continue;
    }

    const shiftJisCode = mapper(character);
    if (shiftJisCode === undefined || shiftJisCode === JAHIS_SHIFT_JIS_REPLACEMENT_CODE) {
      throw new RangeError('JAHIS_SHIFT_JIS_UNREPRESENTABLE');
    }
    appendDoubleByte(bytes, shiftJisCode);
  }

  return Uint8Array.from(bytes);
}

export function assertJahisShiftJisByteLimit(
  value: string,
  maxBytes: number,
  mapper?: JahisShiftJisMapper,
): void {
  if (encodeJahisShiftJis(value, mapper).byteLength > maxBytes) {
    throw new RangeError('JAHIS_FIELD_BYTE_LIMIT_EXCEEDED');
  }
}
