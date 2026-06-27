import { formatUtcDateKey } from '@/lib/date-key';

/**
 * 稼働日カレンダー基盤 — 営業日計算 pure util（DB 非依存・server/client 共有）。
 *
 * 設計の SSOT: docs/operating-day-calendar-plan.md（rev3, Codex 承認済）。
 *
 * 重要な不変条件:
 * - 公開 API は `'YYYY-MM-DD'`（JST 暦日キー）の **文字列**だけを受け渡す。
 *   Date オブジェクトを引数/戻り値に出さない（§3.2 timezone 事故防止）。
 * - 内部の日付演算は UTC 深夜固定（DST 無し）で行い、TZ 非依存にする。
 * - 営業時間は canonical な `'HH:mm'`（必要なら `'HH:mm:ss'`）文字列で扱う。
 *   `@db.Time`(Date) ↔ string の変換は **呼び出し側の DB adapter 層**の責務（S3）。
 *   この pure util は Date を一切扱わない。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 'HH:mm' / 'HH:mm:ss'、時 00-23・分秒 00-59 のみ許可（24:00 等は不可）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** PharmacyOperatingHours（週次の既定営業/定休）の解決済み行。 */
export type OperatingHoursRow = {
  /** 0=日 .. 6=土。 */
  weekday: number;
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
};

/** BusinessHoliday（日付固有の上書き）の解決済み行。 */
export type HolidayRow = {
  /** 'YYYY-MM-DD'（JST 暦日キー）。 */
  date: string;
  /** null = 全拠点（org-wide）。 */
  site_id: string | null;
  is_closed: boolean;
  open_time?: string | null;
  close_time?: string | null;
};

/**
 * 単一拠点の稼働日解決に必要な入力一式。
 * holidays は dateKey -> 当日該当行（site 一致 or null）の Map。
 */
export type OperatingCalendar = {
  siteId: string;
  /** 最大 7 行（曜日ごと）。空配列なら §1 フォールバック（既定 open）。 */
  weekly: OperatingHoursRow[];
  holidays: Map<string, HolidayRow[]>;
};

export type OperatingStateClosed = {
  open: false;
  /** holiday = 休業日上書き / regular_closed = 週次の定休。 */
  reason: 'holiday' | 'regular_closed';
};

export type OperatingStateOpen = {
  open: true;
  from: string | null;
  to: string | null;
  /** どの層で営業と決まったか。 */
  source: 'holiday' | 'weekly' | 'default';
};

export type OperatingState = OperatingStateClosed | OperatingStateOpen;

/**
 * dateKey を UTC 深夜 Date に変換する。フォーマット regex に加え、
 * JS の暗黙正規化（2026-02-31 → 2026-03-03 等）を round-trip で弾き **fail-closed** する。
 * 不正カレンダー日（存在しない日 / 範囲外の月）は RangeError。
 */
function dateKeyToUtc(dateKey: string): Date {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new RangeError(`Invalid date key (expected YYYY-MM-DD): ${dateKey}`);
  }
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  // 構築結果を再整形して一致しなければ正規化が起きた=存在しない日付。
  if (Number.isNaN(date.getTime()) || formatUtcDateKey(date) !== dateKey) {
    throw new RangeError(`Invalid calendar date: ${dateKey}`);
  }
  return date;
}

function assertDateKey(dateKey: string): void {
  dateKeyToUtc(dateKey);
}

/** dateKey の曜日（0=日 .. 6=土）を TZ 非依存に返す。 */
export function weekdayOfDateKey(dateKey: string): number {
  return dateKeyToUtc(dateKey).getUTCDay();
}

/** dateKey に暦日 days を加減算した dateKey を返す（営業日ではなく単純な暦日）。 */
export function shiftDateKey(dateKey: string, days: number): string {
  const shifted = new Date(dateKeyToUtc(dateKey).getTime() + days * DAY_MS);
  return formatUtcDateKey(shifted);
}

/**
 * 'HH:mm' / 'HH:mm:ss'（時 00-23・分秒 00-59）を 0 時起点の分に変換する。
 * フォーマット不正・範囲外（24:00 / 99:99 / -1:00 / 07:5 / 09:30abc）・空は **null**。
 * 秒は分単位比較に用いるため値には反映しない（形式の妥当性だけ検証する）。
 */
export function timeStringToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const matched = TIME_PATTERN.exec(value);
  if (!matched) return null;
  return Number.parseInt(matched[1], 10) * 60 + Number.parseInt(matched[2], 10);
}

/**
 * 営業時間窓が妥当か（from < to）。
 * - どちらか absent（null/undefined/空）= 終日扱いで妥当。
 * - 片側でも present かつ malformed（不正フォーマット）なら invalid。
 * - 両側 present なら from < to を要求（from >= to は invalid）。
 */
export function isValidOperatingWindow(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const fromMissing = from == null || from === '';
  const toMissing = to == null || to === '';
  if (!fromMissing && timeStringToMinutes(from) == null) return false;
  if (!toMissing && timeStringToMinutes(to) == null) return false;
  const start = fromMissing ? null : timeStringToMinutes(from);
  const end = toMissing ? null : timeStringToMinutes(to);
  if (start == null || end == null) return true;
  return start < end;
}

/**
 * ある日・ある拠点の稼働状態を解決する（PLAN §1 / §1.1 の優先順位を唯一実装する）。
 *
 * 優先順位:
 *  1. BusinessHoliday（日付固有）
 *     - org-wide closed（site_id=null & is_closed）は site-specific open で覆せない。
 *     - site-specific closed はその拠点で休業。
 *     - 上記いずれの closed も無く open 行があれば営業（site 行を org 行より優先）。
 *  2. PharmacyOperatingHours（週次）: is_open=false → 定休、true → 営業。
 *  3. フォールバック（行が無い）= 既定 open（§1）。
 */
export function resolveOperatingState(cal: OperatingCalendar, dateKey: string): OperatingState {
  assertDateKey(dateKey);

  const holidayRows = (cal.holidays.get(dateKey) ?? []).filter(
    (row) => row.site_id === null || row.site_id === cal.siteId,
  );

  if (holidayRows.length > 0) {
    // §1.1: org-wide closed が最優先（site open で覆せない）。
    if (holidayRows.some((row) => row.site_id === null && row.is_closed)) {
      return { open: false, reason: 'holiday' };
    }
    // §1.1: site-specific closed はその拠点で休業。
    if (holidayRows.some((row) => row.site_id === cal.siteId && row.is_closed)) {
      return { open: false, reason: 'holiday' };
    }
    // closed が無ければ open 行で営業（短縮/臨時営業）。site 行を優先。
    const openRows = holidayRows.filter((row) => !row.is_closed);
    if (openRows.length > 0) {
      const picked = openRows.find((row) => row.site_id === cal.siteId) ?? openRows[0];
      return {
        open: true,
        from: picked.open_time ?? null,
        to: picked.close_time ?? null,
        source: 'holiday',
      };
    }
  }

  const weekly = cal.weekly.find((row) => row.weekday === weekdayOfDateKey(dateKey));
  if (weekly) {
    if (!weekly.is_open) {
      return { open: false, reason: 'regular_closed' };
    }
    return {
      open: true,
      from: weekly.open_time ?? null,
      to: weekly.close_time ?? null,
      source: 'weekly',
    };
  }

  // §1 フォールバック: 週次設定が無い拠点は既定 open（Q2 が確定するまで S1/R1 はこれを厳守）。
  return { open: true, from: null, to: null, source: 'default' };
}

/** dateKey が稼働日（営業）か。 */
export function isOperatingDay(cal: OperatingCalendar, dateKey: string): boolean {
  return resolveOperatingState(cal, dateKey).open;
}

/**
 * 起点から direction 方向で最も近い稼働日の dateKey を返す（起点が稼働日ならそのまま）。
 * maxScan 日走査しても見つからなければ安全のため起点を返す（無限ループ防止）。
 */
export function nearestOperatingDay(
  cal: OperatingCalendar,
  dateKey: string,
  direction: 'backward' | 'forward',
  maxScan = 366,
): string {
  assertDateKey(dateKey);
  const step = direction === 'forward' ? 1 : -1;
  let cursor = dateKey;
  for (let scanned = 0; scanned <= maxScan; scanned += 1) {
    if (isOperatingDay(cal, cursor)) return cursor;
    cursor = shiftDateKey(cursor, step);
  }
  return dateKey;
}

/**
 * 稼働日を n 日進める（n>0）/ 戻す（n<0）。営業日のみカウントする。
 * n=0 は起点をそのまま返す（稼働日かは判定しない）。
 * maxScan を超えても到達しなければ null（呼び出し側でハンドリング）。
 */
export function addOperatingDays(
  cal: OperatingCalendar,
  dateKey: string,
  n: number,
  maxScan = 366 * 2,
): string | null {
  assertDateKey(dateKey);
  if (n === 0) return dateKey;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = dateKey;
  for (let scanned = 0; scanned < maxScan; scanned += 1) {
    cursor = shiftDateKey(cursor, step);
    if (isOperatingDay(cal, cursor)) {
      remaining -= 1;
      if (remaining === 0) return cursor;
    }
  }
  return null;
}

/**
 * R1（planner/generate 単一化）用の legacy adapter。
 *
 * **behavior-preserving の核心**: 現行 planner は休業日（is_closed=true）行のみを
 * 見て週次営業時間を持たない。よってここでは:
 *  - is_closed=true の行だけを取り込む（is_closed=false=臨時/短縮営業は無視）。
 *  - weekly は空（週次定休を導入しない）。
 * weekly hours の解釈は S2/S3 完了後に `buildOperatingCalendar`（完全版）へ差し替える。
 *
 * 入力 date は @db.Date（UTC 深夜保存）想定で formatUtcDateKey で dateKey 化する。
 */
export type LegacyBusinessHolidayRecord = {
  date: Date;
  site_id: string | null;
  is_closed: boolean;
};

export function buildOperatingCalendarLegacy(
  siteId: string,
  holidays: LegacyBusinessHolidayRecord[],
): OperatingCalendar {
  const map = new Map<string, HolidayRow[]>();
  for (const record of holidays) {
    if (!record.is_closed) continue; // legacy: 休業のみ
    if (record.site_id !== null && record.site_id !== siteId) continue; // 該当拠点 or 全拠点のみ
    const dateKey = formatUtcDateKey(record.date);
    const row: HolidayRow = {
      date: dateKey,
      site_id: record.site_id,
      is_closed: true,
    };
    const existing = map.get(dateKey);
    if (existing) {
      existing.push(row);
    } else {
      map.set(dateKey, [row]);
    }
  }
  return { siteId, weekly: [], holidays: map };
}
