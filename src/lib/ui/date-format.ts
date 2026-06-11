import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export const DATE_LABEL_PLACEHOLDER = '—';

export type DateLabelOptions = {
  /** date-fns format pattern applied to parseable values. */
  pattern?: string;
  /** Label returned when the value is null, undefined, or empty. */
  fallback?: string;
};

function parseDateValue(value: string): Date | null {
  const parsed = parseISO(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const reparsed = new Date(value);
  return Number.isNaN(reparsed.getTime()) ? null : reparsed;
}

/**
 * Formats an ISO-ish date string for display. Returns `fallback` for empty
 * values and the raw input for unparseable values, so it never throws.
 */
export function formatDateLabel(
  value: string | null | undefined,
  { pattern = 'yyyy/MM/dd', fallback = DATE_LABEL_PLACEHOLDER }: DateLabelOptions = {},
): string {
  if (!value) return fallback;
  const parsed = parseDateValue(value);
  if (!parsed) return value;
  return format(parsed, pattern, { locale: ja });
}

/** Same as {@link formatDateLabel} with a `yyyy/MM/dd HH:mm` default pattern. */
export function formatDateTimeLabel(
  value: string | null | undefined,
  options: DateLabelOptions = {},
): string {
  return formatDateLabel(value, { pattern: 'yyyy/MM/dd HH:mm', ...options });
}
