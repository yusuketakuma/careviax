import { japanDateKey } from '@/lib/utils/date-boundary';

/**
 * eGFR 等の腎機能安全タグの測定日を Asia/Tokyo カレンダー日付で安全にフォーマットする。
 *
 * date-fns `format()` はサーバーのランタイム TZ に依存するため、TZ が JST でない
 * 環境(テスト・将来のリージョン変更等)では深夜帯の測定日が前日/翌日にずれる恐れがある。
 * `japanDateKey` で Asia/Tokyo のカレンダー日付を固定してから組み立てる。
 *
 * 表記は「M/d」のような数字のみの bare 表記を避け、桁混同(03/04)を防ぐ和式表記
 * (例: 2026年6月1日)にする(`docs/ui-ux-design-guidelines.md` 7.8 薬剤名・用量・
 * 日付の安全表示)。
 */
export function formatRenalObservationDate(measuredAt: Date): string {
  const [year, month, day] = japanDateKey(measuredAt).split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

/**
 * 患者詳細ワークスペースと訪問ヘッダー(header-summary)で共有する腎機能安全ラベル。
 * 例: `eGFR 38(2026年6月1日)`
 */
export function formatRenalSafetyLabel(value: number | string, measuredAt: Date): string {
  return `eGFR ${value}(${formatRenalObservationDate(measuredAt)})`;
}
