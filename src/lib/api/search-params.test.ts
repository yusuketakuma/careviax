import { describe, expect, it } from 'vitest';

import {
  parseExactIntegerSearchParam,
  readSingleSearchParam,
  readStrictOptionalSearchParam,
} from './search-params';

describe('readSingleSearchParam', () => {
  it('distinguishes missing, empty, single, and duplicate query params', () => {
    expect(readSingleSearchParam(new URLSearchParams(''), 'q')).toEqual({
      ok: true,
      value: null,
    });
    expect(readSingleSearchParam(new URLSearchParams('q='), 'q')).toEqual({
      ok: true,
      value: '',
    });
    expect(readSingleSearchParam(new URLSearchParams('q=%20田中'), 'q')).toEqual({
      ok: true,
      value: ' 田中',
    });
    expect(readSingleSearchParam(new URLSearchParams('q=田中&q=佐藤'), 'q')).toEqual({
      ok: false,
      message: 'q は1つだけ指定してください',
    });
  });
});

describe('parseExactIntegerSearchParam', () => {
  it('parses exact integer params without trimming padded values', () => {
    const missing = new URLSearchParams('');
    expect(parseExactIntegerSearchParam(missing, 'limit', 1, 50)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseExactIntegerSearchParam(missing, 'within_days', 0, 365, 7)).toEqual({
      ok: true,
      value: 7,
    });
    expect(parseExactIntegerSearchParam(new URLSearchParams('limit=8'), 'limit', 1, 50)).toEqual({
      ok: true,
      value: 8,
    });
    expect(
      parseExactIntegerSearchParam(new URLSearchParams('limit=%208%20'), 'limit', 1, 50),
    ).toEqual({
      ok: false,
      message: 'limit は整数で指定してください',
    });
  });

  it('rejects malformed, duplicate, unsafe, and out-of-range values with field messages', () => {
    expect(
      parseExactIntegerSearchParam(new URLSearchParams('limit=8&limit=9'), 'limit', 1, 50),
    ).toEqual({
      ok: false,
      message: 'limit は1つだけ指定してください',
    });
    expect(parseExactIntegerSearchParam(new URLSearchParams('limit='), 'limit', 1, 50)).toEqual({
      ok: false,
      message: 'limit は整数で指定してください',
    });
    expect(parseExactIntegerSearchParam(new URLSearchParams('limit=1e2'), 'limit', 1, 50)).toEqual({
      ok: false,
      message: 'limit は整数で指定してください',
    });
    expect(parseExactIntegerSearchParam(new URLSearchParams('limit=0'), 'limit', 1, 50)).toEqual({
      ok: false,
      message: 'limit は1以上50以下で指定してください',
    });
    expect(parseExactIntegerSearchParam(new URLSearchParams('limit=51'), 'limit', 1, 50)).toEqual({
      ok: false,
      message: 'limit は1以上50以下で指定してください',
    });
    expect(
      parseExactIntegerSearchParam(
        new URLSearchParams('limit=9007199254740992'),
        'limit',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual({
      ok: false,
      message: `limit は1以上${Number.MAX_SAFE_INTEGER}以下で指定してください`,
    });
  });
});

describe('readStrictOptionalSearchParam', () => {
  const messages = {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  };

  it('reads missing and valid strict optional params without trimming values', () => {
    expect(readStrictOptionalSearchParam(new URLSearchParams(''), 'patient_id', messages)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      readStrictOptionalSearchParam(
        new URLSearchParams('patient_id=patient_1'),
        'patient_id',
        messages,
      ),
    ).toEqual({
      ok: true,
      value: 'patient_1',
    });
  });

  it('rejects duplicate, blank, padded, and too-long values with field errors', () => {
    expect(
      readStrictOptionalSearchParam(
        new URLSearchParams('patient_id=patient_1&patient_id=patient_2'),
        'patient_id',
        messages,
      ),
    ).toEqual({
      ok: false,
      fieldErrors: { patient_id: ['patient_id は1つだけ指定してください'] },
    });
    expect(
      readStrictOptionalSearchParam(new URLSearchParams('patient_id='), 'patient_id', messages),
    ).toEqual({
      ok: false,
      fieldErrors: { patient_id: ['患者IDを指定してください'] },
    });
    expect(
      readStrictOptionalSearchParam(
        new URLSearchParams('patient_id=%20patient_1'),
        'patient_id',
        messages,
      ),
    ).toEqual({
      ok: false,
      fieldErrors: { patient_id: ['患者IDの形式が不正です'] },
    });
    expect(
      readStrictOptionalSearchParam(
        new URLSearchParams('patient_id=patient_123'),
        'patient_id',
        messages,
        { maxLength: 10 },
      ),
    ).toEqual({
      ok: false,
      fieldErrors: { patient_id: ['患者IDの形式が不正です'] },
    });
  });
});
