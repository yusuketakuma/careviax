/** Placeholder shown when a yen amount is null/undefined. */
export const YEN_PLACEHOLDER = '—';

/**
 * Canonical Japanese-yen display formatter: `1,234円`.
 * Returns `fallback` for null/undefined so it never renders "null円".
 */
export function formatYen(
  value: number | null | undefined,
  fallback: string = YEN_PLACEHOLDER,
): string {
  return value == null ? fallback : `${value.toLocaleString('ja-JP')}円`;
}
