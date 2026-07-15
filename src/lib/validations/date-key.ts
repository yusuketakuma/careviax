import { z } from 'zod';

export const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const sourceDateInvalidReasons = [
  'invalid_format',
  'invalid_calendar_date',
  'invalid_era_boundary',
] as const;

export type SourceDateInvalidReason = (typeof sourceDateInvalidReasons)[number];
export type SourceDatePolicy =
  | 'import_source_token'
  | 'ssk'
  | 'mhlw_pmda'
  | 'jahis'
  | 'japanese_era_text';
export type SourceDateFormat =
  | 'yyyyMMdd'
  | 'yyMMdd'
  | 'delimited_gregorian'
  | 'japanese_era_symbol'
  | 'japanese_era_text';

export type SourceDateParseResult =
  | { status: 'missing' }
  | {
      status: 'valid';
      date: Date;
      dateKey: string;
      format: SourceDateFormat;
    }
  | { status: 'invalid'; reason: SourceDateInvalidReason };

type JapaneseEra = {
  symbol: 'M' | 'T' | 'S' | 'H' | 'R';
  name: '明治' | '大正' | '昭和' | '平成' | '令和';
  yearOffset: number;
  startsOn: string;
  endsOn: string | null;
};

const JAPANESE_ERAS: readonly JapaneseEra[] = [
  // JAHIS/HL7 medical date conversion convention. In particular, Meiji 1 starts
  // at 1868-09-08 for this domain conversion table rather than converting the
  // historical lunisolar date to its Gregorian equivalent.
  {
    symbol: 'M',
    name: '明治',
    yearOffset: 1867,
    startsOn: '1868-09-08',
    endsOn: '1912-07-29',
  },
  {
    symbol: 'T',
    name: '大正',
    yearOffset: 1911,
    startsOn: '1912-07-30',
    endsOn: '1926-12-24',
  },
  {
    symbol: 'S',
    name: '昭和',
    yearOffset: 1925,
    startsOn: '1926-12-25',
    endsOn: '1989-01-07',
  },
  {
    symbol: 'H',
    name: '平成',
    yearOffset: 1988,
    startsOn: '1989-01-08',
    endsOn: '2019-04-30',
  },
  {
    symbol: 'R',
    name: '令和',
    yearOffset: 2018,
    startsOn: '2019-05-01',
    endsOn: null,
  },
];

function normalizeJapaneseDateDigits(value: string) {
  return value.replace(/[０-９]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

function parseJapaneseEraYear(value: string) {
  return value === '元' ? 1 : Number(value);
}

function formatDateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function createUtcDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseGregorianDate(
  year: number,
  month: number,
  day: number,
  format: SourceDateFormat,
  options: { minYear?: number; maxYear?: number } = {},
): SourceDateParseResult {
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    year < (options.minYear ?? 1) ||
    year > (options.maxYear ?? 9999) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return { status: 'invalid', reason: 'invalid_calendar_date' };
  }

  const date = createUtcDate(year, month, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { status: 'invalid', reason: 'invalid_calendar_date' };
  }

  return { status: 'valid', date, dateKey: formatDateKey(year, month, day), format };
}

function parseJapaneseEraDate(
  era: JapaneseEra | undefined,
  eraYear: number,
  month: number,
  day: number,
  format: 'japanese_era_symbol' | 'japanese_era_text',
): SourceDateParseResult {
  if (!era || !Number.isSafeInteger(eraYear) || eraYear < 1) {
    return { status: 'invalid', reason: 'invalid_era_boundary' };
  }

  const parsed = parseGregorianDate(era.yearOffset + eraYear, month, day, format);
  if (parsed.status !== 'valid') return parsed;
  if (parsed.dateKey < era.startsOn || (era.endsOn !== null && parsed.dateKey > era.endsOn)) {
    return { status: 'invalid', reason: 'invalid_era_boundary' };
  }
  return parsed;
}

function parseCompactGregorian(
  value: string,
  options: { allowShortYear: boolean; minYear?: number; maxYear?: number },
): SourceDateParseResult {
  if (/^\d{8}$/.test(value)) {
    return parseGregorianDate(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)),
      Number(value.slice(6, 8)),
      'yyyyMMdd',
      options,
    );
  }
  if (options.allowShortYear && /^\d{6}$/.test(value)) {
    return parseGregorianDate(
      2000 + Number(value.slice(0, 2)),
      Number(value.slice(2, 4)),
      Number(value.slice(4, 6)),
      'yyMMdd',
      options,
    );
  }
  return { status: 'invalid', reason: 'invalid_format' };
}

export function parseSourceDate(
  value: string | null | undefined,
  policy: SourceDatePolicy,
): SourceDateParseResult {
  if (value == null || value === '') return { status: 'missing' };

  if (policy === 'ssk') {
    if (value === '0' || value === '99999999') return { status: 'missing' };
    return parseCompactGregorian(value, { allowShortYear: false });
  }

  if (policy === 'import_source_token') {
    return parseCompactGregorian(value, { allowShortYear: true });
  }

  if (policy === 'jahis') {
    if (/^\d{8}$/.test(value)) {
      return parseCompactGregorian(value, { allowShortYear: false });
    }
    const eraMatch = /^([MTSHR])(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (!eraMatch) return { status: 'invalid', reason: 'invalid_format' };
    return parseJapaneseEraDate(
      JAPANESE_ERAS.find((era) => era.symbol === eraMatch[1]),
      Number(eraMatch[2]),
      Number(eraMatch[3]),
      Number(eraMatch[4]),
      'japanese_era_symbol',
    );
  }

  const normalized = normalizeJapaneseDateDigits(value).trim();
  const eraTextPattern = /(明治|大正|昭和|平成|令和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/;

  if (policy === 'japanese_era_text') {
    const match = eraTextPattern.exec(normalized);
    // An HTML page can mention an era or fiscal year without publishing a full
    // applicable date. Only a complete date candidate is authoritative here.
    if (!match) return { status: 'missing' };
    return parseJapaneseEraDate(
      JAPANESE_ERAS.find((era) => era.name === match[1]),
      parseJapaneseEraYear(match[2]),
      Number(match[3]),
      Number(match[4]),
      'japanese_era_text',
    );
  }

  const gregorianMatch = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(normalized);
  if (gregorianMatch) {
    return parseGregorianDate(
      Number(gregorianMatch[1]),
      Number(gregorianMatch[2]),
      Number(gregorianMatch[3]),
      'delimited_gregorian',
    );
  }

  const eraSymbolMatch = /^([MTSHR])(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(normalized);
  if (eraSymbolMatch) {
    return parseJapaneseEraDate(
      JAPANESE_ERAS.find((era) => era.symbol === eraSymbolMatch[1]),
      Number(eraSymbolMatch[2]),
      Number(eraSymbolMatch[3]),
      Number(eraSymbolMatch[4]),
      'japanese_era_symbol',
    );
  }

  const eraTextMatch = new RegExp(`^${eraTextPattern.source}(?:\\s*(?:適用|改訂))?$`).exec(
    normalized,
  );
  if (eraTextMatch) {
    return parseJapaneseEraDate(
      JAPANESE_ERAS.find((era) => era.name === eraTextMatch[1]),
      parseJapaneseEraYear(eraTextMatch[2]),
      Number(eraTextMatch[3]),
      Number(eraTextMatch[4]),
      'japanese_era_text',
    );
  }

  return { status: 'invalid', reason: 'invalid_format' };
}

export function isValidDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return parseGregorianDate(year, month, day, 'delimited_gregorian').status === 'valid';
}

export function dateKeySchema(message: string) {
  return z.string().trim().refine(isValidDateKey, message);
}
