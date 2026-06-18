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
 * (それらは従来どおりローカル深夜境界が正しい)。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** ローカル(サーバー TZ)の日付キー 'YYYY-MM-DD' を返す。 */
export function localDateKey(date: Date = new Date()): string {
  return formatDateKey(date);
}

/** 日付キー 'YYYY-MM-DD' を @db.Date 比較用の UTC 深夜 Date にする。 */
export function utcDateFromLocalKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
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
 * 「今日(ローカル日付)」1 日分の @db.Date 比較レンジ。
 * Prisma の where にそのまま展開できる({ gte: 当日 UTC 深夜, lt: 翌日 UTC 深夜 })。
 */
export function todayUtcRange(now: Date = new Date()): { gte: Date; lt: Date } {
  const gte = utcDateFromLocalKey(localDateKey(now));
  return { gte, lt: addUtcDays(gte, 1) };
}
