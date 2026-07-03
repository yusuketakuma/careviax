import { formatDateKey } from '@/lib/date-key';

/**
 * @db.Date カラム境界ヘルパー。
 *
 * @db.Date カラム(scheduled_date / visit_deadline_date / medication_*_date /
 * valid_from / valid_until / shift date 等)は「ローカル(JST)日付の UTC 深夜」
 * (例: 2026-06-12 → 2026-06-12T00:00:00.000Z)で保存される
 * (visit-schedule-service の new Date('YYYY-MM-DD') と同じ規約。seed も UTC 深夜)。
 *
 * これらのカラムと比較する Date は必ずこのヘルパーで作ること。
 * new Date() + setHours(0, 0, 0, 0)(ローカル深夜)は JST では UTC に直すと
 * 前日 15:00 になり、lte/gt/equals 比較で当日レコードを取りこぼす/前日を拾う。
 *
 * 注意: created_at 等の実時刻を持つ DateTime カラムとの比較には使わないこと
 * (それらは japanDayInstantRange* / japanMonthInstantRange を使う)。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const JAPAN_TIME_ZONE = 'Asia/Tokyo';
const JAPAN_TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000;
const JAPAN_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: JAPAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ローカル(サーバー TZ)の日付キー 'YYYY-MM-DD' を返す。 */
export function localDateKey(date: Date = new Date()): string {
  return formatDateKey(date);
}

/** 日本国内運用の業務日キー 'YYYY-MM-DD' を返す。サーバー TZ には依存しない。 */
export function japanDateKey(date: Date = new Date()): string {
  const parts = JAPAN_DATE_FORMAT.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new RangeError('Invalid Japan date key');
  }
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string): { year: number; monthIndex: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError('Invalid date key');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError('Invalid date key');
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new RangeError('Invalid date key');
  }
  return { year, monthIndex: month - 1, day };
}

function parseMonthKey(key: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError('Invalid month key');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new RangeError('Invalid month key');
  }
  return { year, monthIndex: month - 1 };
}

/** 日付キー 'YYYY-MM-DD' を @db.Date 比較用の UTC 深夜 Date にする。 */
export function utcDateFromLocalKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** 日本業務日キー 'YYYY-MM-DD' の開始瞬間(JST 00:00)を UTC DateTime にする。 */
export function japanDayStartInstantFromDateKey(key: string): Date {
  const { year, monthIndex, day } = parseDateKey(key);
  return new Date(Date.UTC(year, monthIndex, day) - JAPAN_TIME_ZONE_OFFSET_MS);
}

/** nullable / optional な日付キーを @db.Date 更新値へ変換する。 */
export function optionalUtcDateFromLocalKey(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return utcDateFromLocalKey(value);
}

/** UTC 深夜 Date に日数を加算する(UTC は DST がないため純粋なミリ秒加算で正確)。 */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * DateTime カラム比較用の日本業務日 1 日分の実時刻レンジ。
 * created_at / updated_at / visit_date 等の瞬間時刻を「日本の今日」で数える時に使う。
 */
export function japanDayInstantRange(now: Date = new Date()): { gte: Date; lt: Date } {
  const gte = japanDayStartInstantFromDateKey(japanDateKey(now));
  return { gte, lt: addUtcDays(gte, 1) };
}

/** DateTime カラム比較用の日本業務日キー 'YYYY-MM-DD' 1 日分の実時刻レンジ。 */
export function japanDayInstantRangeFromDateKey(key: string): { gte: Date; lt: Date } {
  const gte = japanDayStartInstantFromDateKey(key);
  return { gte, lt: addUtcDays(gte, 1) };
}

/** DateTime カラム比較用の日本業務月 1 か月分の実時刻レンジ。 */
export function japanMonthInstantRange(monthKey: string): { gte: Date; lt: Date } {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const gte = new Date(Date.UTC(year, monthIndex, 1) - JAPAN_TIME_ZONE_OFFSET_MS);
  const lt = new Date(Date.UTC(year, monthIndex + 1, 1) - JAPAN_TIME_ZONE_OFFSET_MS);
  return { gte, lt };
}

/** @db.Date カラム比較用の月 1 か月分の UTC 深夜 sentinel レンジ。 */
export function utcMonthDateRange(monthKey: string): { gte: Date; lt: Date } {
  const { year, monthIndex } = parseMonthKey(monthKey);
  return {
    gte: new Date(Date.UTC(year, monthIndex, 1)),
    lt: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

/**
 * 「今日(日本業務日)」1 日分の @db.Date 比較レンジ。
 * Prisma の where にそのまま展開できる({ gte: 当日 UTC 深夜, lt: 翌日 UTC 深夜 })。
 */
export function todayUtcRange(now: Date = new Date()): { gte: Date; lt: Date } {
  const gte = utcDateFromLocalKey(japanDateKey(now));
  return { gte, lt: addUtcDays(gte, 1) };
}

/**
 * ある瞬間(実時刻 DateTime)を Asia/Tokyo の民間時刻フィールドに分解する。
 *
 * `Date#getHours()` / `getDay()` / `getMinutes()` 等はランタイム TZ 依存。prod=UTC の
 * サーバーでは JST 22:00 の訪問(UTC 13:00 で保存)を 13 時・別曜日として読み、
 * 夜間/深夜/休日加算の判定を取りこぼす(過少請求)/誤加算する(過大請求)。
 * 時刻帯・曜日を業務判定に使う箇所は必ずこのヘルパーの JST フィールドを使うこと。
 *
 * Asia/Tokyo は UTC+9 固定(DST なし)のため、+9h シフト後に UTC フィールドを読む方式で
 * 厳密に JST 民間時刻へ変換できる(ランタイム TZ に一切依存しない)。
 */
export function japanCivilTimeParts(date: Date): {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=日曜, 1=月曜, ..., 6=土曜(JST 基準)。 */
  weekday: number;
} {
  const shifted = new Date(date.getTime() + JAPAN_TIME_ZONE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}
