/**
 * RX 番号(処方サイクルの人間可読識別子)のフォーマッタ。
 * 1 RX = 1 処方サイクル = 1 カード(docs/design-gap-analysis-new.md「共通パターン」)。
 *
 * - 'rx_yearmonth'(既定・既存互換): RX-YYYYMM-NNNN — 全体検索 p0_05 で使用中の表記。
 * - 'rx_year'(新デザイン): RX-YYYY-NNNN — design/images/new の横断表記(例 RX-2024-0500)。
 * CUID などの opaque id は末尾数字だけでは衝突しやすいため、full id 由来の suffix にする。
 */

export type PrescriptionCardNumberFormat = 'rx_yearmonth' | 'rx_year';

/**
 * prescribed_date(YYYY-MM-DD)と id(任意の文字列)から RX 番号を生成する。
 * 短い id と末尾 4 桁の legacy id は既存互換の suffix を維持する。
 * prescribed_date 欠落時は期間部を ?(rx_yearmonth=6 桁 / rx_year=4 桁)で埋める。
 */
export function formatPrescriptionCardNumber(
  id: string,
  prescribed_date: string | null | undefined,
  format: PrescriptionCardNumberFormat = 'rx_yearmonth',
): string {
  const periodLength = format === 'rx_year' ? 4 : 6;
  const period = prescribed_date
    ? prescribed_date.replace(/-/g, '').slice(0, periodLength)
    : '?'.repeat(periodLength);
  const suffix = formatPrescriptionIdSuffix(id);
  return `RX-${period}-${suffix}`;
}

function formatPrescriptionIdSuffix(id: string): string {
  const tail = id.slice(-4);
  const numeric = tail.replace(/\D/g, '');
  if (id.length <= 4) {
    return numeric.length > 0 ? numeric.padStart(4, '0') : tail.padStart(4, 'X');
  }
  if (/^\d{4}$/.test(tail)) {
    return tail;
  }

  const normalizedId = id.toUpperCase().replace(/[^A-Z0-9]/g, 'X') || 'UNKNOWN';
  return `${stableBase36Hash(id)}-${normalizedId}`;
}

function stableBase36Hash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0');
}
