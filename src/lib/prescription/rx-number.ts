/**
 * RX 番号(処方サイクルの人間可読識別子)のフォーマッタ。
 * 1 RX = 1 処方サイクル = 1 カード(docs/design-gap-analysis-new.md「共通パターン」)。
 *
 * - 'rx_yearmonth'(既定・既存互換): RX-YYYYMM-NNNN — 全体検索 p0_05 で使用中の表記。
 * - 'rx_year'(新デザイン): RX-YYYY-NNNN — design/images/new の横断表記(例 RX-2024-0500)。
 */

export type PrescriptionCardNumberFormat = 'rx_yearmonth' | 'rx_year';

/**
 * prescribed_date(YYYY-MM-DD)と id(任意の文字列)から RX 番号を生成する。
 * id 末尾 4 文字を数値化して右詰めゼロパディング。非数値のみの末尾は X パディング。
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
  // id 末尾 4 文字を数値化してゼロパディング。非数値は X で表現
  const tail = id.slice(-4);
  const numeric = tail.replace(/\D/g, '');
  const suffix = numeric.length > 0 ? numeric.padStart(4, '0') : tail.padStart(4, 'X');
  return `RX-${period}-${suffix}`;
}
